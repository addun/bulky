import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service.js';
import { changesOf, lastId } from '../../db/query.js';
import { receipts, stores } from '../../db/schema.js';
import { boughtOnDate, boughtOnTime } from '../../domain/bought-on.js';
import {
  AliasScopeError,
  DuplicateError,
  isUniqueErr,
  NotFoundError,
  ReceiptMigratedError,
  ReceiptNotReadyError,
} from '../../domain/errors.js';
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
  type ReceiptDuplicateGroup,
  type ReceiptListItem,
  type ReceiptVisitRow,
  duplicateReceiptGroups,
} from './receipts.models.js';
import { AliasesRepository, stripAliasWhitespace } from '#app/store/aliases';
import { LocationsRepository } from '#app/store/locations';
import { nowRFC3339 } from '#app/store/now';
import { ProductsRepository } from '#app/store/products';
import { PurchasesRepository } from '#app/store/purchases';

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

  createSourcedReceipt(
    imagePathVal: string | null,
    source: string,
    externalId: string,
    payload: string,
  ): Receipt {
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
    return mapReceipt(row);
  }

  listReceipts(): ReceiptListItem[] {
    return this.scanReceiptList().map((row) => ({
      id: row.id,
      imagePath: row.imagePath,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      boughtOn: row.boughtOn,
      shopName: row.shopName,
    }));
  }

  listDuplicateReceipts(): ReceiptDuplicateGroup[] {
    return duplicateReceiptGroups(this.scanReceiptList());
  }

  private scanReceiptList(): ReceiptVisitRow[] {
    return this.orm
      .select({
        id: receipts.id,
        imagePath: receipts.imagePath,
        status: receipts.status,
        errorMessage: receipts.errorMessage,
        createdAt: receipts.createdAt,
        boughtOn: sql<string>`trim(coalesce(case when json_valid(${receipts.rawResponse}) then json_extract(${receipts.rawResponse}, '$.bought_on') end, ''))`,
        boughtAt: sql<string>`trim(coalesce(case when json_valid(${receipts.rawResponse}) then json_extract(${receipts.rawResponse}, '$.bought_at') end, ''))`,
        shopName: sql<string>`trim(coalesce(${stores.name}, case when json_valid(${receipts.rawResponse}) then json_extract(${receipts.rawResponse}, '$.company_name') end, ''))`,
        shopId: sql<number>`coalesce(case when json_valid(${receipts.rawResponse}) then json_extract(${receipts.rawResponse}, '$.company_id') end, 0)`,
      })
      .from(receipts)
      .leftJoin(
        stores,
        sql`${stores.id} = case when json_valid(${receipts.rawResponse}) then json_extract(${receipts.rawResponse}, '$.company_id') end`,
      )
      .orderBy(desc(receipts.id))
      .all()
      .map((r) => ({
        ...r,
        imagePath: r.imagePath.trim() === '' ? null : r.imagePath,
        boughtOn: (r.boughtOn ?? '').trim(),
        boughtAt: (r.boughtAt ?? '').trim(),
        shopName: (r.shopName ?? '').trim(),
        shopId: Number(r.shopId) || 0,
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

  deleteReceipt(id: number): { imagePath: string | null; productImages: string[] } {
    return this.db.immediate(() => {
      const r = this.getReceipt(id);
      const productIds = this.purchases.deleteByReceipt(id);
      const productImages: string[] = [];
      for (const productId of productIds) {
        if (this.purchases.hasPurchases(productId)) continue;
        const img = this.products.deleteProduct(productId);
        if (img) productImages.push(img);
      }
      this.orm.delete(receipts).where(eq(receipts.id, id)).run();
      return { imagePath: r.imagePath, productImages };
    });
  }

  updateReceiptVisit(id: number, storeId: number | null, boughtOn: string): void {
    const store = this.locations.optionalStore(storeId);
    this.db.immediate(() => {
      const r = this.getReceipt(id);
      if (r.status !== RECEIPT_MIGRATED) {
        if (r.status === RECEIPT_READY) throw new ReceiptNotReadyError();
        throw new NotFoundError();
      }
      this.purchases.updateReceiptVisit(id, store, boughtOn);
      const raw = patchBillVisitJSON(r.rawResponse, storeId, boughtOn);
      this.orm.update(receipts).set({ rawResponse: raw }).where(eq(receipts.id, id)).run();
    });
  }

  importTrustedReceipt(
    imagePathVal: string | null,
    source: string,
    externalId: string,
    payload: string,
    inn: BillImport,
    rawJSON: string,
  ): { receipt: Receipt; result: BillImportResult } {
    return this.db.immediate(() => {
      const receipt = this.createSourcedReceiptInner(
        imagePathVal,
        source,
        externalId,
        payload,
        RECEIPT_MIGRATED,
        rawJSON,
      );
      inn.receiptId = receipt.id;
      const result = this.applyBill(inn);
      return { receipt, result };
    });
  }

  importBill(inn: BillImport): BillImportResult {
    return this.db.immediate(() => this.applyBill(inn));
  }

  private createSourcedReceiptInner(
    imagePathVal: string | null,
    source: string,
    externalId: string,
    payload: string,
    status = RECEIPT_PENDING,
    rawJSON = '',
  ): Receipt {
    try {
      const id = lastId(
        this.orm
          .insert(receipts)
          .values({
            imagePath: (imagePathVal ?? '').trim(),
            rawResponse: rawJSON,
            status,
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
    let storeId = inn.storeId;
    if (storeId) this.locations.getStore(storeId);
    else if (inn.store) {
      const c = this.locations.normalizeStore(
        inn.store.name,
        inn.store.streetName,
        inn.store.buildingNumber,
        inn.store.apartmentNumber,
        inn.store.postalCode,
        inn.store.city,
        inn.store.externalId,
      );
      try {
        storeId = this.locations.insertStore(c, inn.store.retailChainId);
      } catch (err) {
        if (!(err instanceof DuplicateError)) throw err;
        storeId = this.locations.storeIdByExternalId(c.externalId);
        if (!storeId) throw err;
      }
    }
    const created = new Map<string, number>();
    const newIds = new Set<number>();
    const result: BillImportResult = { storeId, productIds: [], purchases: 0 };
    for (const line of inn.lines) {
      const pid = this.resolveImportProduct(line, created, newIds, storeId);
      result.productIds.push(pid);
      this.purchases.insertImported(pid, storeId, inn.receiptId, inn.boughtOn, line.quantity, line.amount);
      result.purchases++;
    }
    return result;
  }

  private resolveImportProduct(
    line: BillLineInput,
    created: Map<string, number>,
    newIds: Set<number>,
    storeId: number | null,
  ): number {
    const pid = this.lookupImportProduct(line, created, newIds, storeId);
    this.products.applyImportedEan(pid, line.ean);
    return pid;
  }

  private lookupImportProduct(
    line: BillLineInput,
    created: Map<string, number>,
    newIds: Set<number>,
    storeId: number | null,
  ): number {
    if (line.productId > 0) {
      const p = this.products.getProductRow(line.productId);
      this.maybeAliasFromReceipt(p.id, storeId, line.receiptName);
      return p.id;
    }
    const key = line.productName.trim().toLowerCase();
    const existingCreated = created.get(key);
    if (existingCreated !== undefined) {
      if (newIds.has(existingCreated)) this.maybeAliasFromReceipt(existingCreated, storeId, line.receiptName);
      return existingCreated;
    }
    try {
      const existing = this.products.findProductByName(line.productName, storeId);
      created.set(key, existing.id);
      return existing.id;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const p = this.products.insertImported(line.productName, line.unitId, line.ean);
    created.set(key, p.id);
    newIds.add(p.id);
    this.maybeAliasFromReceipt(p.id, storeId, line.receiptName);
    return p.id;
  }

  private maybeAliasFromReceipt(productId: number, storeId: number | null, receiptName: string): void {
    receiptName = stripAliasWhitespace(receiptName);
    if (receiptName === '') return;
    let chainId: number | null = null;
    if (storeId) {
      const st = this.locations.getStore(storeId);
      if (st.retailChainId) {
        chainId = st.retailChainId;
        storeId = null;
      }
    }
    try {
      this.aliases.createAlias(productId, storeId, chainId, receiptName);
    } catch (err) {
      if (err instanceof DuplicateError || err instanceof AliasScopeError) {
        return;
      }
      throw err;
    }
  }
}

function mapReceipt(row: {
  id: number;
  imagePath: string;
  rawResponse: string;
  status: string;
  errorMessage: string;
  createdAt: string;
  source: string;
  externalId: string;
  sourcePayload: string;
}): Receipt {
  const imagePath = row.imagePath.trim();
  return { ...row, imagePath: imagePath === '' ? null : imagePath };
}

function patchBillVisitJSON(raw: string, storeId: number | null, boughtOn: string): string {
  raw = raw.trim() || '{}';
  const bill = JSON.parse(raw) as Record<string, unknown>;
  bill.bought_on = boughtOnDate(boughtOn);
  bill.bought_at = boughtOnTime(boughtOn);
  if (storeId) bill.company_id = storeId;
  else delete bill.company_id;
  return JSON.stringify(bill);
}
