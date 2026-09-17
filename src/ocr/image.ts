import sharp from 'sharp';
import { MaxImageBytes, NoImageError } from './types.js';

export const maxPreparedBytes = 3 << 19; // 1.5 MiB
const jpegQuality = 82;
const shrinkAttempts = 16;

export async function prepareJPEG(raw: Buffer): Promise<Buffer> {
  if (raw.length === 0) throw new NoImageError();
  if (raw.length > MaxImageBytes) throw new Error('image must be 10 MB or smaller');
  if (!sniffImage(raw)) throw new Error('image must be jpeg, png, webp, or gif');
  let flattened: Buffer;
  try {
    flattened = await flattenWhite(raw);
  } catch {
    throw new Error('could not read the image');
  }
  return fitJPEG(flattened, maxPreparedBytes);
}

export async function flattenWhite(raw: Buffer): Promise<Buffer> {
  return sharp(raw, { failOn: 'error' })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

export async function encodeJPEG(img: Buffer): Promise<Buffer> {
  return sharp(img).jpeg({ quality: jpegQuality }).toBuffer();
}

export async function fitJPEG(img: Buffer, maxBytes: number): Promise<Buffer> {
  let out = await encodeJPEG(img);
  if (out.length <= maxBytes) return out;

  const meta = await sharp(img).metadata();
  const origW = meta.width ?? 1;
  const origH = meta.height ?? 1;
  let scale = 1;
  for (let i = 0; i < shrinkAttempts && out.length > maxBytes; i++) {
    let ratio = Math.sqrt(maxBytes / out.length);
    if (ratio > 0.95) ratio = 0.95;
    scale *= ratio;
    let w = Math.round(origW * scale);
    let h = Math.round(origH * scale);
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    out = await encodeJPEG(await sharp(img).resize(w, h, { kernel: 'lanczos3' }).toBuffer());
  }
  if (out.length > maxBytes) throw new Error('could not compress the image under 1.5 MB');
  return out;
}

export function sniffImage(b: Buffer): boolean {
  if (b.length >= 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') {
    return true;
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return true;
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return true;
  }
  if (b.length >= 6) {
    const head = b.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return true;
  }
  return false;
}
