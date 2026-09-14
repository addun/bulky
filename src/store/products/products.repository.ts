import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DatabaseService } from '../../db/database.service';
import { changesOf, countOf, lastId, nocaseEq, nocaseOrder } from '../../db/query';
import { productAliases, productUnitConversions, products, purchases, units } from '../../db/schema';
import {
  ConversionConflictError,
  DuplicateError,
  InvalidConversionError,
  InvalidUnitError,
  NotFoundError,
  SameProductError,
  UnitMismatchError,
} from '../../domain/errors';
import { search } from '../../domain/match';
import { quotesByProduct } from '../../domain/price-stats';
import type { ProductAlias } from '../aliases/aliases.models';
import { KIND_PURCHASE } from '../purchases/purchases.models';
import { emptyImage, type MergePlan, type Product, type ProductConversion, type ProductListItem, type ProductQuote } from './products.models';
import { AliasesRepository } from '@app/store/aliases';
import { ComparisonGroupsRepository } from '@app/store/comparison-groups';
import { LocationsRepository } from '@app/store/locations';
import { nowRFC3339 } from '@app/store/now';
import { mapProduct } from './product-row';
import { PurchasesRepository } from '@app/store/purchases';
import { UnitsRepository } from '@app/store/units';

@Injectable()
export class ProductsRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly units: UnitsRepository,
    private readonly aliases: AliasesRepository,
    private readonly purchases: PurchasesRepository,
    private readonly groups: ComparisonGroupsRepository,
    private readonly locations: LocationsRepository,
  ) {}

  private get orm() {
    return this.db.drizzle;
  }

  listProducts(q: string): ProductListItem[] {
    return this.listProductsAt(q, new Date(), 0);
  }

  searchProductQuotes(q: string, now: Date, limit: number): ProductQuote[] {
    q = q.trim();
    if (q === '') return [];
    const items = this.listProductsAt(q, now, limit);
    return items.map((it) => ({ Product: this.asProduct(it), Quote: it.Quote }));
  }

  getProduct(id: number): Product {
    const p = this.getProductRow(id);
    p.Conversions = this.listProductConversions(id);
    return p;
  }

  createProduct(name: string, unitID: number, image: string | null, conversions: ProductConversion[] = []): Product {
    try {
      this.units.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    if (this.aliases.aliasExistsExcept(name, 0)) throw new DuplicateError();
    const id = this.db.immediate(() => {
      const pid = lastId(
        this.orm
          .insert(products)
          .values({ name, unitId: unitID, imagePath: image, createdAt: nowRFC3339() })
          .run(),
      );
      this.setProductConversions(pid, unitID, conversions);
      return pid;
    });
    return this.getProduct(id);
  }

  updateProduct(
    id: number,
    name: string,
    unitID: number,
    imagePathVal: string | null,
    clearImage: boolean,
    conversions?: ProductConversion[],
  ): void {
    try {
      this.units.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    if (this.aliases.aliasExistsExcept(name, id)) throw new DuplicateError();
    const cur = this.getProduct(id);
    if (unitID !== cur.UnitID) throw new InvalidUnitError();
    let path: string | null;
    if (clearImage) path = null;
    else if (imagePathVal !== null) path = imagePathVal;
    else path = cur.ImagePath.Valid ? cur.ImagePath.String : null;
    this.db.immediate(() => {
      const n = changesOf(
        this.orm.update(products).set({ name, unitId: unitID, imagePath: path }).where(eq(products.id, id)).run(),
      );
      if (n === 0) throw new NotFoundError();
      if (conversions) this.setProductConversions(id, unitID, conversions);
    });
  }

  deleteProduct(id: number): string {
    const p = this.getProduct(id);
    this.orm.delete(products).where(eq(products.id, id)).run();
    return p.ImagePath.Valid ? p.ImagePath.String : '';
  }

  changePurchaseUnit(productID: number, newUnitID: number): void {
    const p = this.getProduct(productID);
    if (newUnitID === p.UnitID) throw new InvalidUnitError();
    const conv = p.Conversions.find((c) => c.UnitID === newUnitID);
    if (!conv) throw new InvalidConversionError();
    const factor = conv.Factor;
    this.db.immediate(() => {
      this.orm.update(products).set({ unitId: newUnitID }).where(eq(products.id, productID)).run();
      const buys = this.purchases.listPurchasesAsc(productID);
      for (const buy of buys) {
        this.orm
          .update(purchases)
          .set({ quantity: buy.Quantity.mul(factor).toString() })
          .where(eq(purchases.id, buy.ID))
          .run();
      }
      this.setProductConversions(productID, newUnitID, this.rebaseConversions(p.Conversions, p.UnitID, newUnitID, factor));
    });
  }

  mergePlan(intoID: number, fromID: number): MergePlan {
    const { into, from } = this.mergePair(intoID, fromID);
    const history = this.purchases.listPurchases(from.ID);
    const aliases = this.aliases.listAliasesByProduct(from.ID);
    const plan: MergePlan = {
      Into: into,
      From: from,
      History: history.length,
      Aliases: aliases.length,
      NameAsAlias: '',
      TakePhoto: !into.ImagePath.Valid && from.ImagePath.Valid,
    };
    const fromName = from.Name.trim();
    if (fromName !== '' && fromName.toLowerCase() !== into.Name.trim().toLowerCase()) plan.NameAsAlias = fromName;
    this.conversionMergeConflict(into.Conversions, from.Conversions);
    return plan;
  }

  mergeProducts(intoID: number, fromID: number): { keeper: Product; dropImage: string } {
    if (intoID === fromID) throw new SameProductError();
    return this.db.immediate(() => {
      const into = this.getProductRow(intoID);
      const from = this.getProductRow(fromID);
      into.Conversions = this.listProductConversions(into.ID);
      from.Conversions = this.listProductConversions(from.ID);
      if (into.UnitID !== from.UnitID) throw new UnitMismatchError();
      this.mergeConversions(into.ID, from.ID);
      this.purchases.reassignProduct(from.ID, into.ID);
      this.aliases.reassignProduct(from.ID, into.ID, into.Name);
      this.groups.reassignProduct(from.ID, into.ID);
      const dropImage = this.handOffImage(into, from);
      this.orm.delete(products).where(eq(products.id, from.ID)).run();
      this.maybeAliasDroppedName(into.ID, into.Name, from.Name);
      return { keeper: this.getProduct(into.ID), dropImage };
    });
  }

  listProductConversions(productID: number): ProductConversion[] {
    return this.orm
      .select({
        UnitID: productUnitConversions.unitId,
        UnitName: units.name,
        Factor: productUnitConversions.factor,
      })
      .from(productUnitConversions)
      .innerJoin(units, eq(units.id, productUnitConversions.unitId))
      .where(eq(productUnitConversions.productId, productID))
      .orderBy(nocaseOrder(units.name))
      .all()
      .map((r) => ({ UnitID: r.UnitID, UnitName: r.UnitName, Factor: new Decimal(r.Factor) }));
  }

  getProductRow(id: number): Product {
    const row = this.productQuery().where(eq(products.id, id)).get();
    if (!row) throw new NotFoundError();
    return mapProduct(row);
  }

  insertImported(name: string, unitID: number): Product {
    const n = this.orm.select({ n: count() }).from(units).where(eq(units.id, unitID)).get();
    if (countOf(n?.n) === 0) throw new InvalidUnitError();
    const aliasCount = this.orm
      .select({ n: count() })
      .from(productAliases)
      .where(nocaseEq(productAliases.alias, name))
      .get();
    if (countOf(aliasCount?.n) > 0) throw new DuplicateError();
    const id = lastId(
      this.orm
        .insert(products)
        .values({ name, unitId: unitID, imagePath: null, createdAt: nowRFC3339() })
        .run(),
    );
    return this.getProductRow(id);
  }

  findProductByName(name: string, storyID: number): Product {
    name = name.trim();
    if (name === '') throw new NotFoundError();
    if (storyID > 0) {
      try {
        return this.productByAlias(name, storyID, 0);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      const chainID = this.locations.storyChainID(storyID);
      if (chainID > 0) {
        try {
          return this.productByAlias(name, 0, chainID);
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
      }
    }
    try {
      return this.productByAlias(name, 0, 0);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const row = this.productQuery().where(nocaseEq(products.name, name)).orderBy(products.id).limit(1).get();
    if (!row) throw new NotFoundError();
    return mapProduct(row);
  }

  productByAlias(aliasName: string, storyID: number, chainID: number): Product {
    aliasName = aliasName.trim();
    if (aliasName === '') throw new NotFoundError();
    const scope =
      storyID > 0
        ? and(nocaseEq(productAliases.alias, aliasName), eq(productAliases.storyId, storyID))
        : chainID > 0
          ? and(nocaseEq(productAliases.alias, aliasName), eq(productAliases.retailChainId, chainID))
          : and(nocaseEq(productAliases.alias, aliasName), isNull(productAliases.storyId), isNull(productAliases.retailChainId));
    const row = this.orm
      .select({
        ID: products.id,
        Name: products.name,
        UnitID: products.unitId,
        UnitName: units.name,
        image_path: products.imagePath,
        CreatedAt: products.createdAt,
      })
      .from(productAliases)
      .innerJoin(products, eq(products.id, productAliases.productId))
      .innerJoin(units, eq(units.id, products.unitId))
      .where(scope)
      .orderBy(productAliases.id)
      .limit(1)
      .get();
    if (!row) throw new NotFoundError();
    return mapProduct(row);
  }

  private handOffImage(into: Product, from: Product): string {
    if (into.ImagePath.Valid) {
      if (from.ImagePath.Valid && from.ImagePath.String !== into.ImagePath.String) return from.ImagePath.String;
      return '';
    }
    if (!from.ImagePath.Valid) return '';
    this.orm.update(products).set({ imagePath: from.ImagePath.String }).where(eq(products.id, into.ID)).run();
    this.orm.update(products).set({ imagePath: null }).where(eq(products.id, from.ID)).run();
    return '';
  }

  private maybeAliasDroppedName(intoID: number, intoName: string, fromName: string): void {
    fromName = fromName.trim();
    if (fromName === '' || fromName.toLowerCase() === intoName.trim().toLowerCase()) return;
    try {
      this.aliases.createAlias(intoID, 0, 0, fromName);
    } catch (err) {
      if (err instanceof DuplicateError) return;
      throw err;
    }
  }

  private mergePair(intoID: number, fromID: number): { into: Product; from: Product } {
    if (intoID === fromID) throw new SameProductError();
    const into = this.getProduct(intoID);
    const from = this.getProduct(fromID);
    if (into.UnitID !== from.UnitID) throw new UnitMismatchError();
    return { into, from };
  }

  private listProductsAt(q: string, now: Date, limit: number): ProductListItem[] {
    q = q.trim();
    const rows = this.productQuery().orderBy(nocaseOrder(products.name)).all();
    const items: ProductListItem[] = rows.map((r) => ({
      ...mapProduct(r),
      LastBought: emptyImage(),
      LifetimeAmount: new Decimal(0),
      PurchaseCount: 0,
      Quote: null,
    }));
    const index = new Map<number, number>();
    items.forEach((it, i) => index.set(it.ID, i));
    if (items.length === 0) return items;
    const prows = this.orm
      .select({ ProductID: purchases.productId, BoughtOn: purchases.boughtOn, Amount: purchases.amount })
      .from(purchases)
      .where(eq(purchases.kind, KIND_PURCHASE))
      .all();
    for (const pr of prows) {
      const i = index.get(pr.ProductID);
      if (i === undefined) continue;
      items[i]!.LifetimeAmount = items[i]!.LifetimeAmount.add(new Decimal(pr.Amount));
      items[i]!.PurchaseCount++;
      if (!items[i]!.LastBought.Valid || pr.BoughtOn > items[i]!.LastBought.String) {
        items[i]!.LastBought = { Valid: true, String: pr.BoughtOn };
      }
    }
    this.attachItemConversions(items);
    let out = items;
    if (q !== '') out = this.filterProductSearch(out, q, this.aliases.listAliases());
    if (limit > 0 && out.length > limit) out = out.slice(0, limit);
    this.attachProductQuotes(out, now);
    return out;
  }

  private filterProductSearch(items: ProductListItem[], q: string, aliases: ProductAlias[]): ProductListItem[] {
    const labels = new Map<number, string[]>();
    for (const a of aliases) {
      const list = labels.get(a.ProductID) ?? [];
      list.push(a.Alias);
      labels.set(a.ProductID, list);
    }
    const hits: { item: ProductListItem; score: number }[] = [];
    for (const it of items) {
      const labs = [it.Name, ...(labels.get(it.ID) ?? [])];
      const score = search(q, ...labs);
      if (score <= 0) continue;
      hits.push({ item: it, score });
    }
    hits.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.item.Name.toLowerCase() < b.item.Name.toLowerCase() ? -1 : 1;
    });
    return hits.map((h) => h.item);
  }

  private attachItemConversions(items: ProductListItem[]): void {
    const rows = this.orm
      .select({
        ProductID: productUnitConversions.productId,
        UnitID: productUnitConversions.unitId,
        UnitName: units.name,
        Factor: productUnitConversions.factor,
      })
      .from(productUnitConversions)
      .innerJoin(units, eq(units.id, productUnitConversions.unitId))
      .orderBy(nocaseOrder(units.name))
      .all();
    const byID = new Map<number, ProductConversion[]>();
    for (const r of rows) {
      const list = byID.get(r.ProductID) ?? [];
      list.push({ UnitID: r.UnitID, UnitName: r.UnitName, Factor: new Decimal(r.Factor) });
      byID.set(r.ProductID, list);
    }
    for (const it of items) it.Conversions = byID.get(it.ID) ?? [];
  }

  private attachProductQuotes(items: ProductListItem[], now: Date): void {
    if (items.length === 0) return;
    const buys = this.purchases.listPurchasesForProductIDs(items.map((it) => it.ID));
    const quotes = quotesByProduct(buys, now);
    for (const it of items) {
      const q = quotes.get(it.ID);
      if (q) it.Quote = q;
    }
  }

  private productQuery() {
    return this.orm
      .select({
        ID: products.id,
        Name: products.name,
        UnitID: products.unitId,
        UnitName: units.name,
        image_path: products.imagePath,
        CreatedAt: products.createdAt,
      })
      .from(products)
      .innerJoin(units, eq(units.id, products.unitId));
  }

  private asProduct(it: ProductListItem): Product {
    return {
      ID: it.ID,
      Name: it.Name,
      UnitID: it.UnitID,
      UnitName: it.UnitName,
      ImagePath: it.ImagePath,
      CreatedAt: it.CreatedAt,
      Conversions: it.Conversions,
    };
  }

  private setProductConversions(productID: number, purchaseUnitID: number, conversions: ProductConversion[]): void {
    const normalized = this.normalizeConversions(purchaseUnitID, conversions);
    this.orm.delete(productUnitConversions).where(eq(productUnitConversions.productId, productID)).run();
    for (const c of normalized) {
      this.orm
        .insert(productUnitConversions)
        .values({ productId: productID, unitId: c.UnitID, factor: c.Factor.toString() })
        .run();
    }
  }

  private normalizeConversions(purchaseUnitID: number, conversions: ProductConversion[]): ProductConversion[] {
    const seen = new Set<number>();
    const out: ProductConversion[] = [];
    for (const c of conversions) {
      if (c.UnitID === 0) continue;
      if (c.UnitID === purchaseUnitID) throw new InvalidConversionError();
      if (seen.has(c.UnitID)) throw new InvalidConversionError();
      if (c.Factor.isNegative() || c.Factor.isZero()) throw new InvalidConversionError();
      const n = this.orm.select({ n: count() }).from(units).where(eq(units.id, c.UnitID)).get();
      if (countOf(n?.n) === 0) throw new InvalidUnitError();
      seen.add(c.UnitID);
      out.push(c);
    }
    return out;
  }

  private rebaseConversions(
    convs: ProductConversion[],
    oldUnitID: number,
    newUnitID: number,
    factor: Decimal,
  ): ProductConversion[] {
    const out: ProductConversion[] = [];
    for (const c of convs) {
      if (c.UnitID === newUnitID) continue;
      out.push({ UnitID: c.UnitID, UnitName: c.UnitName, Factor: c.Factor.div(factor) });
    }
    out.push({ UnitID: oldUnitID, UnitName: '', Factor: new Decimal(1).div(factor) });
    return out;
  }

  private mergeConversions(intoID: number, fromID: number): void {
    const into = this.listProductConversions(intoID);
    const from = this.listProductConversions(fromID);
    this.conversionMergeConflict(into, from);
    const intoByUnit = new Set(into.map((c) => c.UnitID));
    for (const c of from) {
      if (intoByUnit.has(c.UnitID)) continue;
      this.orm
        .insert(productUnitConversions)
        .values({ productId: intoID, unitId: c.UnitID, factor: c.Factor.toString() })
        .run();
    }
  }

  private conversionMergeConflict(into: ProductConversion[], from: ProductConversion[]): void {
    const intoByUnit = new Map(into.map((c) => [c.UnitID, c]));
    for (const c of from) {
      const existing = intoByUnit.get(c.UnitID);
      if (existing && !existing.Factor.eq(c.Factor)) throw new ConversionConflictError(c.UnitName);
    }
  }
}
