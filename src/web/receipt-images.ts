import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';

const receiptImageID = /^[a-f0-9]{32}$/;

@Injectable()
export class ReceiptImagesService {
  constructor(private readonly store: StoreService) {}

  receiptImageDir(): string {
    return join(this.store.dataDir(), 'ocr');
  }

  async saveReceiptFiles(raw: Buffer, jpeg: Buffer): Promise<string> {
    await mkdir(this.receiptImageDir(), { recursive: true, mode: 0o755 });
    const name = randomBytes(16).toString('hex');
    const jpgPath = join(this.receiptImageDir(), name + '.jpg');
    await writeFile(jpgPath, jpeg, { mode: 0o644 });
    const srcPath = join(this.receiptImageDir(), name + '.bin');
    try {
      await writeFile(srcPath, raw, { mode: 0o644 });
    } catch (err) {
      try {
        await unlink(jpgPath);
      } catch {
        /* ignore */
      }
      throw err;
    }
    return name;
  }

  receiptImagePath(id: string): string | null {
    if (!receiptImageID.test(id)) return null;
    return join(this.receiptImageDir(), id + '.jpg');
  }

  receiptSourcePath(id: string): string | null {
    if (!receiptImageID.test(id)) return null;
    return join(this.receiptImageDir(), id + '.bin');
  }

  async loadReceiptSource(id: string): Promise<Buffer> {
    const path = this.receiptSourcePath(id);
    if (!path) {
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    }
    return readFile(path);
  }

  async deleteReceiptFiles(id: string): Promise<void> {
    const img = this.receiptImagePath(id);
    if (img) {
      try {
        await unlink(img);
      } catch {
        /* ignore */
      }
    }
    const src = this.receiptSourcePath(id);
    if (src) {
      try {
        await unlink(src);
      } catch {
        /* ignore */
      }
    }
  }

  previewExists(id: string): boolean {
    const path = this.receiptImagePath(id);
    return path !== null && existsSync(path);
  }
}
