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
import { type MergePlan, type Product, type ProductConversion, type ProductListItem, type ProductQuote } from './products.models';
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
    return items.map((it) => ({ product: this.asProduct(it), quote: it.quote }));
  }

  getProduct(id: number): Product {
    const p = this.getProductRow(id);
    p.conversions = this.listProductConversions(id);
    return p;
  }

  createProduct(name: string, unitId: number, image: string | null, conversions: ProductConversion[] = []): Product {
    try {
      this.units.getUnit(unitId);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    if (this.aliases.aliasExistsExcept(name, 0)) throw new DuplicateError();
    const id = this.db.immediate(() => {
      const pid = lastId(
        this.orm
          .insert(products)
          .values({ name, unitId, imagePath: image, createdAt: nowRFC3339() })
          .run(),
      );
      this.setProductConversions(pid, unitId, conversions);
      return pid;
    });
    return this.getProduct(id);
  }

  updateProduct(
    id: number,
    name: string,
    unitId: number,
    imagePathVal: string | null,
    clearImage: boolean,
    conversions?: ProductConversion[],
  ): void {
    try {
      this.units.getUnit(unitId);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    if (this.aliases.aliasExistsExcept(name, id)) throw new DuplicateError();
    const cur = this.getProduct(id);
    if (unitId !== cur.unitId) throw new InvalidUnitError();
    let path: string | null;
    if (clearImage) path = null;
    else if (imagePathVal !== null) path = imagePathVal;
    else path = cur.imagePath;
    this.db.immediate(() => {
      const n = changesOf(
        this.orm.update(products).set({ name, unitId, imagePath: path }).where(eq(products.id, id)).run(),
      );
      if (n === 0) throw new NotFoundError();
      if (conversions) this.setProductConversions(id, unitId, conversions);
    });
  }

  deleteProduct(id: number): string {
    const p = this.getProduct(id);
    this.orm.delete(products).where(eq(products.id, id)).run();
    return p.imagePath ?? '';
  }

  changePurchaseUnit(productId: number, newUnitId: number): void {
    const p = this.getProduct(productId);
    if (newUnitId === p.unitId) throw new InvalidUnitError();
    const conv = p.conversions.find((c) => c.unitId === newUnitId);
    if (!conv) throw new InvalidConversionError();
    const factor = conv.factor;
    this.db.immediate(() => {
      this.orm.update(products).set({ unitId: newUnitId }).where(eq(products.id, productId)).run();
      const buys = this.purchases.listPurchasesAsc(productId);
      for (const buy of buys) {
        this.orm
          .update(purchases)
          .set({ quantity: buy.quantity.mul(factor).toString() })
          .where(eq(purchases.id, buy.id))
          .run();
      }
      this.setProductConversions(productId, newUnitId, this.rebaseConversions(p.conversions, p.unitId, newUnitId, factor));
    });
  }

  mergePlan(intoId: number, fromId: number): MergePlan {
    const { into, from } = this.mergePair(intoId, fromId);
    const history = this.purchases.listPurchases(from.id);
    const aliases = this.aliases.listAliasesByProduct(from.id);
    const plan: MergePlan = {
      into,
      from,
      history: history.length,
      aliases: aliases.length,
      nameAsAlias: '',
      takePhoto: !into.imagePath && Boolean(from.imagePath),
    };
    const fromName = from.name.trim();
    if (fromName !== '' && fromName.toLowerCase() !== into.name.trim().toLowerCase()) plan.nameAsAlias = fromName;
    this.conversionMergeConflict(into.conversions, from.conversions);
    return plan;
  }

  mergeProducts(intoId: number, fromId: number): { keeper: Product; dropImage: string } {
    if (intoId === fromId) throw new SameProductError();
    return this.db.immediate(() => {
      const into = this.getProductRow(intoId);
      const from = this.getProductRow(fromId);
      into.conversions = this.listProductConversions(into.id);
      from.conversions = this.listProductConversions(from.id);
      if (into.unitId !== from.unitId) throw new UnitMismatchError();
      this.mergeConversions(into.id, from.id);
      this.purchases.reassignProduct(from.id, into.id);
      this.aliases.reassignProduct(from.id, into.id, into.name);
      this.groups.reassignProduct(from.id, into.id);
      const dropImage = this.handOffImage(into, from);
      this.orm.delete(products).where(eq(products.id, from.id)).run();
      this.maybeAliasDroppedName(into.id, into.name, from.name);
      return { keeper: this.getProduct(into.id), dropImage };
    });
  }

  listProductConversions(productId: number): ProductConversion[] {
    return this.orm
      .select({
        unitId: productUnitConversions.unitId,
        unitName: units.name,
        factor: productUnitConversions.factor,
      })
      .from(productUnitConversions)
      .innerJoin(units, eq(units.id, productUnitConversions.unitId))
      .where(eq(productUnitConversions.productId, productId))
      .orderBy(nocaseOrder(units.name))
      .all()
      .map((r) => ({ unitId: r.unitId, unitName: r.unitName, factor: new Decimal(r.factor) }));
  }

  getProductRow(id: number): Product {
    const row = this.productQuery().where(eq(products.id, id)).get();
    if (!row) throw new NotFoundError();
    return mapProduct(row);
  }

  insertImported(name: string, unitId: number): Product {
    const n = this.orm.select({ n: count() }).from(units).where(eq(units.id, unitId)).get();
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
        .values({ name, unitId, imagePath: null, createdAt: nowRFC3339() })
        .run(),
    );
    return this.getProductRow(id);
  }

  findProductByName(name: string, storyId: number | null): Product {
    name = name.trim();
    if (name === '') throw new NotFoundError();
    if (storyId) {
      try {
        return this.productByAlias(name, storyId, null);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      const chainId = this.locations.storyChainID(storyId);
      if (chainId) {
        try {
          return this.productByAlias(name, null, chainId);
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
      }
    }
    try {
      return this.productByAlias(name, null, null);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const row = this.productQuery().where(nocaseEq(products.name, name)).orderBy(products.id).limit(1).get();
    if (!row) throw new NotFoundError();
    return mapProduct(row);
  }

  productByAlias(aliasName: string, storyId: number | null, chainId: number | null): Product {
    aliasName = aliasName.trim();
    if (aliasName === '') throw new NotFoundError();
    const scope = storyId
      ? and(nocaseEq(productAliases.alias, aliasName), eq(productAliases.storyId, storyId))
      : chainId
        ? and(nocaseEq(productAliases.alias, aliasName), eq(productAliases.retailChainId, chainId))
        : and(nocaseEq(productAliases.alias, aliasName), isNull(productAliases.storyId), isNull(productAliases.retailChainId));
    const row = this.orm
      .select({
        id: products.id,
        name: products.name,
        unitId: products.unitId,
        unitName: units.name,
        imagePath: products.imagePath,
        createdAt: products.createdAt,
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
    if (into.imagePath) {
      if (from.imagePath && from.imagePath !== into.imagePath) return from.imagePath;
      return '';
    }
    if (!from.imagePath) return '';
    this.orm.update(products).set({ imagePath: from.imagePath }).where(eq(products.id, into.id)).run();
    this.orm.update(products).set({ imagePath: null }).where(eq(products.id, from.id)).run();
    return '';
  }

  private maybeAliasDroppedName(intoId: number, intoName: string, fromName: string): void {
    fromName = fromName.trim();
    if (fromName === '' || fromName.toLowerCase() === intoName.trim().toLowerCase()) return;
    try {
      this.aliases.createAlias(intoId, null, null, fromName);
    } catch (err) {
      if (err instanceof DuplicateError) return;
      throw err;
    }
  }

  private mergePair(intoId: number, fromId: number): { into: Product; from: Product } {
    if (intoId === fromId) throw new SameProductError();
    const into = this.getProduct(intoId);
    const from = this.getProduct(fromId);
    if (into.unitId !== from.unitId) throw new UnitMismatchError();
    return { into, from };
  }

  private listProductsAt(q: string, now: Date, limit: number): ProductListItem[] {
    q = q.trim();
    const rows = this.productQuery().orderBy(nocaseOrder(products.name)).all();
    const items: ProductListItem[] = rows.map((r) => ({
      ...mapProduct(r),
      lastBought: null,
      lifetimeAmount: new Decimal(0),
      purchaseCount: 0,
      quote: null,
    }));
    const index = new Map<number, number>();
    items.forEach((it, i) => index.set(it.id, i));
    if (items.length === 0) return items;
    const prows = this.orm
      .select({ productId: purchases.productId, boughtOn: purchases.boughtOn, amount: purchases.amount })
      .from(purchases)
      .where(eq(purchases.kind, KIND_PURCHASE))
      .all();
    for (const pr of prows) {
      const i = index.get(pr.productId);
      if (i === undefined) continue;
      items[i]!.lifetimeAmount = items[i]!.lifetimeAmount.add(new Decimal(pr.amount));
      items[i]!.purchaseCount++;
      if (!items[i]!.lastBought || pr.boughtOn > items[i]!.lastBought) {
        items[i]!.lastBought = pr.boughtOn;
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
      const list = labels.get(a.productId) ?? [];
      list.push(a.alias);
      labels.set(a.productId, list);
    }
    const hits: { item: ProductListItem; score: number }[] = [];
    for (const it of items) {
      const labs = [it.name, ...(labels.get(it.id) ?? [])];
      const score = search(q, ...labs);
      if (score <= 0) continue;
      hits.push({ item: it, score });
    }
    hits.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.item.name.toLowerCase() < b.item.name.toLowerCase() ? -1 : 1;
    });
    return hits.map((h) => h.item);
  }

  private attachItemConversions(items: ProductListItem[]): void {
    const rows = this.orm
      .select({
        productId: productUnitConversions.productId,
        unitId: productUnitConversions.unitId,
        unitName: units.name,
        factor: productUnitConversions.factor,
      })
      .from(productUnitConversions)
      .innerJoin(units, eq(units.id, productUnitConversions.unitId))
      .orderBy(nocaseOrder(units.name))
      .all();
    const byId = new Map<number, ProductConversion[]>();
    for (const r of rows) {
      const list = byId.get(r.productId) ?? [];
      list.push({ unitId: r.unitId, unitName: r.unitName, factor: new Decimal(r.factor) });
      byId.set(r.productId, list);
    }
    for (const it of items) it.conversions = byId.get(it.id) ?? [];
  }

  private attachProductQuotes(items: ProductListItem[], now: Date): void {
    if (items.length === 0) return;
    const buys = this.purchases.listPurchasesForProductIDs(items.map((it) => it.id));
    const quotes = quotesByProduct(buys, now);
    for (const it of items) {
      const q = quotes.get(it.id);
      if (q) it.quote = q;
    }
  }

  private productQuery() {
    return this.orm
      .select({
        id: products.id,
        name: products.name,
        unitId: products.unitId,
        unitName: units.name,
        imagePath: products.imagePath,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(units, eq(units.id, products.unitId));
  }

  private asProduct(it: ProductListItem): Product {
    return {
      id: it.id,
      name: it.name,
      unitId: it.unitId,
      unitName: it.unitName,
      imagePath: it.imagePath,
      createdAt: it.createdAt,
      conversions: it.conversions,
    };
  }

  private setProductConversions(productId: number, purchaseUnitId: number, conversions: ProductConversion[]): void {
    const normalized = this.normalizeConversions(purchaseUnitId, conversions);
    this.orm.delete(productUnitConversions).where(eq(productUnitConversions.productId, productId)).run();
    for (const c of normalized) {
      this.orm
        .insert(productUnitConversions)
        .values({ productId, unitId: c.unitId, factor: c.factor.toString() })
        .run();
    }
  }

  private normalizeConversions(purchaseUnitId: number, conversions: ProductConversion[]): ProductConversion[] {
    const seen = new Set<number>();
    const out: ProductConversion[] = [];
    for (const c of conversions) {
      if (c.unitId === 0) continue;
      if (c.unitId === purchaseUnitId) throw new InvalidConversionError();
      if (seen.has(c.unitId)) throw new InvalidConversionError();
      if (c.factor.isNegative() || c.factor.isZero()) throw new InvalidConversionError();
      const n = this.orm.select({ n: count() }).from(units).where(eq(units.id, c.unitId)).get();
      if (countOf(n?.n) === 0) throw new InvalidUnitError();
      seen.add(c.unitId);
      out.push(c);
    }
    return out;
  }

  private rebaseConversions(
    convs: ProductConversion[],
    oldUnitId: number,
    newUnitId: number,
    factor: Decimal,
  ): ProductConversion[] {
    const out: ProductConversion[] = [];
    for (const c of convs) {
      if (c.unitId === newUnitId) continue;
      out.push({ unitId: c.unitId, unitName: c.unitName, factor: c.factor.div(factor) });
    }
    out.push({ unitId: oldUnitId, unitName: '', factor: new Decimal(1).div(factor) });
    return out;
  }

  private mergeConversions(intoId: number, fromId: number): void {
    const into = this.listProductConversions(intoId);
    const from = this.listProductConversions(fromId);
    this.conversionMergeConflict(into, from);
    const intoByUnit = new Set(into.map((c) => c.unitId));
    for (const c of from) {
      if (intoByUnit.has(c.unitId)) continue;
      this.orm
        .insert(productUnitConversions)
        .values({ productId: intoId, unitId: c.unitId, factor: c.factor.toString() })
        .run();
    }
  }

  private conversionMergeConflict(into: ProductConversion[], from: ProductConversion[]): void {
    const intoByUnit = new Map(into.map((c) => [c.unitId, c]));
    for (const c of from) {
      const existing = intoByUnit.get(c.unitId);
      if (existing && !existing.factor.eq(c.factor)) throw new ConversionConflictError(c.unitName);
    }
  }
}
