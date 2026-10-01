import { HttpException, Injectable } from '@nestjs/common';
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
import { asResponse, problem } from '../http.js';
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
    return asResponse(AdminReceiptsResponse, {
      configured: this.ocr.configured(),
      model: this.settings.getSetting('ocr_model'),
      receipts: this.receipts.listReceipts().map(presentReceiptListItem),
    });
  }

  duplicates(): AdminReceiptDuplicatesResponse {
    return asResponse(AdminReceiptDuplicatesResponse, {
      groups: this.receipts.listDuplicateReceipts().map(presentDuplicateGroup),
    });
  }

  async upload(files: { bill?: Express.Multer.File[]; bill_camera?: Express.Multer.File[] }): Promise<AdminReceiptIdResponse> {
    if (!this.ocr.configured()) problem(422, 'Set OCR_API_KEY or OCR_BASE_URL so the reader can run.');
    const model = this.settings.getSetting('ocr_model');
    if (model === '') problem(422, 'Set the AI model under Settings so the reader can run.');
    const file = pickFormFile(files, 'bill', 'bill_camera');
    if (!file) problem(422, 'Choose a photo or a PDF of the bill.');
    const accepted = await this.acceptBill(file);
    this.queue.enqueueOCR(accepted.id);
    return asResponse(AdminReceiptIdResponse, { id: accepted.id });
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
      return asResponse(AdminReceiptDetailResponse, { kind: 'status' as const, receipt: presentReceipt(receipt) });
    }
    if (receipt.status === RECEIPT_MIGRATED) {
      const buys = this.purchases.listPurchasesByReceipt(receipt.id);
      const stores = this.locations.listStores();
      const facts = receiptVisitFacts(receipt, buys, stores);
      return asResponse(AdminReceiptDetailResponse, {
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
      problem(500, 'Could not read the saved AI response.');
    }
    return asResponse(AdminReceiptDetailResponse, {
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
    if (receipt.status !== RECEIPT_MIGRATED) problem(409, 'This receipt is not saved as purchases yet.');
    const buys = this.purchases.listPurchasesByReceipt(receipt.id);
    const stores = this.locations.listStores();
    const facts = receiptVisitFacts(receipt, buys, stores);
    return asResponse(AdminReceiptEditResponse, {
      receipt: presentReceipt(receipt),
      boughtOn: facts.boughtOn,
      store: presentStore(facts.store),
      stores: stores.map(presentStore),
    });
  }

  updateVisit(receiptId: number, body: z.infer<typeof ReceiptVisitRequest>): AdminReceiptIdResponse {
    const receipt = this.load(receiptId);
    if (receipt.status !== RECEIPT_MIGRATED) problem(409, 'This receipt is not saved as purchases yet.');
    const boughtOn = fromDatetimeLocal(body.bought_on);
    if (boughtOn === '') problem(422, 'Date must be a valid day.');
    const store = this.resolveStore(body.store_id);
    if (store.msg) problem(422, store.msg);
    this.receipts.updateReceiptVisit(receiptId, store.id, boughtOn);
    return asResponse(AdminReceiptIdResponse, { id: receiptId });
  }

  async retry(receiptId: number): Promise<AdminReceiptIdResponse> {
    const receipt = this.load(receiptId);
    if (receipt.status !== RECEIPT_FAILED && receipt.status !== RECEIPT_PENDING) {
      return asResponse(AdminReceiptIdResponse, { id: receiptId });
    }
    if (receipt.status === RECEIPT_FAILED) {
      if (!this.ocr.configured()) problem(422, 'Set OCR_API_KEY or OCR_BASE_URL so the reader can run.');
      if (this.settings.getSetting('ocr_model') === '') problem(422, 'Set the AI model under Settings so the reader can run.');
      try {
        await this.images.loadReceiptSource(receipt.imagePath);
      } catch {
        problem(422, 'This bill is no longer on disk. Upload it again from Receipts.');
      }
      try {
        this.receipts.requeueReceipt(receiptId);
      } catch {
        problem(422, 'Could not start reading again.');
      }
    }
    this.queue.enqueueOCR(receiptId);
    return asResponse(AdminReceiptIdResponse, { id: receiptId });
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
      problem(500, 'Could not save the product list.');
    }
    const review = () => ({
      view,
      products: lookups.products,
      units: lookups.units,
      stores: lookups.stores.map(presentStore),
      symbol: this.config.get<string>('CURRENCY_SYMBOL') || 'zł',
      currency: this.config.get<string>('CURRENCY') || 'PLN',
    });
    if (receipt.status === RECEIPT_MIGRATED) problem(409, 'This bill is already saved as purchases.');
    if (view.storeId === 0 && Number.parseInt(body.store_id ?? '', 10) > 0) throw new HttpException({ message: 'Choose a store.', ...review() }, 422);
    if (msg !== '') throw new HttpException({ message: msg, ...review() }, 422);
    try {
      const result = this.receipts.migrateReceipt(receiptId, inn, rawJSON);
      return asResponse(AdminReceiptConfirmedResponse, { id: receiptId, imported: result.purchases });
    } catch (err) {
      let message = 'Could not save the purchases.';
      if (err instanceof ReceiptMigratedError) message = 'This bill is already saved as purchases.';
      else if (err instanceof ReceiptNotReadyError) message = 'This scan has no product list yet.';
      else if (err instanceof InvalidUnitError) message = 'Choose a unit for each new product.';
      else if (err instanceof NotFoundError) message = 'A selected product is gone. Refresh and try again.';
      else if (err instanceof InvalidStoreError) message = 'Choose a store.';
      throw new HttpException({ message, ...review() }, 422);
    }
  }

  async remove(receiptId: number): Promise<AdminReceiptDeletedResponse> {
    const deleted = this.receipts.deleteReceipt(receiptId);
    await this.images.deleteReceiptFiles(deleted.imagePath);
    for (const image of deleted.productImages) this.catalogImages.deleteImage(image);
    return asResponse(AdminReceiptDeletedResponse, { ok: true });
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
    if (file.size > MaxImageBytes || file.buffer.length > MaxImageBytes) problem(422, 'File must be 10 MB or smaller.');
    if (file.buffer.length === 0) problem(422, 'Could not read the file.');
    let jpeg: Buffer;
    try {
      jpeg = await previewJPEG(file.buffer);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      problem(422, text.replace(/\.$/, '') + '.');
    }
    let imagePath: string;
    try {
      imagePath = await this.images.saveReceiptFiles(file.buffer, jpeg);
    } catch {
      problem(500, 'Could not store the bill.');
    }
    try {
      return this.receipts.createReceipt(imagePath);
    } catch {
      await this.images.deleteReceiptFiles(imagePath);
      problem(500, 'Could not save the receipt.');
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
