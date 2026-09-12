import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { StoreService } from '../store/store.service';

const MAX_IMAGE_BYTES = 5 << 20;
const IMAGE_EDGE = 240;

@Injectable()
export class ImagesService {
  constructor(private readonly store: StoreService) {}

  async saveImage(file: Express.Multer.File | undefined): Promise<string> {
    if (!file || file.size === 0) return '';
    if (file.size > MAX_IMAGE_BYTES) throw new Error('image must be 5 MB or smaller');
    const raw = file.buffer;
    if (raw.length > MAX_IMAGE_BYTES) throw new Error('image must be 5 MB or smaller');
    if (raw.length === 0) return '';
    if (!sniffImage(raw)) throw new Error('image must be jpeg, png, webp, or gif');
    const buf = await sharp(raw)
      .rotate()
      .resize(IMAGE_EDGE, IMAGE_EDGE, { fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer();
    const name = randomBytes(16).toString('hex') + '.jpg';
    const dest = join(this.store.imagesDir(), name);
    await sharp(buf).toFile(dest);
    return name;
  }

  deleteImage(name: string): void {
    const base = basename(name.trim());
    if (base === '' || base === '.' || base === '/') return;
    try {
      unlinkSync(join(this.store.imagesDir(), base));
    } catch {
      /* ignore */
    }
  }
}

export function sniffImage(b: Buffer): boolean {
  if (b.length >= 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') {
    return true;
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return true;
  if (b.length >= 8 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return true;
  if (b.length >= 6 && (b.subarray(0, 6).toString() === 'GIF87a' || b.subarray(0, 6).toString() === 'GIF89a')) {
    return true;
  }
  return false;
}
