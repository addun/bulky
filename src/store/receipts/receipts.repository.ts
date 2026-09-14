import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service';
import { changesOf, lastId } from '../../db/query';
import { receipts } from '../../db/schema';
import {
  AliasScopeError,
  DuplicateError,
  isUniqueErr,
  NotFoundError,
  ReceiptMigratedError,
  ReceiptNotReadyError,
} from '../../domain/errors';
import { normalizeBoughtOn } from '../../domain/bought-on';
import {
  RECEIPT_FAILED,
  RECEIPT_MIGRATED,
  RECEIPT_PENDING,
  RECEIPT_READY,
  RECEIPT_SOURCE_OCR,
  type BillImport,
  type BillImportResult,
  type BillLineInput,
  type Receipt,
} from './receipts.models';
import { AliasesRepository } from '@app/store/aliases';
import { LocationsRepository } from '@app/store/locations';
import { nowRFC3339 } from '@app/store/now';
import { ProductsRepository } from '@app/store/products';
import { PurchasesRepository } from '@app/store/purchases';

@Injectable()
export class ReceiptsRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsRepository,
    private readonly aliases: AliasesRepository,
    private readonly purchases: PurchasesRepository,
    private readonly locations: LocationsRepository,
  ) {}

  private get orm() {
    return this.db.drizzle;
  }

  createReceipt(imagePathVal: string): Receipt {
    return this.createSourcedReceiptInner(imagePathVal, RECEIPT_SOURCE_OCR, '', '');
  }

  createSourcedReceipt(imagePathVal: string, source: string, externalID: string, payload: string): Receipt {
    return this.createSourcedReceiptInner(imagePathVal, source, externalID, payload);
  }

  listReceiptExternalIDs(source: string): string[] {
    source = source.trim().toLowerCase();
    if (source === '') return [];
    return this.orm
      .select({ externalId: receipts.externalId })
      .from(receipts)
      .where(and(eq(receipts.source, source), ne(receipts.externalId, '')))
      .all()
      .map((r) => r.externalId);
  }

  latestSourcedBoughtOn(source: string): string {
    source = source.trim().toLowerCase();
    if (source === '') return '';
    const row = this.orm
      .select({
        bought_on: sql<string>`coalesce(max(json_extract(${receipts.rawResponse}, '$.bought_on')), '')`,
      })
      .from(receipts)
      .where(
        and(
          eq(receipts.source, source),
          sql`json_valid(${receipts.rawResponse})`,
          sql`json_extract(${receipts.rawResponse}, '$.bought_on') != ''`,
        ),
      )
      .get();
    return (row?.bought_on ?? '').trim();
  }

  getReceipt(id: number): Receipt {
    const row = this.orm
      .select({
        ID: receipts.id,
        ImagePath: receipts.imagePath,
        RawResponse: receipts.rawResponse,
        Status: receipts.status,
        CreatedAt: receipts.createdAt,
        ErrorMessage: receipts.errorMessage,
        Source: receipts.source,
        ExternalID: receipts.externalId,
        SourcePayload: receipts.sourcePayload,
      })
      .from(receipts)
      .where(eq(receipts.id, id))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  listReceipts(): Receipt[] {
    return this.orm
      .select({
        ID: receipts.id,
        ImagePath: receipts.imagePath,
        Status: receipts.status,
        ErrorMessage: receipts.errorMessage,
        CreatedAt: receipts.createdAt,
      })
      .from(receipts)
      .orderBy(desc(receipts.id))
      .all()
      .map((r) => ({
        ID: r.ID,
        ImagePath: r.ImagePath,
        RawResponse: '',
        Status: r.Status,
        ErrorMessage: r.ErrorMessage,
        CreatedAt: r.CreatedAt,
        Source: '',
        ExternalID: '',
        SourcePayload: '',
      }));
  }

  listPendingReceiptIDs(): number[] {
    return this.orm
      .select({ id: receipts.id })
      .from(receipts)
      .where(eq(receipts.status, RECEIPT_PENDING))
      .orderBy(receipts.id)
      .all()
      .map((r) => r.id);
  }

  saveAIResponse(id: number, rawJSON: string): void {
    const n = changesOf(
      this.orm
        .update(receipts)
        .set({ rawResponse: rawJSON, status: RECEIPT_READY, errorMessage: '' })
        .where(and(eq(receipts.id, id), inArray(receipts.status, [RECEIPT_PENDING, RECEIPT_FAILED])))
        .run(),
    );
    if (n === 0) {
      const r = this.getReceipt(id);
      if (r.Status === RECEIPT_MIGRATED) throw new ReceiptMigratedError();
      throw new NotFoundError();
    }
  }

  failReceipt(id: number, msg: string): void {
    const n = changesOf(
      this.orm
        .update(receipts)
        .set({ status: RECEIPT_FAILED, errorMessage: msg.trim() })
        .where(and(eq(receipts.id, id), eq(receipts.status, RECEIPT_PENDING)))
        .run(),
    );
    if (n === 0) {
      this.getReceipt(id);
      throw new NotFoundError();
    }
  }

  requeueReceipt(id: number): void {
    const n = changesOf(
      this.orm
        .update(receipts)
        .set({ status: RECEIPT_PENDING, errorMessage: '' })
        .where(and(eq(receipts.id, id), eq(receipts.status, RECEIPT_FAILED)))
        .run(),
    );
    if (n === 0) {
      const r = this.getReceipt(id);
      if (r.Status === RECEIPT_PENDING) return;
      throw new ReceiptNotReadyError();
    }
  }

  updateReceiptJSON(id: number, rawJSON: string): void {
    const n = changesOf(
      this.orm
        .update(receipts)
        .set({ rawResponse: rawJSON })
        .where(and(eq(receipts.id, id), eq(receipts.status, RECEIPT_READY)))
        .run(),
    );
    if (n === 0) {
      this.getReceipt(id);
      throw new ReceiptNotReadyError();
    }
  }

  migrateReceipt(id: number, inn: BillImport, rawJSON: string): BillImportResult {
    return this.db.immediate(() => {
      const r = this.getReceipt(id);
      if (r.Status === RECEIPT_MIGRATED) throw new ReceiptMigratedError();
      if (r.Status !== RECEIPT_READY) throw new ReceiptNotReadyError();
      inn.ReceiptID = id;
      const res = this.applyBill(inn);
      this.orm.update(receipts).set({ status: RECEIPT_MIGRATED, rawResponse: rawJSON }).where(eq(receipts.id, id)).run();
      return res;
    });
  }

  updateReceiptVisit(id: number, storyID: number, boughtOn: string): void {
    const story = this.locations.optionalStory(storyID);
    boughtOn = normalizeBoughtOn(boughtOn);
    this.db.immediate(() => {
      const r = this.getReceipt(id);
      if (r.Status !== RECEIPT_MIGRATED) {
        if (r.Status === RECEIPT_READY) throw new ReceiptNotReadyError();
        throw new NotFoundError();
      }
      this.purchases.updateReceiptVisit(id, story, boughtOn);
      const raw = patchBillVisitJSON(r.RawResponse, storyID, boughtOn);
      this.orm.update(receipts).set({ rawResponse: raw }).where(eq(receipts.id, id)).run();
    });
  }

  importBill(inn: BillImport): BillImportResult {
    return this.db.immediate(() => this.applyBill(inn));
  }

  private createSourcedReceiptInner(imagePathVal: string, source: string, externalID: string, payload: string): Receipt {
    try {
      const id = lastId(
        this.orm
          .insert(receipts)
          .values({
            imagePath: imagePathVal.trim(),
            rawResponse: '',
            status: RECEIPT_PENDING,
            errorMessage: '',
            createdAt: nowRFC3339(),
            source: source.trim().toLowerCase(),
            externalId: externalID.trim(),
            sourcePayload: payload,
          })
          .run(),
      );
      return this.getReceipt(id);
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  private applyBill(inn: BillImport): BillImportResult {
    let storyID = inn.StoryID;
    if (storyID > 0) this.locations.getStory(storyID);
    else if (inn.Story) {
      const c = this.locations.normalizeStory(
        inn.Story.Name,
        inn.Story.StreetName,
        inn.Story.BuildingNumber,
        inn.Story.ApartmentNumber,
        inn.Story.PostalCode,
        inn.Story.City,
        inn.Story.ExternalID,
      );
      storyID = this.locations.insertStory(c, inn.Story.RetailChainID);
    }
    const created = new Map<string, number>();
    const newIDs = new Set<number>();
    const result: BillImportResult = { StoryID: storyID, ProductIDs: [], Purchases: 0 };
    for (const line of inn.Lines) {
      const pid = this.resolveImportProduct(line, created, newIDs, storyID);
      result.ProductIDs.push(pid);
      this.purchases.insertImported(pid, storyID, inn.ReceiptID, inn.BoughtOn, line.Quantity, line.Amount);
      result.Purchases++;
    }
    return result;
  }

  private resolveImportProduct(
    line: BillLineInput,
    created: Map<string, number>,
    newIDs: Set<number>,
    storyID: number,
  ): number {
    if (line.ProductID > 0) {
      const p = this.products.getProductRow(line.ProductID);
      this.maybeAliasFromReceipt(p.ID, storyID, line.ReceiptName);
      return p.ID;
    }
    const key = line.ProductName.trim().toLowerCase();
    const existingCreated = created.get(key);
    if (existingCreated !== undefined) {
      if (newIDs.has(existingCreated)) this.maybeAliasFromReceipt(existingCreated, storyID, line.ReceiptName);
      return existingCreated;
    }
    try {
      const existing = this.products.findProductByName(line.ProductName, storyID);
      created.set(key, existing.ID);
      return existing.ID;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const p = this.products.insertImported(line.ProductName, line.UnitID);
    created.set(key, p.ID);
    newIDs.add(p.ID);
    this.maybeAliasFromReceipt(p.ID, storyID, line.ReceiptName);
    return p.ID;
  }

  private maybeAliasFromReceipt(productID: number, storyID: number, receiptName: string): void {
    receiptName = receiptName.trim();
    if (receiptName === '') return;
    let chainID = 0;
    if (storyID > 0) {
      const st = this.locations.getStory(storyID);
      if (st.RetailChainID > 0) {
        chainID = st.RetailChainID;
        storyID = 0;
      }
    }
    try {
      this.aliases.createAlias(productID, storyID, chainID, receiptName);
    } catch (err) {
      if (err instanceof DuplicateError || err instanceof AliasScopeError) {
        return;
      }
      throw err;
    }
  }
}

function patchBillVisitJSON(raw: string, storyID: number, boughtOn: string): string {
  raw = raw.trim() || '{}';
  const bill = JSON.parse(raw) as Record<string, unknown>;
  const { date, clock } = splitBoughtOnSafe(boughtOn);
  bill.bought_on = date;
  if (clock !== '') bill.bought_at = clock;
  else delete bill.bought_at;
  if (storyID > 0) bill.company_id = storyID;
  else delete bill.company_id;
  return JSON.stringify(bill);
}

function splitBoughtOnSafe(s: string): { date: string; clock: string } {
  const t = s.trim().replaceAll('T', ' ').replaceAll('\u00a0', ' ');
  const parts = t.split(/\s+/);
  return { date: parts[0] ?? '', clock: parts[1]?.slice(0, 5) ?? '' };
}
