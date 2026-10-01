import { ConflictException, Injectable, InternalServerErrorException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import {
  InvalidStoreError,
  InvalidUnitError,
  NotFoundError,
  ReceiptMigratedError,
  ReceiptNotReadyError,
} from '../../../domain/errors.js';
import { fromDatetimeLocal } from '../../../domain/bought-on.js';
import { MaxImageBytes } from '../../../ocr/types.js';
import { previewJPEG } from '../../../ocr/format.js';
import { OcrService } from '../../../ocr/ocr.service.js';
import { AliasesRepository } from '#app/store/aliases';
import { LocationsRepository, type Store } from '#app/store/locations';
import { ProductsRepository, type ProductListItem } from '#app/store/products';
import { PurchasesRepository } from '#app/store/purchases';
import {
  RECEIPT_FAILED,
  RECEIPT_MIGRATED,
  RECEIPT_PENDING,
  ReceiptsRepository,
  type Receipt,
  type ReceiptDuplicateGroup,
} from '#app/store/receipts';
import { SettingsRepository } from '#app/store/settings';
import { UnitsRepository, type Unit } from '#app/store/units';
import { OcrQueueService } from '../../../web/ocr-queue.service.js';
import { presentReceipt, presentReceiptListItem, presentStore } from '../../../web/present.js';
import {
  decorateReceiptView,
  knownStoreID,
  parseReceiptForm,
  receiptToView,
  receiptVisitFacts,
  viewToRawJSON,
} from '../../../web/receipt-form.js';
import { ImagesService } from '../../../web/images.service.js';
import { ReceiptImagesService } from '../../../web/receipt-images.js';
import { type ReceiptVisitRequest } from './contract/request.js';
import {
  AdminReceiptConfirmedResponse,
  AdminReceiptDeletedResponse,
  AdminReceiptDetailResponse,
  AdminReceiptDuplicatesResponse,
  AdminReceiptEditResponse,
  AdminReceiptIdResponse,
  AdminReceiptsResponse,
} from './contract/response.js';

@Injectable()
export class AdminReceiptsHandler {
  constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly units: UnitsRepository,
    private readonly settings: SettingsRepository,
    private readonly locations: LocationsRepository,
    private readonly products: ProductsRepository,
    private readonly aliases: AliasesRepository,
    private readonly purchases: PurchasesRepository,
    private readonly ocr: OcrService,
    private readonly queue: OcrQueueService,
    private readonly images: ReceiptImagesService,
    private readonly catalogImages: ImagesService,
    private readonly config: ConfigService,
  ) {}

  list(): AdminReceiptsResponse {
    return AdminReceiptsResponse.parse({
      configured: this.ocr.configured(),
      model: this.settings.getSetting('ocr_model'),
      receipts: this.receipts.listReceipts().map(presentReceiptListItem),
    });
  }

  duplicates(): AdminReceiptDuplicatesResponse {
    return AdminReceiptDuplicatesResponse.parse({
      groups: this.receipts.listDuplicateReceipts().map(presentDuplicateGroup),
    });
  }

  async upload(files: { bill?: Express.Multer.File[]; bill_camera?: Express.Multer.File[] }): Promise<AdminReceiptIdResponse> {
    if (!this.ocr.configured()) throw new UnprocessableEntityException('Set OCR_API_KEY or OCR_BASE_URL so the reader can run.');
    const model = this.settings.getSetting('ocr_model');
    if (model === '') throw new UnprocessableEntityException('Set the AI model under Settings so the reader can run.');
    const file = pickFormFile(files, 'bill', 'bill_camera');
    if (!file) throw new UnprocessableEntityException('Choose a photo or a PDF of the bill.');
    const accepted = await this.acceptBill(file);
    this.queue.enqueueOCR(accepted.id);
    return AdminReceiptIdResponse.parse({ id: accepted.id });
  }

  previewPath(receiptId: number): string | null {
    let receipt: Receipt;
    try {
      receipt = this.receipts.getReceipt(receiptId);
    } catch {
      return null;
    }
    const path = this.images.receiptImagePath(receipt.imagePath);
    if (!receipt.imagePath || !path || !this.images.previewExists(receipt.imagePath)) return null;
    return path;
  }

  show(receiptId: number): AdminReceiptDetailResponse {
    const receipt = this.load(receiptId);
    if (receipt.status === RECEIPT_PENDING || receipt.status === RECEIPT_FAILED) {
      return AdminReceiptDetailResponse.parse({ kind: 'status' as const, receipt: presentReceipt(receipt) });
    }
    if (receipt.status === RECEIPT_MIGRATED) {
      const buys = this.purchases.listPurchasesByReceipt(receipt.id);
      const stores = this.locations.listStores();
      const facts = receiptVisitFacts(receipt, buys, stores);
      return AdminReceiptDetailResponse.parse({
        kind: 'show' as const,
        receipt: presentReceipt(receipt),
        purchases: buys,
        boughtOn: facts.boughtOn,
        notes: facts.notes,
        store: presentStore(facts.store),
        symbol: this.config.get<string>('CURRENCY_SYMBOL') || 'zł',
      });
    }
    const lookups = this.lookups();
    let view;
    try {
      view = receiptToView(receipt, lookups.products, lookups.stores, this.aliases.listAliases(), this.units.unitDefaults());
    } catch {
      throw new InternalServerErrorException('Could not read the saved AI response.');
    }
    return AdminReceiptDetailResponse.parse({
      kind: 'review' as const,
      view,
      products: lookups.products,
      units: lookups.units,
      stores: lookups.stores.map(presentStore),
      symbol: this.config.get<string>('CURRENCY_SYMBOL') || 'zł',
      currency: this.config.get<string>('CURRENCY') || 'PLN',
    });
  }

  edit(receiptId: number): AdminReceiptEditResponse {
    const receipt = this.load(receiptId);
    if (receipt.status !== RECEIPT_MIGRATED) throw new ConflictException('This receipt is not saved as purchases yet.');
    const buys = this.purchases.listPurchasesByReceipt(receipt.id);
    const stores = this.locations.listStores();
    const facts = receiptVisitFacts(receipt, buys, stores);
    return AdminReceiptEditResponse.parse({
      receipt: presentReceipt(receipt),
      boughtOn: facts.boughtOn,
      store: presentStore(facts.store),
      stores: stores.map(presentStore),
    });
  }

  updateVisit(receiptId: number, body: z.infer<typeof ReceiptVisitRequest>): AdminReceiptIdResponse {
    const receipt = this.load(receiptId);
    if (receipt.status !== RECEIPT_MIGRATED) throw new ConflictException('This receipt is not saved as purchases yet.');
    const boughtOn = fromDatetimeLocal(body.bought_on);
    if (boughtOn === '') throw new UnprocessableEntityException('Date must be a valid day.');
    const store = this.resolveStore(body.store_id);
    if (store.msg) throw new UnprocessableEntityException(store.msg);
    this.receipts.updateReceiptVisit(receiptId, store.id, boughtOn);
    return AdminReceiptIdResponse.parse({ id: receiptId });
  }

  async retry(receiptId: number): Promise<AdminReceiptIdResponse> {
    const receipt = this.load(receiptId);
    if (receipt.status !== RECEIPT_FAILED && receipt.status !== RECEIPT_PENDING) {
      return AdminReceiptIdResponse.parse({ id: receiptId });
    }
    if (receipt.status === RECEIPT_FAILED) {
      if (!this.ocr.configured()) throw new UnprocessableEntityException('Set OCR_API_KEY or OCR_BASE_URL so the reader can run.');
      if (this.settings.getSetting('ocr_model') === '') throw new UnprocessableEntityException('Set the AI model under Settings so the reader can run.');
      try {
        await this.images.loadReceiptSource(receipt.imagePath);
      } catch {
        throw new UnprocessableEntityException('This bill is no longer on disk. Upload it again from Receipts.');
      }
      try {
        this.receipts.requeueReceipt(receiptId);
      } catch {
        throw new UnprocessableEntityException('Could not start reading again.');
      }
    }
    this.queue.enqueueOCR(receiptId);
    return AdminReceiptIdResponse.parse({ id: receiptId });
  }

  confirm(receiptId: number, body: Record<string, string>): AdminReceiptConfirmedResponse {
    const receipt = this.load(receiptId);
    const lookups = this.lookups();
    const get = (name: string) => (body[name] ?? '').trim();
    let { inn, view, msg } = parseReceiptForm(get, lookups.products);
    view.receiptId = receiptId;
    view.imagePath = receipt.imagePath ?? '';
    view.status = receipt.status;
    view.storeId = knownStoreID(view.storeId, lookups.stores);
    inn.storeId = view.storeId;
    view = decorateReceiptView(view);
    let rawJSON = '';
    try {
      rawJSON = viewToRawJSON(view);
      this.receipts.updateReceiptJSON(receiptId, rawJSON);
    } catch {
      throw new InternalServerErrorException('Could not save the product list.');
    }
    const review = () => ({
      view,
      products: lookups.products,
      units: lookups.units,
      stores: lookups.stores.map(presentStore),
      symbol: this.config.get<string>('CURRENCY_SYMBOL') || 'zł',
      currency: this.config.get<string>('CURRENCY') || 'PLN',
    });
    if (receipt.status === RECEIPT_MIGRATED) throw new ConflictException('This bill is already saved as purchases.');
    if (view.storeId === 0 && Number.parseInt(body.store_id ?? '', 10) > 0) throw new UnprocessableEntityException({ message: 'Choose a store.', ...review() });
    if (msg !== '') throw new UnprocessableEntityException({ message: msg, ...review() });
    try {
      const result = this.receipts.migrateReceipt(receiptId, inn, rawJSON);
      return AdminReceiptConfirmedResponse.parse({ id: receiptId, imported: result.purchases });
    } catch (err) {
      let message = 'Could not save the purchases.';
      if (err instanceof ReceiptMigratedError) message = 'This bill is already saved as purchases.';
      else if (err instanceof ReceiptNotReadyError) message = 'This scan has no product list yet.';
      else if (err instanceof InvalidUnitError) message = 'Choose a unit for each new product.';
      else if (err instanceof NotFoundError) message = 'A selected product is gone. Refresh and try again.';
      else if (err instanceof InvalidStoreError) message = 'Choose a store.';
      throw new UnprocessableEntityException({ message, ...review() });
    }
  }

  async remove(receiptId: number): Promise<AdminReceiptDeletedResponse> {
    const deleted = this.receipts.deleteReceipt(receiptId);
    await this.images.deleteReceiptFiles(deleted.imagePath);
    for (const image of deleted.productImages) this.catalogImages.deleteImage(image);
    return AdminReceiptDeletedResponse.parse({ ok: true });
  }

  private load(receiptId: number): Receipt {
    return this.receipts.getReceipt(receiptId);
  }

  private lookups(): { products: ProductListItem[]; units: Unit[]; stores: Store[] } {
    return {
      products: this.products.listProducts(''),
      units: this.units.listUnits(),
      stores: this.locations.listStores(),
    };
  }

  private resolveStore(storeId: number): { id: number; msg: string } {
    if (storeId <= 0) return { id: 0, msg: '' };
    try {
      this.locations.getStore(storeId);
      return { id: storeId, msg: '' };
    } catch (err) {
      if (err instanceof NotFoundError) return { id: 0, msg: 'Choose a store.' };
      return { id: 0, msg: 'Could not load the store.' };
    }
  }

  private async acceptBill(file: Express.Multer.File): Promise<Receipt> {
    if (file.size > MaxImageBytes || file.buffer.length > MaxImageBytes) throw new UnprocessableEntityException('File must be 10 MB or smaller.');
    if (file.buffer.length === 0) throw new UnprocessableEntityException('Could not read the file.');
    let jpeg: Buffer;
    try {
      jpeg = await previewJPEG(file.buffer);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      throw new UnprocessableEntityException(text.replace(/\.$/, '') + '.');
    }
    let imagePath: string;
    try {
      imagePath = await this.images.saveReceiptFiles(file.buffer, jpeg);
    } catch {
      throw new InternalServerErrorException('Could not store the bill.');
    }
    try {
      return this.receipts.createReceipt(imagePath);
    } catch {
      await this.images.deleteReceiptFiles(imagePath);
      throw new InternalServerErrorException('Could not save the receipt.');
    }
  }
}

function presentDuplicateGroup(group: ReceiptDuplicateGroup) {
  return {
    shopName: group.shopName,
    boughtOn: group.boughtOn,
    count: group.receipts.length,
    receipts: group.receipts.map(presentReceiptListItem),
  };
}

function pickFormFile(
  files: { bill?: Express.Multer.File[]; bill_camera?: Express.Multer.File[] } | undefined,
  ...names: ('bill' | 'bill_camera')[]
): Express.Multer.File | null {
  if (!files) return null;
  for (const name of names) {
    const file = files[name]?.[0];
    if (file && (file.originalname !== '' || file.size > 0)) return file;
  }
  return null;
}
