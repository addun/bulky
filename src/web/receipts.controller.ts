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
  InvalidStoryError,
  InvalidUnitError,
  NotFoundError,
  ReceiptMigratedError,
  ReceiptNotReadyError,
} from '../domain/errors';
import { boughtOnTime, joinBoughtOn, normalizeBoughtOn } from '../domain/bought-on';
import { MaxImageBytes } from '../ocr/types';
import { previewJPEG } from '../ocr/format';
import { OcrService } from '../ocr/ocr.service';
import { AliasesRepository } from '@app/store/aliases';
import { LocationsRepository, type Story } from '@app/store/locations';
import { ProductsRepository, type ProductListItem } from '@app/store/products';
import { PurchasesRepository } from '@app/store/purchases';
import {
  RECEIPT_FAILED,
  RECEIPT_MIGRATED,
  RECEIPT_PENDING,
  ReceiptsRepository,
  type Receipt,
} from '@app/store/receipts';
import { UnitsRepository, type Unit } from '@app/store/units';
import { OcrQueueService } from './ocr-queue.service';
import { presentReceipt, presentStory } from './present';
import {
  knownStoryID,
  parseReceiptForm,
  receiptToView,
  receiptVisitFacts,
  storyByID,
  viewToRawJSON,
  decorateReceiptView,
  type ReceiptView,
} from './receipt-form';
import { ReceiptImagesService } from './receipt-images';
import { ViewsService } from './views.service';
import { field, flashQuery, formBody, id, optInt, receiptShowQuery, receiptVisitForm } from './schema';

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
    @Body({ schema: receiptVisitForm }) body: { bought_on: string; bought_at: string; story_id: number },
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
    const joined = joinBoughtOn(body.bought_on, body.bought_at);
    const { id: storyID, msg } = this.resolveStoryForm(body.story_id);
    let boughtOn: string;
    try {
      boughtOn = normalizeBoughtOn(joined);
    } catch {
      this.renderReceiptEdit(res, 422, receipt, joined, storyID, 'Date must be a valid day.');
      return;
    }
    if (msg !== '') {
      this.renderReceiptEdit(res, 422, receipt, boughtOn, storyID, msg);
      return;
    }
    try {
      this.receiptsStore.updateReceiptVisit(receiptId, storyID, boughtOn);
    } catch (err) {
      if (err instanceof ReceiptNotReadyError) {
        this.views.redirect(res, '/admin/receipts/' + String(receiptId));
        return;
      }
      const errMsg = err instanceof InvalidStoryError ? 'Choose a store.' : 'Could not save the visit.';
      this.renderReceiptEdit(res, 422, receipt, boughtOn, storyID, errMsg);
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
    let stories: Story[];
    try {
      ({ products, units, stories } = this.receiptLookups());
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
      view = receiptToView(receipt, products, stories, aliases, defaults);
    } catch {
      this.renderReceipts(res, 500, 'Could not read the saved AI response.');
      return;
    }
    this.renderReceiptReview(res, 200, view, products, units, stories, query.error);
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
    let stories: Story[];
    try {
      ({ products, units, stories } = this.receiptLookups());
    } catch {
      this.views.text(res, 500, 'could not load the catalog');
      return;
    }
    const get = (name: string) => field.parse(body[name]);
    let { inn, view, msg } = parseReceiptForm(get, products);
    view.receiptId = receiptId;
    view.imagePath = receipt.imagePath ?? '';
    view.status = receipt.status;
    view.storyId = knownStoryID(view.storyId, stories);
    inn.storyId = view.storyId;
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
    if (view.storyId === 0 && optInt.parse(body.story_id) > 0) {
      this.renderReceiptReview(res, 422, view, products, units, stories, 'Choose a store.');
      return;
    }
    if (msg !== '') {
      this.renderReceiptReview(res, 422, view, products, units, stories, msg);
      return;
    }
    if (jsonErr !== null) {
      this.renderReceiptReview(res, 500, view, products, units, stories, 'Could not save the product list.');
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
      else if (err instanceof InvalidStoryError) errMsg = 'Choose a store.';
      this.renderReceiptReview(res, 422, view, products, units, stories, errMsg);
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
    let list: Receipt[];
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
      receipts: list.map(presentReceipt),
    });
  }

  private renderReceiptReview(
    res: Response,
    status: number,
    view: ReceiptView,
    products: ProductListItem[],
    units: Unit[],
    stories: Story[],
    errMsg: string,
  ): void {
    this.views.html(res, 'receipt_review', status, {
      page: this.views.adminPage('Confirm bill', '', errMsg),
      view: view,
      products: products,
      units: units,
      stories: stories.map(presentStory),
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
    let stories: Story[];
    try {
      stories = this.locations.listStories();
    } catch {
      this.views.text(res, 500, 'could not load stores');
      return;
    }
    let { boughtOn, boughtAt, notes, story } = receiptVisitFacts(receipt, buys, stories);
    if (boughtAt === '') boughtAt = boughtOnTime(boughtOn);
    boughtOn = joinBoughtOn(boughtOn, boughtAt);
    this.views.html(res, 'receipt_show', status, {
      page: this.views.adminPage('Receipt', '', errMsg),
      receipt: presentReceipt(receipt),
      purchases: buys,
      boughtOn: boughtOn,
      boughtAt: boughtAt,
      notes: notes,
      story: presentStory(story),
      imported: imported,
    });
  }

  private renderReceiptEdit(
    res: Response,
    status: number,
    receipt: Receipt,
    boughtOn: string,
    storyID: number,
    errMsg: string,
  ): void {
    let buys;
    try {
      buys = this.purchases.listPurchasesByReceipt(receipt.id);
    } catch {
      this.views.text(res, 500, 'could not load purchases');
      return;
    }
    let stories: Story[];
    try {
      stories = this.locations.listStories();
    } catch {
      this.views.text(res, 500, 'could not load stores');
      return;
    }
    let boughtAt = '';
    if (boughtOn === '' && storyID === 0) {
      const facts = receiptVisitFacts(receipt, buys, stories);
      boughtOn = facts.boughtOn;
      boughtAt = facts.boughtAt;
      storyID = facts.story.id;
    } else {
      boughtAt = receiptVisitFacts(receipt, buys, stories).boughtAt;
    }
    if (boughtAt === '') boughtAt = boughtOnTime(boughtOn);
    boughtOn = joinBoughtOn(boughtOn, boughtAt);
    this.views.html(res, 'receipt_edit', status, {
      page: this.views.adminPage('Edit visit', '', errMsg),
      receipt: presentReceipt(receipt),
      boughtOn: boughtOn,
      boughtAt: boughtAt,
      story: presentStory(storyByID(stories, storyID)),
      stories: stories.map(presentStory),
    });
  }

  private receiptLookups(): { products: ProductListItem[]; units: Unit[]; stories: Story[] } {
    return {
      products: this.products.listProducts(''),
      units: this.units.listUnits(),
      stories: this.locations.listStories(),
    };
  }

  private resolveStoryForm(storyId: number): { id: number; msg: string } {
    if (storyId <= 0) return { id: 0, msg: '' };
    try {
      this.locations.getStory(storyId);
      return { id: storyId, msg: '' };
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

