import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, extname, join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { flattenWhite, fitJPEG, maxPreparedBytes, prepareJPEG } from './image.js';
import { NoPDFTextError } from './types.js';

const execFileAsync = promisify(execFile);

export const minPDFLetters = 40;
export const maxPDFPages = 40;
const maxPDFTextRunes = 80_000;
const previewPageGap = 12;
const previewMaxW = 1200;
const visionDPI = '200';
const previewDPI = '150';
const previewGapColor = { r: 216, g: 222, b: 230 };

export async function previewPDF(raw: Buffer): Promise<Buffer> {
  try {
    const jpeg = await previewPDFPages(raw);
    if (jpeg.length > 0) return jpeg;
  } catch {
    /* fall through to text slip */
  }
  const text = await extractPDFText(raw);
  return renderTextSlip(text);
}

export async function pdfPageJPEGs(raw: Buffer): Promise<Buffer[]> {
  const pages = await withRasterized(raw, visionDPI, async (paths) => {
    const out: Buffer[] = [];
    for (const path of paths) {
      const b = await readFile(path);
      if (b.length === 0) continue;
      out.push(await prepareJPEG(b));
    }
    return out;
  });
  if (pages.length === 0) throw new NoPDFTextError();
  return pages;
}

export async function extractPDFText(raw: Buffer): Promise<string> {
  try {
    const dir = await mkdtemp(join(tmpdir(), 'bulkly-pdf-'));
    try {
      const pdfPath = join(dir, 'in.pdf');
      await writeFile(pdfPath, pdfPayload(raw), { mode: 0o600 });
      const { stdout } = await execFileAsync('pdftotext', ['-layout', '-l', String(maxPDFPages), pdfPath, '-'], {
        timeout: 120_000,
        maxBuffer: 8 << 20,
      });
      let out = stdout.trim();
      const runes = [...out];
      if (runes.length > maxPDFTextRunes) out = runes.slice(0, maxPDFTextRunes).join('');
      return out;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    return '';
  }
}

export function isPDFWithText(text: string): boolean {
  let n = 0;
  for (const r of text) {
    if (/[\p{L}\p{N}]/u.test(r)) {
      n++;
      if (n >= minPDFLetters) return true;
    }
  }
  return false;
}

export function pdfPayload(raw: Buffer): Buffer {
  const i = raw.indexOf('%PDF-');
  if (i <= 0) return raw;
  return raw.subarray(i);
}

async function previewPDFPages(raw: Buffer): Promise<Buffer> {
  const pngs = await previewPagePNGs(raw);
  return stackPreviewJPEG(pngs);
}

async function previewPagePNGs(raw: Buffer): Promise<Buffer[]> {
  return withRasterized(raw, previewDPI, async (paths) => {
    const out: Buffer[] = [];
    for (const path of paths) {
      const b = await readFile(path);
      if (b.length === 0) continue;
      out.push(b);
    }
    if (out.length === 0) throw new Error('could not rasterize the PDF');
    return out;
  });
}

export async function stackPreviewJPEG(pngs: Buffer[]): Promise<Buffer> {
  if (pngs.length === 0) throw new Error('could not rasterize the PDF');
  const pages: Buffer[] = [];
  for (const raw of pngs) {
    let img: Buffer;
    try {
      img = await flattenWhite(raw);
    } catch {
      throw new Error('could not read the PDF page');
    }
    pages.push(await fitPreviewPage(img));
  }
  return fitJPEG(await stackPages(pages), maxPreparedBytes);
}

async function fitPreviewPage(img: Buffer): Promise<Buffer> {
  const meta = await sharp(img).metadata();
  if ((meta.width ?? 0) > previewMaxW) {
    return sharp(img).resize({ width: previewMaxW, kernel: 'lanczos3' }).png().toBuffer();
  }
  return img;
}

async function stackPages(pages: Buffer[]): Promise<Buffer> {
  if (pages.length === 0) {
    return sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
  }
  if (pages.length === 1) return pages[0]!;
  const metas = await Promise.all(pages.map((p) => sharp(p).metadata()));
  let width = 0;
  let height = 0;
  for (let i = 0; i < metas.length; i++) {
    const w = metas[i]!.width ?? 1;
    const h = metas[i]!.height ?? 1;
    if (w > width) width = w;
    height += h;
    if (i > 0) height += previewPageGap;
  }
  const composites: sharp.OverlayOptions[] = [];
  let y = 0;
  for (let i = 0; i < pages.length; i++) {
    const w = metas[i]!.width ?? 1;
    const h = metas[i]!.height ?? 1;
    const x = Math.floor((width - w) / 2);
    composites.push({ input: pages[i], top: y, left: x });
    y += h;
    if (i < pages.length - 1) y += previewPageGap;
  }
  return sharp({
    create: { width, height, channels: 3, background: previewGapColor },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function renderTextSlip(text: string): Promise<Buffer> {
  const lines = wrapPreviewLines(text);
  const pad = 18;
  const lineH = 14;
  const width = 420;
  let height = pad * 2 + lineH * lines.length;
  if (height < 220) height = 220;
  const texts = lines
    .map((line, i) => {
      const y = pad + 11 + i * lineH;
      return `<text x="${pad}" y="${y}" xml:space="preserve" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="13" fill="rgb(16,32,51)">${escapeXml(line)}</text>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${texts}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

export function wrapPreviewLines(text: string): string[] {
  text = text.trim();
  if (text === '') return ['PDF bill', 'Could not render PDF pages.'];
  const maxChars = 52;
  const maxLines = 72;
  const out: string[] = ['PDF bill', ''];
  for (let raw of text.split('\n')) {
    raw = raw.trim();
    if (raw === '') {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    let runes = [...raw];
    while (runes.length > 0) {
      const n = Math.min(maxChars, runes.length);
      out.push(runes.slice(0, n).join(''));
      runes = runes.slice(n);
      if (out.length >= maxLines) return out;
    }
    if (out.length >= maxLines) return out;
  }
  return out;
}

function escapeXml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function errNeedPoppler(): NoPDFTextError {
  return new NoPDFTextError('this PDF could not be read as images: install poppler or run Bulkly in Docker');
}

async function withRasterized<T>(raw: Buffer, dpi: string, fn: (paths: string[]) => Promise<T>): Promise<T> {
  if (!(await commandExists('pdftoppm'))) throw errNeedPoppler();
  const { pages, cleanup } = await rasterizePDF(raw, dpi, maxPDFPages);
  try {
    if (pages.length === 0) throw new Error('could not rasterize the PDF');
    return await fn(pages);
  } finally {
    await cleanup();
  }
}

async function rasterizePDF(
  raw: Buffer,
  dpi: string,
  lastPage: number,
): Promise<{ pages: string[]; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'bulkly-pdf-'));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const pdfPath = join(dir, 'in.pdf');
    await writeFile(pdfPath, pdfPayload(raw), { mode: 0o600 });
    const prefix = join(dir, 'page');
    try {
      await execFileAsync('pdftoppm', ['-png', '-r', dpi, '-l', String(lastPage), pdfPath, prefix], {
        timeout: 120_000,
        maxBuffer: 16 << 20,
      });
    } catch (err) {
      if (isEnoent(err)) throw errNeedPoppler();
      const msg = stderrMessage(err);
      throw new Error(msg ? `could not rasterize the PDF: pdftoppm: ${msg}` : `could not rasterize the PDF: ${String(err)}`);
    }
    const names = await readdir(dir);
    const matches = names.filter((n) => n.startsWith('page-') && n.endsWith('.png')).map((n) => join(dir, n));
    sortPageFiles(matches);
    return { pages: matches, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function sortPageFiles(files: string[]): void {
  files.sort((a, b) => pageIndex(a) - pageIndex(b));
}

function pageIndex(path: string): number {
  const base = basename(path, extname(path));
  const i = base.lastIndexOf('-');
  if (i < 0) return 0;
  const n = Number.parseInt(base.slice(i + 1), 10);
  return Number.isFinite(n) ? n : 0;
}

async function commandExists(cmd: string): Promise<boolean> {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      await access(join(dir, cmd), constants.X_OK);
      return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT');
}

function stderrMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    return (typeof stderr === 'string' ? stderr : stderr?.toString('utf8') ?? '').trim();
  }
  return err instanceof Error ? err.message : '';
}
