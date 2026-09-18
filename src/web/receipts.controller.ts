import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  InvalidStoreError,
  InvalidUnitError,
  NotFoundError,
  ReceiptMigratedError,
  ReceiptNotReadyError,
} from '../domain/errors.js';
import { fromDatetimeLocal } from '../domain/bought-on.js';
import { MaxImageBytes } from '../ocr/types.js';
import { previewJPEG } from '../ocr/format.js';
import { OcrService } from '../ocr/ocr.service.js';
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
  type ReceiptListItem,
} from '#app/store/receipts';
import { UnitsRepository, type Unit } from '#app/store/units';
import { OcrQueueService } from './ocr-queue.service.js';
import { presentReceipt, presentReceiptListItem, presentStore } from './present.js';
import {
  knownStoreID,
  parseReceiptForm,
  receiptToView,
  receiptVisitFacts,
  storeByID,
  viewToRawJSON,
  decorateReceiptView,
  type ReceiptView,
} from './receipt-form.js';
import { ImagesService } from './images.service.js';
import { ReceiptImagesService } from './receipt-images.js';
import { ViewsService } from './views.service.js';
import { field, flashQuery, formBody, id, optInt, receiptShowQuery, receiptVisitForm } from './schema.js';

@Controller('admin/receipts')
export class ReceiptsController {
  constructor(
    private readonly receiptsStore: ReceiptsRepository,
    private readonly units: UnitsRepository,
    private readonly locations: LocationsRepository,
    private readonly products: ProductsRepository,
    private readonly aliases: AliasesRepository,
    private readonly purchases: PurchasesRepository,
    private readonly views: ViewsService,
    private readonly ocr: OcrService,
    private readonly queue: OcrQueueService,
    private readonly images: ReceiptImagesService,
    private readonly catalogImages: ImagesService,
  ) {}

  @Get()
  receipts(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    this.renderReceipts(res, 200, query.error);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'bill', maxCount: 1 },
        { name: 'bill_camera', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 12 << 20 } },
    ),
  )
  async scanReceipt(
    @Res() res: Response,
    @UploadedFiles() files: { bill?: Express.Multer.File[]; bill_camera?: Express.Multer.File[] },
  ): Promise<void> {
    if (!this.ocr.configured()) {
      this.views.redirect(
        res,
        '/admin/receipts?error=' + encodeURIComponent('Set OCR_API_KEY or OCR_BASE_URL so the reader can run.'),
      );
      return;
    }
    let model: string;
    try {
      model = this.units.ocrModel();
    } catch {
      this.renderReceipts(res, 500, 'Could not load settings.');
      return;
    }
    if (model === '') {
      this.views.redirect(
        res,
        '/admin/receipts?error=' + encodeURIComponent('Set the AI model under Admin so the reader can run.'),
      );
      return;
    }
    const fh = pickFormFile(files, 'bill', 'bill_camera');
    if (!fh) {
      this.renderReceipts(res, 422, 'Choose a photo or a PDF of the bill.');
      return;
    }
    const { receipt, msg, status } = await this.acceptBillUpload(fh);
    if (msg !== '') {
      this.renderReceipts(res, status, msg);
      return;
    }
    this.queue.enqueueOCR(receipt.id);
    this.views.redirect(res, '/admin/receipts/' + String(receipt.id));
  }

  @Get(':id/preview')
  receiptPreview(@Param('id', { schema: id }) receiptId: number, @Res() res: Response): void {
    let receipt: Receipt;
    try {
      receipt = this.receiptsStore.getReceipt(receiptId);
    } catch {
      res.status(404).end();
      return;
    }
    const path = this.images.receiptImagePath(receipt.imagePath);
    if (!receipt.imagePath || !path || !this.images.previewExists(receipt.imagePath)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path);
  }

  @Get(':id/edit')
  editReceipt(
    @Param('id', { schema: id }) receiptId: number,
    @Query({ schema: flashQuery }) query: { error: string },
    @Res() res: Response,
  ): void {
    let receipt: Receipt;
    try {
      receipt = this.receiptsStore.getReceipt(receiptId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.status !== RECEIPT_MIGRATED) {
      this.views.redirect(res, '/admin/receipts/' + String(receiptId));
      return;
    }
    this.renderReceiptEdit(res, 200, receipt, '', 0, query.error);
  }

  @Post(':id/edit')
  updateReceiptVisit(
    @Param('id', { schema: id }) receiptId: number,
    @Body({ schema: receiptVisitForm }) body: { bought_on: string; store_id: number },
    @Res() res: Response,
  ): void {
    let receipt: Receipt;
    try {
      receipt = this.receiptsStore.getReceipt(receiptId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.status !== RECEIPT_MIGRATED) {
      this.views.redirect(res, '/admin/receipts/' + String(receiptId));
      return;
    }
    const joined = fromDatetimeLocal(body.bought_on);
    const { id: storeID, msg } = this.resolveStoreForm(body.store_id);
    if (joined === '') {
      this.renderReceiptEdit(res, 422, receipt, joined, storeID, 'Date must be a valid day.');
      return;
    }
    if (msg !== '') {
      this.renderReceiptEdit(res, 422, receipt, joined, storeID, msg);
      return;
    }
    try {
      this.receiptsStore.updateReceiptVisit(receiptId, storeID, joined);
    } catch (err) {
      if (err instanceof ReceiptNotReadyError) {
        this.views.redirect(res, '/admin/receipts/' + String(receiptId));
        return;
      }
      const errMsg = err instanceof InvalidStoreError ? 'Choose a store.' : 'Could not save the visit.';
      this.renderReceiptEdit(res, 422, receipt, joined, storeID, errMsg);
      return;
    }
    this.views.redirect(res, '/admin/receipts/' + String(receiptId));
  }

  @Post(':id/retry')
  async retryReceipt(@Param('id', { schema: id }) receiptId: number, @Res() res: Response): Promise<void> {
    let receipt: Receipt;
    try {
      receipt = this.receiptsStore.getReceipt(receiptId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.status !== RECEIPT_FAILED && receipt.status !== RECEIPT_PENDING) {
      this.views.redirect(res, '/admin/receipts/' + String(receiptId));
      return;
    }
    if (receipt.status === RECEIPT_FAILED) {
      if (!this.ocr.configured()) {
        this.views.redirect(
          res,
          '/admin/receipts/' +
            String(receiptId) +
            '?error=' +
            encodeURIComponent('Set OCR_API_KEY or OCR_BASE_URL so the reader can run.'),
        );
        return;
      }
      let model: string;
      try {
        model = this.units.ocrModel();
      } catch {
        this.views.redirect(
          res,
          '/admin/receipts/' + String(receiptId) + '?error=' + encodeURIComponent('Could not load settings.'),
        );
        return;
      }
      if (model === '') {
        this.views.redirect(
          res,
          '/admin/receipts/' +
            String(receiptId) +
            '?error=' +
            encodeURIComponent('Set the AI model under Admin so the reader can run.'),
        );
        return;
      }
      try {
        await this.images.loadReceiptSource(receipt.imagePath);
      } catch {
        this.views.redirect(
          res,
          '/admin/receipts/' +
            String(receiptId) +
            '?error=' +
            encodeURIComponent('This bill is no longer on disk. Upload it again from Receipts.'),
        );
        return;
      }
      try {
        this.receiptsStore.requeueReceipt(receiptId);
      } catch {
        this.views.redirect(
          res,
          '/admin/receipts/' + String(receiptId) + '?error=' + encodeURIComponent('Could not start reading again.'),
        );
        return;
      }
    }
    this.queue.enqueueOCR(receiptId);
    this.views.redirect(res, '/admin/receipts/' + String(receiptId));
  }

  @Get(':id/delete')
  confirmDeleteReceipt(@Param('id', { schema: id }) receiptId: number, @Res() res: Response): void {
    let receipt: Receipt;
    try {
      receipt = this.receiptsStore.getReceipt(receiptId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    const body =
      receipt.status === RECEIPT_MIGRATED
        ? 'This removes the receipt and every purchase saved from this bill. Products with no other buys left are removed too.'
        : 'This removes the scan and the stored photo. Nothing has been saved as purchases yet.';
    this.views.html(res, 'confirm', 200, {
      page: this.views.adminPage('Delete receipt', '', ''),
      title: 'Delete this receipt?',
      body,
      action: `/admin/receipts/${receiptId}/delete`,
      cancel: `/admin/receipts/${receiptId}`,
      confirm: 'Delete receipt',
    });
  }

  @Post(':id/delete')
  async deleteReceipt(@Param('id', { schema: id }) receiptId: number, @Res() res: Response): Promise<void> {
    let imagePath: string | null;
    let productImages: string[];
    try {
      ({ imagePath, productImages } = this.receiptsStore.deleteReceipt(receiptId));
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not delete the receipt');
      return;
    }
    await this.images.deleteReceiptFiles(imagePath);
    for (const img of productImages) this.catalogImages.deleteImage(img);
    this.views.redirect(res, '/admin/receipts');
  }

  @Get(':id')
  showReceipt(
    @Param('id', { schema: id }) receiptId: number,
    @Query({ schema: receiptShowQuery }) query: { error: string; imported: number },
    @Res() res: Response,
  ): void {
    let receipt: Receipt;
    try {
      receipt = this.receiptsStore.getReceipt(receiptId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.status === RECEIPT_PENDING || receipt.status === RECEIPT_FAILED) {
      this.renderReceiptStatus(res, 200, receipt, query.error);
      return;
    }
    if (receipt.status === RECEIPT_MIGRATED) {
      this.renderReceiptShow(res, 200, receipt, query.error, query.imported);
      return;
    }
    let products: ProductListItem[];
    let units: Unit[];
    let stores: Store[];
    try {
      ({ products, units, stores } = this.receiptLookups());
    } catch {
      this.views.text(res, 500, 'could not load the catalog');
      return;
    }
    let aliases;
    try {
      aliases = this.aliases.listAliases();
    } catch {
      this.views.text(res, 500, 'could not load aliases');
      return;
    }
    let defaults;
    try {
      defaults = this.units.unitDefaults();
    } catch {
      this.views.text(res, 500, 'could not load settings');
      return;
    }
    let view: ReceiptView;
    try {
      view = receiptToView(receipt, products, stores, aliases, defaults);
    } catch {
      this.renderReceipts(res, 500, 'Could not read the saved AI response.');
      return;
    }
    this.renderReceiptReview(res, 200, view, products, units, stores, query.error);
  }

  @Post(':id')
  confirmReceipt(
    @Param('id', { schema: id }) receiptId: number,
    @Body({ schema: formBody }) body: Record<string, unknown>,
    @Res() res: Response,
  ): void {
    let receipt: Receipt;
    try {
      receipt = this.receiptsStore.getReceipt(receiptId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    let products: ProductListItem[];
    let units: Unit[];
    let stores: Store[];
    try {
      ({ products, units, stores } = this.receiptLookups());
    } catch {
      this.views.text(res, 500, 'could not load the catalog');
      return;
    }
    const get = (name: string) => field.parse(body[name]);
    let { inn, view, msg } = parseReceiptForm(get, products);
    view.receiptId = receiptId;
    view.imagePath = receipt.imagePath ?? '';
    view.status = receipt.status;
    view.storeId = knownStoreID(view.storeId, stores);
    inn.storeId = view.storeId;
    view = decorateReceiptView(view);
    let rawJSON = '';
    let jsonErr: unknown = null;
    try {
      rawJSON = viewToRawJSON(view);
    } catch (err) {
      jsonErr = err;
    }
    if (jsonErr === null) {
      try {
        this.receiptsStore.updateReceiptJSON(receiptId, rawJSON);
      } catch {
        /* ignore */
      }
    }
    if (receipt.status === RECEIPT_MIGRATED) {
      this.renderReceiptShow(res, 409, receipt, 'This bill is already saved as purchases.', 0);
      return;
    }
    if (view.storeId === 0 && optInt.parse(body.store_id) > 0) {
      this.renderReceiptReview(res, 422, view, products, units, stores, 'Choose a store.');
      return;
    }
    if (msg !== '') {
      this.renderReceiptReview(res, 422, view, products, units, stores, msg);
      return;
    }
    if (jsonErr !== null) {
      this.renderReceiptReview(res, 500, view, products, units, stores, 'Could not save the product list.');
      return;
    }
    try {
      const result = this.receiptsStore.migrateReceipt(receiptId, inn, rawJSON);
      this.views.redirect(res, '/admin/receipts/' + String(receiptId) + '?imported=' + String(result.purchases));
    } catch (err) {
      let errMsg = 'Could not save the purchases.';
      if (err instanceof ReceiptMigratedError) errMsg = 'This bill is already saved as purchases.';
      else if (err instanceof ReceiptNotReadyError) errMsg = 'This scan has no product list yet.';
      else if (err instanceof InvalidUnitError) errMsg = 'Choose a unit for each new product.';
      else if (err instanceof NotFoundError) errMsg = 'A selected product is gone. Refresh and try again.';
      else if (err instanceof InvalidStoreError) errMsg = 'Choose a store.';
      this.renderReceiptReview(res, 422, view, products, units, stores, errMsg);
    }
  }

  private async acceptBillUpload(
    fh: Express.Multer.File,
  ): Promise<{ receipt: Receipt; msg: string; status: number }> {
    if (fh.size > MaxImageBytes || fh.buffer.length > MaxImageBytes) {
      return { receipt: emptyReceipt(), msg: 'File must be 10 MB or smaller.', status: 422 };
    }
    const raw = fh.buffer;
    if (raw.length === 0) {
      return { receipt: emptyReceipt(), msg: 'Could not read the file.', status: 422 };
    }
    let jpeg: Buffer;
    try {
      jpeg = await previewJPEG(raw);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return { receipt: emptyReceipt(), msg: text.replace(/\.$/, '') + '.', status: 422 };
    }
    let imagePath: string;
    try {
      imagePath = await this.images.saveReceiptFiles(raw, jpeg);
    } catch {
      return { receipt: emptyReceipt(), msg: 'Could not store the bill.', status: 500 };
    }
    try {
      const receipt = this.receiptsStore.createReceipt(imagePath);
      return { receipt, msg: '', status: 0 };
    } catch {
      await this.images.deleteReceiptFiles(imagePath);
      return { receipt: emptyReceipt(), msg: 'Could not save the receipt.', status: 500 };
    }
  }

  private renderReceipts(res: Response, status: number, errMsg: string): void {
    let list: ReceiptListItem[];
    try {
      list = this.receiptsStore.listReceipts();
    } catch {
      this.views.text(res, 500, 'could not load receipts');
      return;
    }
    let model: string;
    try {
      model = this.units.ocrModel();
    } catch {
      this.views.text(res, 500, 'could not load settings');
      return;
    }
    this.views.html(res, 'receipts', status, {
      page: this.views.adminPage('Receipts', '', errMsg),
      configured: this.ocr.configured(),
      model: model,
      receipts: list.map(presentReceiptListItem),
    });
  }

  private renderReceiptReview(
    res: Response,
    status: number,
    view: ReceiptView,
    products: ProductListItem[],
    units: Unit[],
    stores: Store[],
    errMsg: string,
  ): void {
    this.views.html(res, 'receipt_review', status, {
      page: this.views.adminPage('Confirm bill', '', errMsg),
      view: view,
      products: products,
      units: units,
      stores: stores.map(presentStore),
    });
  }

  private renderReceiptStatus(res: Response, status: number, receipt: Receipt, errMsg: string): void {
    const reading = receipt.status === RECEIPT_PENDING;
    this.views.html(res, 'receipt_status', status, {
      page: this.views.adminPage('Receipt', '', errMsg, reading ? 3 : 0),
      receipt: presentReceipt(receipt),
    });
  }

  private renderReceiptShow(res: Response, status: number, receipt: Receipt, errMsg: string, imported: number): void {
    let buys;
    try {
      buys = this.purchases.listPurchasesByReceipt(receipt.id);
    } catch {
      this.views.text(res, 500, 'could not load purchases');
      return;
    }
    let stores: Store[];
    try {
      stores = this.locations.listStores();
    } catch {
      this.views.text(res, 500, 'could not load stores');
      return;
    }
    const { boughtOn, notes, store } = receiptVisitFacts(receipt, buys, stores);
    this.views.html(res, 'receipt_show', status, {
      page: this.views.adminPage('Receipt', '', errMsg),
      receipt: presentReceipt(receipt),
      purchases: buys,
      boughtOn: boughtOn,
      notes: notes,
      store: presentStore(store),
      imported: imported,
    });
  }

  private renderReceiptEdit(
    res: Response,
    status: number,
    receipt: Receipt,
    boughtOn: string,
    storeID: number,
    errMsg: string,
  ): void {
    let buys;
    try {
      buys = this.purchases.listPurchasesByReceipt(receipt.id);
    } catch {
      this.views.text(res, 500, 'could not load purchases');
      return;
    }
    let stores: Store[];
    try {
      stores = this.locations.listStores();
    } catch {
      this.views.text(res, 500, 'could not load stores');
      return;
    }
    if (boughtOn === '' && storeID === 0) {
      const facts = receiptVisitFacts(receipt, buys, stores);
      boughtOn = facts.boughtOn;
      storeID = facts.store.id;
    }
    this.views.html(res, 'receipt_edit', status, {
      page: this.views.adminPage('Edit visit', '', errMsg),
      receipt: presentReceipt(receipt),
      boughtOn: boughtOn,
      store: presentStore(storeByID(stores, storeID)),
      stores: stores.map(presentStore),
    });
  }

  private receiptLookups(): { products: ProductListItem[]; units: Unit[]; stores: Store[] } {
    return {
      products: this.products.listProducts(''),
      units: this.units.listUnits(),
      stores: this.locations.listStores(),
    };
  }

  private resolveStoreForm(storeId: number): { id: number; msg: string } {
    if (storeId <= 0) return { id: 0, msg: '' };
    try {
      this.locations.getStore(storeId);
      return { id: storeId, msg: '' };
    } catch (err) {
      if (err instanceof NotFoundError) return { id: 0, msg: 'Choose a store.' };
      return { id: 0, msg: 'Could not load the store.' };
    }
  }
}

function pickFormFile(
  files: { bill?: Express.Multer.File[]; bill_camera?: Express.Multer.File[] } | undefined,
  ...names: ('bill' | 'bill_camera')[]
): Express.Multer.File | null {
  if (!files) return null;
  for (const name of names) {
    const fh = files[name]?.[0];
    if (fh && (fh.originalname !== '' || fh.size > 0)) return fh;
  }
  return null;
}

function emptyReceipt(): Receipt {
  return {
    id: 0,
    imagePath: null,
    rawResponse: '',
    status: '',
    errorMessage: '',
    createdAt: '',
    source: '',
    externalId: '',
    sourcePayload: '',
  };
}

