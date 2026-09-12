import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import {
  InvalidStoryError,
  InvalidUnitError,
  NotFoundError,
  ReceiptMigratedError,
  ReceiptNotReadyError,
} from '../domain/errors';
import { RECEIPT_FAILED, RECEIPT_MIGRATED, RECEIPT_PENDING, type ProductListItem, type Receipt, type Story, type Unit } from '../domain/types';
import { boughtOnTime, joinBoughtOn, normalizeBoughtOn } from '../domain/bought-on';
import { MaxImageBytes } from '../ocr/types';
import { previewJPEG } from '../ocr/format';
import { OcrService } from '../ocr/ocr.service';
import { StoreService } from '../store/store.service';
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

@Controller('admin/receipts')
export class ReceiptsController {
  constructor(
    private readonly store: StoreService,
    private readonly views: ViewsService,
    private readonly ocr: OcrService,
    private readonly queue: OcrQueueService,
    private readonly images: ReceiptImagesService,
  ) {}

  @Get()
  receipts(@Req() req: Request, @Res() res: Response): void {
    this.renderReceipts(res, 200, String(req.query.error ?? ''));
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
    @Req() req: Request,
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
      model = this.store.ocrModel();
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
    this.queue.enqueueOCR(receipt.ID);
    this.views.redirect(res, '/admin/receipts/' + String(receipt.ID));
  }

  @Get(':id/preview')
  receiptPreview(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      res.status(404).end();
      return;
    }
    let receipt: Receipt;
    try {
      receipt = this.store.getReceipt(id);
    } catch {
      res.status(404).end();
      return;
    }
    const path = this.images.receiptImagePath(receipt.ImagePath);
    if (!path || !this.images.previewExists(receipt.ImagePath)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path);
  }

  @Get(':id/edit')
  editReceipt(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      this.views.text(res, 404, 'not found');
      return;
    }
    let receipt: Receipt;
    try {
      receipt = this.store.getReceipt(id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.Status !== RECEIPT_MIGRATED) {
      this.views.redirect(res, '/admin/receipts/' + String(id));
      return;
    }
    this.renderReceiptEdit(res, 200, receipt, '', 0, String(req.query.error ?? ''));
  }

  @Post(':id/edit')
  updateReceiptVisit(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      this.views.text(res, 404, 'not found');
      return;
    }
    let receipt: Receipt;
    try {
      receipt = this.store.getReceipt(id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.Status !== RECEIPT_MIGRATED) {
      this.views.redirect(res, '/admin/receipts/' + String(id));
      return;
    }
    const joined = joinBoughtOn(this.views.field(req, 'bought_on'), this.views.field(req, 'bought_at'));
    const { id: storyID, msg } = this.resolveStoryForm(req);
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
      this.store.updateReceiptVisit(id, storyID, boughtOn);
    } catch (err) {
      if (err instanceof ReceiptNotReadyError) {
        this.views.redirect(res, '/admin/receipts/' + String(id));
        return;
      }
      const errMsg = err instanceof InvalidStoryError ? 'Choose a store.' : 'Could not save the visit.';
      this.renderReceiptEdit(res, 422, receipt, boughtOn, storyID, errMsg);
      return;
    }
    this.views.redirect(res, '/admin/receipts/' + String(id));
  }

  @Post(':id/retry')
  async retryReceipt(@Req() req: Request, @Res() res: Response): Promise<void> {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      this.views.text(res, 404, 'not found');
      return;
    }
    let receipt: Receipt;
    try {
      receipt = this.store.getReceipt(id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.Status !== RECEIPT_FAILED && receipt.Status !== RECEIPT_PENDING) {
      this.views.redirect(res, '/admin/receipts/' + String(id));
      return;
    }
    if (receipt.Status === RECEIPT_FAILED) {
      if (!this.ocr.configured()) {
        this.views.redirect(
          res,
          '/admin/receipts/' +
            String(id) +
            '?error=' +
            encodeURIComponent('Set OCR_API_KEY or OCR_BASE_URL so the reader can run.'),
        );
        return;
      }
      let model: string;
      try {
        model = this.store.ocrModel();
      } catch {
        this.views.redirect(
          res,
          '/admin/receipts/' + String(id) + '?error=' + encodeURIComponent('Could not load settings.'),
        );
        return;
      }
      if (model === '') {
        this.views.redirect(
          res,
          '/admin/receipts/' +
            String(id) +
            '?error=' +
            encodeURIComponent('Set the AI model under Admin so the reader can run.'),
        );
        return;
      }
      try {
        await this.images.loadReceiptSource(receipt.ImagePath);
      } catch {
        this.views.redirect(
          res,
          '/admin/receipts/' +
            String(id) +
            '?error=' +
            encodeURIComponent('This bill is no longer on disk. Upload it again from Receipts.'),
        );
        return;
      }
      try {
        this.store.requeueReceipt(id);
      } catch {
        this.views.redirect(
          res,
          '/admin/receipts/' + String(id) + '?error=' + encodeURIComponent('Could not start reading again.'),
        );
        return;
      }
    }
    this.queue.enqueueOCR(id);
    this.views.redirect(res, '/admin/receipts/' + String(id));
  }

  @Get(':id')
  showReceipt(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      this.views.text(res, 404, 'not found');
      return;
    }
    let receipt: Receipt;
    try {
      receipt = this.store.getReceipt(id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load the receipt');
      return;
    }
    if (receipt.Status === RECEIPT_PENDING || receipt.Status === RECEIPT_FAILED) {
      this.renderReceiptStatus(res, 200, receipt, String(req.query.error ?? ''));
      return;
    }
    if (receipt.Status === RECEIPT_MIGRATED) {
      this.renderReceiptShow(req, res, 200, receipt, String(req.query.error ?? ''));
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
      aliases = this.store.listAliases();
    } catch {
      this.views.text(res, 500, 'could not load aliases');
      return;
    }
    let defaults;
    try {
      defaults = this.store.unitDefaults();
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
    this.renderReceiptReview(res, 200, view, products, units, stories, String(req.query.error ?? ''));
  }

  @Post(':id')
  confirmReceipt(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      this.views.text(res, 404, 'not found');
      return;
    }
    let receipt: Receipt;
    try {
      receipt = this.store.getReceipt(id);
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
    const get = (name: string) => this.views.field(req, name);
    let { inn, view, msg } = parseReceiptForm(get, products);
    view.ReceiptID = id;
    view.ImagePath = receipt.ImagePath;
    view.Status = receipt.Status;
    view.StoryID = knownStoryID(view.StoryID, stories);
    inn.StoryID = view.StoryID;
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
        this.store.updateReceiptJSON(id, rawJSON);
      } catch {
        /* ignore */
      }
    }
    if (receipt.Status === RECEIPT_MIGRATED) {
      this.renderReceiptShow(req, res, 409, receipt, 'This bill is already saved as purchases.');
      return;
    }
    if (view.StoryID === 0 && formInt(get('story_id')) > 0) {
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
      const result = this.store.migrateReceipt(id, inn, rawJSON);
      this.views.redirect(res, '/admin/receipts/' + String(id) + '?imported=' + String(result.Purchases));
    } catch (err) {
      let errMsg = 'Could not save the purchases.';
      if (err instanceof ReceiptMigratedError) errMsg = 'This bill is already saved as purchases.';
      else if (err instanceof ReceiptNotReadyError) errMsg = 'This scan has no product list yet.';
      else if (err instanceof InvalidUnitError) errMsg = 'Choose a unit for each new product.';
      else if (err instanceof NotFoundError) errMsg = 'A selected product is gone. Refresh and try again.';
      else if (err instanceof InvalidStoryError) errMsg = 'Choose a store.';
      else if (err instanceof Error && (err.message === 'product name is required' || err.message === 'name is required')) {
        errMsg = 'Name is required for each new product.';
      } else if (err instanceof Error && err.message === 'no products to import') {
        errMsg = 'Tick at least one product.';
      }
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
      const receipt = this.store.createReceipt(imagePath);
      return { receipt, msg: '', status: 0 };
    } catch {
      await this.images.deleteReceiptFiles(imagePath);
      return { receipt: emptyReceipt(), msg: 'Could not save the receipt.', status: 500 };
    }
  }

  private renderReceipts(res: Response, status: number, errMsg: string): void {
    let list: Receipt[];
    try {
      list = this.store.listReceipts();
    } catch {
      this.views.text(res, 500, 'could not load receipts');
      return;
    }
    let model: string;
    try {
      model = this.store.ocrModel();
    } catch {
      this.views.text(res, 500, 'could not load settings');
      return;
    }
    this.views.html(res, 'receipts', status, {
      Page: this.views.adminPage('Receipts', '', errMsg),
      Configured: this.ocr.configured(),
      Model: model,
      Receipts: list.map(presentReceipt),
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
      Page: this.views.adminPage('Confirm bill', '', errMsg),
      View: view,
      Products: products,
      Units: units,
      Stories: stories.map(presentStory),
    });
  }

  private renderReceiptStatus(res: Response, status: number, receipt: Receipt, errMsg: string): void {
    const reading = receipt.Status === RECEIPT_PENDING;
    this.views.html(res, 'receipt_status', status, {
      Page: this.views.adminPage('Receipt', '', errMsg, reading ? 3 : 0),
      Receipt: presentReceipt(receipt),
    });
  }

  private renderReceiptShow(req: Request, res: Response, status: number, receipt: Receipt, errMsg: string): void {
    let buys;
    try {
      buys = this.store.listPurchasesByReceipt(receipt.ID);
    } catch {
      this.views.text(res, 500, 'could not load purchases');
      return;
    }
    let stories: Story[];
    try {
      stories = this.store.listStories();
    } catch {
      this.views.text(res, 500, 'could not load stores');
      return;
    }
    let { boughtOn, boughtAt, notes, story } = receiptVisitFacts(receipt, buys, stories);
    if (boughtAt === '') boughtAt = boughtOnTime(boughtOn);
    boughtOn = joinBoughtOn(boughtOn, boughtAt);
    const imported = this.views.queryInt(req, 'imported');
    this.views.html(res, 'receipt_show', status, {
      Page: this.views.adminPage('Receipt', '', errMsg),
      Receipt: presentReceipt(receipt),
      Purchases: buys,
      BoughtOn: boughtOn,
      BoughtAt: boughtAt,
      Notes: notes,
      Story: presentStory(story),
      Imported: imported,
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
      buys = this.store.listPurchasesByReceipt(receipt.ID);
    } catch {
      this.views.text(res, 500, 'could not load purchases');
      return;
    }
    let stories: Story[];
    try {
      stories = this.store.listStories();
    } catch {
      this.views.text(res, 500, 'could not load stores');
      return;
    }
    let boughtAt = '';
    if (boughtOn === '' && storyID === 0) {
      const facts = receiptVisitFacts(receipt, buys, stories);
      boughtOn = facts.boughtOn;
      boughtAt = facts.boughtAt;
      storyID = facts.story.ID;
    } else {
      boughtAt = receiptVisitFacts(receipt, buys, stories).boughtAt;
    }
    if (boughtAt === '') boughtAt = boughtOnTime(boughtOn);
    boughtOn = joinBoughtOn(boughtOn, boughtAt);
    this.views.html(res, 'receipt_edit', status, {
      Page: this.views.adminPage('Edit visit', '', errMsg),
      Receipt: presentReceipt(receipt),
      BoughtOn: boughtOn,
      BoughtAt: boughtAt,
      Story: presentStory(storyByID(stories, storyID)),
      Stories: stories.map(presentStory),
    });
  }

  private receiptLookups(): { products: ProductListItem[]; units: Unit[]; stories: Story[] } {
    return {
      products: this.store.listProducts(''),
      units: this.store.listUnits(),
      stories: this.store.listStories(),
    };
  }

  private resolveStoryForm(req: Request): { id: number; msg: string } {
    const id = this.views.formInt(req, 'story_id');
    if (id <= 0) return { id: 0, msg: '' };
    try {
      this.store.getStory(id);
      return { id, msg: '' };
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

function formInt(s: string): number {
  const v = Number.parseInt(s.trim(), 10);
  return Number.isFinite(v) ? v : 0;
}

function emptyReceipt(): Receipt {
  return {
    ID: 0,
    ImagePath: '',
    RawResponse: '',
    Status: '',
    ErrorMessage: '',
    CreatedAt: '',
    Source: '',
    ExternalID: '',
    SourcePayload: '',
  };
}
