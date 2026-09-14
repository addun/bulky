import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NoLinesError, NoPDFTextError, NotABillError } from '../ocr/types';
import { OcrService } from '../ocr/ocr.service';
import { RECEIPT_PENDING, ReceiptsRepository } from '@app/store/receipts';
import { UnitsRepository } from '@app/store/units';
import { ReceiptImagesService } from './receipt-images';

const ocrJobBuffer = 32;

@Injectable()
export class OcrQueueService implements OnModuleInit {
  private readonly log = new Logger(OcrQueueService.name);
  private readonly pending: number[] = [];
  private busy = false;

  constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly units: UnitsRepository,
    private readonly ocr: OcrService,
    private readonly images: ReceiptImagesService,
  ) {}

  onModuleInit(): void {
    this.recoverOCR();
  }

  recoverOCR(): void {
    let ids: number[];
    try {
      ids = this.receipts.listPendingReceiptIDs();
    } catch (err) {
      this.log.warn(`ocr recover: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const id of ids) this.enqueueOCR(id);
  }

  enqueueOCR(id: number): void {
    if (this.pending.length < ocrJobBuffer) {
      this.pending.push(id);
      void this.drain();
      return;
    }
    setImmediate(() => {
      this.pending.push(id);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length > 0) {
        const id = this.pending.shift()!;
        await this.processOCRJob(id);
      }
    } finally {
      this.busy = false;
      if (this.pending.length > 0) void this.drain();
    }
  }

  async processOCRJob(id: number): Promise<void> {
    let receipt;
    try {
      receipt = this.receipts.getReceipt(id);
    } catch {
      return;
    }
    if (receipt.Status !== RECEIPT_PENDING) return;

    let raw: Buffer;
    try {
      raw = await this.images.loadReceiptSource(receipt.ImagePath);
    } catch {
      try {
        this.receipts.failReceipt(id, 'Could not read the stored bill.');
      } catch {
        /* ignore */
      }
      return;
    }
    if (!this.ocr.configured()) return;
    const model = this.units.ocrModel();
    if (model === '') return;

    try {
      const { rawJSON } = await this.ocr.withModel(model).extract(raw);
      try {
        this.receipts.saveAIResponse(id, rawJSON.toString('utf8'));
      } catch {
        try {
          this.receipts.failReceipt(id, 'Could not save the AI response.');
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      try {
        this.receipts.failReceipt(id, ocrFailMessage(err));
      } catch {
        /* ignore */
      }
    }
  }
}

export function ocrFailMessage(err: unknown): string {
  if (err instanceof NotABillError) {
    return 'That file does not look like a bill. Try a clearer photo of the whole receipt, or another PDF.';
  }
  if (err instanceof NoLinesError) {
    return 'No products could be read from this bill. Try another photo or PDF.';
  }
  if (err instanceof NoPDFTextError) {
    return 'This PDF could not be turned into images. Install poppler or run Bulkly in Docker, or photograph the bill.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  return 'Could not read the bill: ' + msg;
}
