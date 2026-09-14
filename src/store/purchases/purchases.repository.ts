import { Injectable } from '@nestjs/common';
import { count, desc, eq, inArray } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DatabaseService } from '../../db/database.service';
import { changesOf, countOf, lastId } from '../../db/query';
import { products, purchases, units } from '../../db/schema';
import { InvalidKindError, InvalidQuantityError, NotFoundError } from '../../domain/errors';
import { normalizeBoughtOn } from '../../domain/bought-on';
import { imagePath } from '../products/products.models';
import { KIND_PRICE, KIND_PURCHASE, type Purchase, type PurchaseKind, type ReceiptPurchase } from './purchases.models';
import { LocationsRepository } from '@app/store/locations';
import { nowRFC3339 } from '@app/store/now';

type PurchaseRow = {
  ID: number;
  ProductID: number;
  StoryID: number | null;
  Kind: string;
  ReceiptID: number | null;
  BoughtOn: string;
  Quantity: string;
  Amount: string;
  CreatedAt: string;
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

  listPurchases(productID: number): Purchase[] {
    return this.mapPurchases(
      this.purchaseQuery()
        .where(eq(purchases.productId, productID))
        .orderBy(desc(purchases.boughtOn), desc(purchases.id))
        .all(),
    );
  }

  listPurchasesAsc(productID: number): Purchase[] {
    return this.mapPurchases(
      this.purchaseQuery().where(eq(purchases.productId, productID)).orderBy(purchases.id).all(),
    );
  }

  listPurchasesByReceipt(receiptID: number): ReceiptPurchase[] {
    const rows = this.orm
      .select({
        ID: purchases.id,
        ProductID: purchases.productId,
        StoryID: purchases.storyId,
        Kind: purchases.kind,
        ReceiptID: purchases.receiptId,
        BoughtOn: purchases.boughtOn,
        Quantity: purchases.quantity,
        Amount: purchases.amount,
        CreatedAt: purchases.createdAt,
        ProductName: products.name,
        UnitName: units.name,
        image_path: products.imagePath,
      })
      .from(purchases)
      .innerJoin(products, eq(products.id, purchases.productId))
      .innerJoin(units, eq(units.id, products.unitId))
      .where(eq(purchases.receiptId, receiptID))
      .orderBy(purchases.id)
      .all();
    return rows.map((r) => ({
      ...this.mapPurchase(r),
      ProductName: r.ProductName,
      UnitName: r.UnitName,
      ImagePath: imagePath(r.image_path),
    }));
  }

  getPurchase(id: number): Purchase {
    const row = this.purchaseQuery().where(eq(purchases.id, id)).get();
    if (!row) throw new NotFoundError();
    return this.mapPurchase(row);
  }

  createPurchase(
    productID: number,
    storyID: number,
    boughtOn: string,
    quantity: Decimal,
    amount: Decimal,
    kind: PurchaseKind,
  ): Purchase {
    this.requireProduct(productID);
    this.parsePurchaseKind(kind);
    const story = this.locations.optionalStory(storyID);
    this.validQuantity(quantity);
    boughtOn = normalizeBoughtOn(boughtOn);
    const id = lastId(
      this.orm
        .insert(purchases)
        .values({
          productId: productID,
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
    storyID: number,
    boughtOn: string,
    quantity: Decimal,
    amount: Decimal,
    kind: PurchaseKind,
  ): void {
    this.parsePurchaseKind(kind);
    const story = this.locations.optionalStory(storyID);
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

  reassignProduct(fromID: number, intoID: number): void {
    this.orm.update(purchases).set({ productId: intoID }).where(eq(purchases.productId, fromID)).run();
  }

  insertImported(
    productID: number,
    storyID: number,
    receiptID: number,
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
          productId: productID,
          storyId: storyID || null,
          kind: KIND_PURCHASE,
          receiptId: receiptID || null,
          boughtOn,
          quantity: quantity.toString(),
          amount: amount.toString(),
          createdAt: nowRFC3339(),
        })
        .run(),
    );
    return this.getPurchase(id);
  }

  updateReceiptVisit(receiptID: number, storyID: number | null, boughtOn: string): void {
    this.orm.update(purchases).set({ storyId: storyID, boughtOn }).where(eq(purchases.receiptId, receiptID)).run();
  }

  private validQuantity(quantity: Decimal): void {
    if (quantity.isZero() || quantity.isNegative()) throw new InvalidQuantityError();
  }

  private requireProduct(id: number): void {
    const n = this.orm.select({ n: count() }).from(products).where(eq(products.id, id)).get();
    if (countOf(n?.n) === 0) throw new NotFoundError();
  }

  private purchaseQuery() {
    return this.orm
      .select({
        ID: purchases.id,
        ProductID: purchases.productId,
        StoryID: purchases.storyId,
        Kind: purchases.kind,
        ReceiptID: purchases.receiptId,
        BoughtOn: purchases.boughtOn,
        Quantity: purchases.quantity,
        Amount: purchases.amount,
        CreatedAt: purchases.createdAt,
      })
      .from(purchases);
  }

  private mapPurchases(rows: PurchaseRow[]): Purchase[] {
    return rows.map((r) => this.mapPurchase(r));
  }

  private mapPurchase(r: PurchaseRow): Purchase {
    return {
      ID: r.ID,
      ProductID: r.ProductID,
      StoryID: r.StoryID ?? 0,
      Kind: String(r.Kind) as PurchaseKind,
      ReceiptID: r.ReceiptID ?? 0,
      BoughtOn: r.BoughtOn,
      Quantity: new Decimal(String(r.Quantity)),
      Amount: new Decimal(String(r.Amount)),
      CreatedAt: r.CreatedAt,
    };
  }
}
