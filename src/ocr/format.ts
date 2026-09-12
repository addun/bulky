import { sniffImage } from './image';
import { prepareJPEG } from './image';
import { previewPDF, renderTextSlip } from './pdf';
import { MaxImageBytes, NoImageError } from './types';

export const fileUnknown = 0;
export const fileImage = 1;
export const filePDF = 2;
export type FileKind = typeof fileUnknown | typeof fileImage | typeof filePDF;

export function sniffFile(b: Buffer): FileKind {
  if (isPDF(b)) return filePDF;
  if (sniffImage(b)) return fileImage;
  return fileUnknown;
}

export function isPDF(b: Buffer): boolean {
  if (b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-') return true;
  const n = Math.min(b.length, 1024);
  return b.subarray(0, n).includes(Buffer.from('%PDF-'));
}

export async function previewJPEG(raw: Buffer): Promise<Buffer> {
  if (raw.length === 0) throw new NoImageError();
  if (raw.length > MaxImageBytes) throw new Error('file must be 10 MB or smaller');
  switch (sniffFile(raw)) {
    case filePDF:
      return previewPDF(raw);
    case fileImage:
      return prepareJPEG(raw);
    default:
      throw new Error('file must be jpeg, png, webp, gif, or pdf');
  }
}

export async function previewText(text: string): Promise<Buffer> {
  return renderTextSlip(text);
}
