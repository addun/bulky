import { Injectable } from '@nestjs/common';
import { count, desc, eq, inArray } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DatabaseService } from '../../db/database.service';
import { changesOf, countOf, lastId } from '../../db/query';
import { products, purchases, units } from '../../db/schema';
import { InvalidKindError, InvalidQuantityError, NotFoundError } from '../../domain/errors';
import { normalizeBoughtOn } from '../../domain/bought-on';
import { KIND_PRICE, KIND_PURCHASE, type Purchase, type PurchaseKind, type ReceiptPurchase } from './purchases.models';
import { LocationsRepository } from '@app/store/locations';
import { nowRFC3339 } from '@app/store/now';

type PurchaseRow = {
  id: number;
  productId: number;
  storyId: number | null;
  kind: string;
  receiptId: number | null;
  boughtOn: string;
  quantity: string;
  amount: string;
  createdAt: string;
};

@Injectable()
export class PurchasesRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly locations: LocationsRepository,
  ) {}

  private get orm() {
    return this.db.drizzle;
  }

  listPurchases(productId: number): Purchase[] {
    return this.mapPurchases(
      this.purchaseQuery()
        .where(eq(purchases.productId, productId))
        .orderBy(desc(purchases.boughtOn), desc(purchases.id))
        .all(),
    );
  }

  listPurchasesAsc(productId: number): Purchase[] {
    return this.mapPurchases(
      this.purchaseQuery().where(eq(purchases.productId, productId)).orderBy(purchases.id).all(),
    );
  }

  listPurchasesByReceipt(receiptId: number): ReceiptPurchase[] {
    const rows = this.orm
      .select({
        id: purchases.id,
        productId: purchases.productId,
        storyId: purchases.storyId,
        kind: purchases.kind,
        receiptId: purchases.receiptId,
        boughtOn: purchases.boughtOn,
        quantity: purchases.quantity,
        amount: purchases.amount,
        createdAt: purchases.createdAt,
        productName: products.name,
        unitName: units.name,
        imagePath: products.imagePath,
      })
      .from(purchases)
      .innerJoin(products, eq(products.id, purchases.productId))
      .innerJoin(units, eq(units.id, products.unitId))
      .where(eq(purchases.receiptId, receiptId))
      .orderBy(purchases.id)
      .all();
    return rows.map((r) => ({
      ...this.mapPurchase(r),
      productName: r.productName,
      unitName: r.unitName,
      imagePath: r.imagePath,
    }));
  }

  getPurchase(id: number): Purchase {
    const row = this.purchaseQuery().where(eq(purchases.id, id)).get();
    if (!row) throw new NotFoundError();
    return this.mapPurchase(row);
  }

  createPurchase(
    productId: number,
    storyId: number | null,
    boughtOn: string,
    quantity: Decimal,
    amount: Decimal,
    kind: PurchaseKind,
  ): Purchase {
    this.requireProduct(productId);
    this.parsePurchaseKind(kind);
    const story = this.locations.optionalStory(storyId);
    this.validQuantity(quantity);
    boughtOn = normalizeBoughtOn(boughtOn);
    const id = lastId(
      this.orm
        .insert(purchases)
        .values({
          productId,
          storyId: story,
          kind,
          receiptId: null,
          boughtOn,
          quantity: quantity.toString(),
          amount: amount.toString(),
          createdAt: nowRFC3339(),
        })
        .run(),
    );
    return this.getPurchase(id);
  }

  updatePurchase(
    id: number,
    storyId: number | null,
    boughtOn: string,
    quantity: Decimal,
    amount: Decimal,
    kind: PurchaseKind,
  ): void {
    this.parsePurchaseKind(kind);
    const story = this.locations.optionalStory(storyId);
    this.validQuantity(quantity);
    boughtOn = normalizeBoughtOn(boughtOn);
    const n = changesOf(
      this.orm
        .update(purchases)
        .set({
          storyId: story,
          kind,
          boughtOn,
          quantity: quantity.toString(),
          amount: amount.toString(),
        })
        .where(eq(purchases.id, id))
        .run(),
    );
    if (n === 0) throw new NotFoundError();
  }

  deletePurchase(id: number): void {
    const n = changesOf(this.orm.delete(purchases).where(eq(purchases.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  deleteByReceipt(receiptId: number): number[] {
    const ids = [
      ...new Set(
        this.orm
          .select({ productId: purchases.productId })
          .from(purchases)
          .where(eq(purchases.receiptId, receiptId))
          .all()
          .map((r) => r.productId),
      ),
    ];
    this.orm.delete(purchases).where(eq(purchases.receiptId, receiptId)).run();
    return ids;
  }

  hasPurchases(productId: number): boolean {
    const row = this.orm
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.productId, productId))
      .limit(1)
      .get();
    return row != null;
  }

  parsePurchaseKind(s: string): PurchaseKind {
    const k = s.trim();
    if (k === KIND_PURCHASE || k === KIND_PRICE) return k;
    throw new InvalidKindError();
  }

  listPurchasesForProductIDs(ids: number[]): Purchase[] {
    if (ids.length === 0) return [];
    return this.mapPurchases(
      this.purchaseQuery()
        .where(inArray(purchases.productId, ids))
        .orderBy(desc(purchases.boughtOn), desc(purchases.id))
        .all(),
    );
  }

  reassignProduct(fromId: number, intoId: number): void {
    this.orm.update(purchases).set({ productId: intoId }).where(eq(purchases.productId, fromId)).run();
  }

  insertImported(
    productId: number,
    storyId: number | null,
    receiptId: number | null,
    boughtOn: string,
    quantity: Decimal,
    amount: Decimal,
  ): Purchase {
    this.validQuantity(quantity);
    boughtOn = normalizeBoughtOn(boughtOn);
    const id = lastId(
      this.orm
        .insert(purchases)
        .values({
          productId,
          storyId,
          kind: KIND_PURCHASE,
          receiptId,
          boughtOn,
          quantity: quantity.toString(),
          amount: amount.toString(),
          createdAt: nowRFC3339(),
        })
        .run(),
    );
    return this.getPurchase(id);
  }

  updateReceiptVisit(receiptId: number, storyId: number | null, boughtOn: string): void {
    this.orm.update(purchases).set({ storyId, boughtOn }).where(eq(purchases.receiptId, receiptId)).run();
  }

  private validQuantity(quantity: Decimal): void {
    if (quantity.isZero() || quantity.isNegative()) throw new InvalidQuantityError();
  }

  private requireProduct(id: number): void {
    const n = this.orm.select({ n: count() }).from(products).where(eq(products.id, id)).get();
    if (countOf(n?.n) === 0) throw new NotFoundError();
  }

  private purchaseQuery() {
    return this.orm.select().from(purchases);
  }

  private mapPurchases(rows: PurchaseRow[]): Purchase[] {
    return rows.map((r) => this.mapPurchase(r));
  }

  private mapPurchase(r: PurchaseRow): Purchase {
    return {
      ...r,
      kind: r.kind as PurchaseKind,
      quantity: new Decimal(r.quantity),
      amount: new Decimal(r.amount),
    };
  }
}
