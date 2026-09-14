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

  createSourcedReceipt(imagePathVal: string, source: string, externalId: string, payload: string): Receipt {
    return this.createSourcedReceiptInner(imagePathVal, source, externalId, payload);
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
        boughtOn: sql<string>`coalesce(max(json_extract(${receipts.rawResponse}, '$.bought_on')), '')`,
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
    return (row?.boughtOn ?? '').trim();
  }

  getReceipt(id: number): Receipt {
    const row = this.orm.select().from(receipts).where(eq(receipts.id, id)).get();
    if (!row) throw new NotFoundError();
    return row;
  }

  listReceipts(): Receipt[] {
    return this.orm
      .select({
        id: receipts.id,
        imagePath: receipts.imagePath,
        status: receipts.status,
        errorMessage: receipts.errorMessage,
        createdAt: receipts.createdAt,
      })
      .from(receipts)
      .orderBy(desc(receipts.id))
      .all()
      .map((r) => ({
        ...r,
        rawResponse: '',
        source: '',
        externalId: '',
        sourcePayload: '',
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
      if (r.status === RECEIPT_MIGRATED) throw new ReceiptMigratedError();
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
      if (r.status === RECEIPT_PENDING) return;
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
      if (r.status === RECEIPT_MIGRATED) throw new ReceiptMigratedError();
      if (r.status !== RECEIPT_READY) throw new ReceiptNotReadyError();
      inn.receiptId = id;
      const res = this.applyBill(inn);
      this.orm.update(receipts).set({ status: RECEIPT_MIGRATED, rawResponse: rawJSON }).where(eq(receipts.id, id)).run();
      return res;
    });
  }

  updateReceiptVisit(id: number, storyId: number | null, boughtOn: string): void {
    const story = this.locations.optionalStory(storyId);
    boughtOn = normalizeBoughtOn(boughtOn);
    this.db.immediate(() => {
      const r = this.getReceipt(id);
      if (r.status !== RECEIPT_MIGRATED) {
        if (r.status === RECEIPT_READY) throw new ReceiptNotReadyError();
        throw new NotFoundError();
      }
      this.purchases.updateReceiptVisit(id, story, boughtOn);
      const raw = patchBillVisitJSON(r.rawResponse, storyId, boughtOn);
      this.orm.update(receipts).set({ rawResponse: raw }).where(eq(receipts.id, id)).run();
    });
  }

  importBill(inn: BillImport): BillImportResult {
    return this.db.immediate(() => this.applyBill(inn));
  }

  private createSourcedReceiptInner(imagePathVal: string, source: string, externalId: string, payload: string): Receipt {
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
            externalId: externalId.trim(),
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
    let storyId = inn.storyId;
    if (storyId) this.locations.getStory(storyId);
    else if (inn.story) {
      const c = this.locations.normalizeStory(
        inn.story.name,
        inn.story.streetName,
        inn.story.buildingNumber,
        inn.story.apartmentNumber,
        inn.story.postalCode,
        inn.story.city,
        inn.story.externalId,
      );
      storyId = this.locations.insertStory(c, inn.story.retailChainId);
    }
    const created = new Map<string, number>();
    const newIds = new Set<number>();
    const result: BillImportResult = { storyId, productIds: [], purchases: 0 };
    for (const line of inn.lines) {
      const pid = this.resolveImportProduct(line, created, newIds, storyId);
      result.productIds.push(pid);
      this.purchases.insertImported(pid, storyId, inn.receiptId, inn.boughtOn, line.quantity, line.amount);
      result.purchases++;
    }
    return result;
  }

  private resolveImportProduct(
    line: BillLineInput,
    created: Map<string, number>,
    newIds: Set<number>,
    storyId: number | null,
  ): number {
    if (line.productId > 0) {
      const p = this.products.getProductRow(line.productId);
      this.maybeAliasFromReceipt(p.id, storyId, line.receiptName);
      return p.id;
    }
    const key = line.productName.trim().toLowerCase();
    const existingCreated = created.get(key);
    if (existingCreated !== undefined) {
      if (newIds.has(existingCreated)) this.maybeAliasFromReceipt(existingCreated, storyId, line.receiptName);
      return existingCreated;
    }
    try {
      const existing = this.products.findProductByName(line.productName, storyId);
      created.set(key, existing.id);
      return existing.id;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const p = this.products.insertImported(line.productName, line.unitId);
    created.set(key, p.id);
    newIds.add(p.id);
    this.maybeAliasFromReceipt(p.id, storyId, line.receiptName);
    return p.id;
  }

  private maybeAliasFromReceipt(productId: number, storyId: number | null, receiptName: string): void {
    receiptName = receiptName.trim();
    if (receiptName === '') return;
    let chainId: number | null = null;
    if (storyId) {
      const st = this.locations.getStory(storyId);
      if (st.retailChainId) {
        chainId = st.retailChainId;
        storyId = null;
      }
    }
    try {
      this.aliases.createAlias(productId, storyId, chainId, receiptName);
    } catch (err) {
      if (err instanceof DuplicateError || err instanceof AliasScopeError) {
        return;
      }
      throw err;
    }
  }
}

function patchBillVisitJSON(raw: string, storyId: number | null, boughtOn: string): string {
  raw = raw.trim() || '{}';
  const bill = JSON.parse(raw) as Record<string, unknown>;
  const { date, clock } = splitBoughtOnSafe(boughtOn);
  bill.bought_on = date;
  if (clock !== '') bill.bought_at = clock;
  else delete bill.bought_at;
  if (storyId) bill.company_id = storyId;
  else delete bill.company_id;
  return JSON.stringify(bill);
}

function splitBoughtOnSafe(s: string): { date: string; clock: string } {
  const t = s.trim().replaceAll('T', ' ').replaceAll('\u00a0', ' ');
  const parts = t.split(/\s+/);
  return { date: parts[0] ?? '', clock: parts[1]?.slice(0, 5) ?? '' };
}
