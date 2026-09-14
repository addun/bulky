import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias as tableAlias } from 'drizzle-orm/sqlite-core';
import Decimal from 'decimal.js';
import { DatabaseService } from '../db/database.service';
import { changesOf, countOf, emptyStr, int0, lastId, nocaseEq, nocaseOrder } from '../db/query';
import {
  comparisonGroupProducts,
  comparisonGroups,
  productAliases,
  productUnitConversions,
  products,
  purchases,
  receipts,
  retailChains,
  settings,
  stories,
  units,
} from '../db/schema';
import {
  AliasScopeError,
  ComparisonGroupNameError,
  ConversionConflictError,
  DuplicateError,
  InvalidAliasError,
  InvalidComparisonGroupError,
  InvalidConversionError,
  InvalidKindError,
  InvalidQuantityError,
  InvalidRetailChainError,
  InvalidSettingError,
  InvalidStoryError,
  InvalidUnitError,
  NotFoundError,
  ReceiptMigratedError,
  ReceiptNotReadyError,
  RetailChainInUseError,
  RetailChainLegalNameError,
  RetailChainNameError,
  RetailChainTaxIDError,
  SameProductError,
  StoryBuildingError,
  StoryCityError,
  StoryInUseError,
  StoryNameError,
  StoryPostalError,
  StoryStreetError,
  UnitInUseError,
  UnitMismatchError,
  isUniqueErr,
} from '../domain/errors';
import { search } from '../domain/match';
import { normalizeBoughtOn } from '../domain/bought-on';
import { lastPricesByProduct, quotesByProduct } from '../domain/price-stats';
import {
  KIND_PRICE,
  KIND_PURCHASE,
  RECEIPT_FAILED,
  RECEIPT_MIGRATED,
  RECEIPT_PENDING,
  RECEIPT_READY,
  RECEIPT_SOURCE_OCR,
  SETTING_OCR_MODEL,
  SETTING_PIECE_UNIT_ID,
  SETTING_WEIGHT_UNIT_ID,
  type BillImport,
  type BillImportResult,
  type BillLineInput,
  type ComparisonGroup,
  type ComparisonOffer,
  type GroupComparison,
  type MergePlan,
  type Product,
  type ProductAlias,
  type ProductConversion,
  type ProductListItem,
  type ProductQuote,
  type Purchase,
  type PurchaseKind,
  type Receipt,
  type ReceiptPurchase,
  type RelatedProduct,
  type RetailChain,
  type Story,
  type Unit,
  type UnitDefaults,
  emptyImage,
  imagePath,
} from '../domain/types';

const unitUseCount = sql<number>`cast((
  select count(*) from products p where p.unit_id = ${units.id}
) + (
  select count(*) from product_unit_conversions c where c.unit_id = ${units.id}
) as integer)`.mapWith(Number);

const chainStoryCount = sql<number>`cast((
  select count(*) from stories s where s.retail_chain_id = ${retailChains.id}
) as integer)`.mapWith(Number);

const groupMemberCount = sql<number>`cast((
  select count(*) from comparison_group_products m where m.group_id = ${comparisonGroups.id}
) as integer)`.mapWith(Number);

type ProductRow = {
  ID: number;
  Name: string;
  UnitID: number;
  UnitName: string;
  image_path: string | null;
  CreatedAt: string;
};

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

type ComparisonMemberRow = {
  GroupID: number;
  GroupName: string;
  GroupUnitID: number;
  GroupUnitName: string;
  ProductID: number;
  ProductName: string;
  ProductUnitID: number;
  ConversionFactor: string | null;
};

@Injectable()
export class StoreService {
  constructor(private readonly db: DatabaseService) {}

  private get orm() {
    return this.db.drizzle;
  }

  dataDir(): string {
    return this.db.dataDirPath();
  }

  imagesDir(): string {
    return this.db.imagesDirPath();
  }

  immediate<T>(fn: () => T): T {
    return this.db.immediate(fn);
  }

  nowRFC3339(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  // --- units ---

  listUnits(): Unit[] {
    return this.orm
      .select({ ID: units.id, Name: units.name, ProductCount: unitUseCount })
      .from(units)
      .orderBy(nocaseOrder(units.name))
      .all();
  }

  getUnit(id: number): Unit {
    const row = this.orm
      .select({ ID: units.id, Name: units.name, ProductCount: unitUseCount })
      .from(units)
      .where(eq(units.id, id))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  findUnitByName(name: string): Unit {
    const row = this.orm
      .select({ ID: units.id, Name: units.name, ProductCount: unitUseCount })
      .from(units)
      .where(nocaseEq(units.name, name))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createUnit(name: string): Unit {
    name = name.trim();
    if (name === '') throw new InvalidUnitError();
    try {
      const id = lastId(this.orm.insert(units).values({ name }).run());
      return this.getUnit(id);
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  updateUnit(id: number, name: string): void {
    name = name.trim();
    if (name === '') throw new InvalidUnitError();
    try {
      const n = changesOf(this.orm.update(units).set({ name }).where(eq(units.id, id)).run());
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  deleteUnit(id: number): void {
    const u = this.getUnit(id);
    if (u.ProductCount > 0) throw new UnitInUseError();
    const groups = this.orm
      .select({ n: count() })
      .from(comparisonGroups)
      .where(eq(comparisonGroups.unitId, id))
      .get();
    if (countOf(groups?.n) > 0) throw new UnitInUseError();
    const n = changesOf(this.orm.delete(units).where(eq(units.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  // --- settings ---

  getSetting(key: string): string {
    const row = this.orm.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? '';
  }

  setSetting(key: string, value: string): void {
    key = key.trim();
    value = value.trim();
    if (key === '' || value === '') throw new InvalidSettingError();
    this.orm
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  unitDefaults(): UnitDefaults {
    return { PieceID: this.settingUnitID(SETTING_PIECE_UNIT_ID), WeightID: this.settingUnitID(SETTING_WEIGHT_UNIT_ID) };
  }

  setUnitDefaults(d: UnitDefaults): void {
    this.setSettingUnitID(SETTING_PIECE_UNIT_ID, d.PieceID);
    this.setSettingUnitID(SETTING_WEIGHT_UNIT_ID, d.WeightID);
  }

  ocrModel(): string {
    return this.getSetting(SETTING_OCR_MODEL);
  }

  private settingUnitID(key: string): number {
    const raw = this.getSetting(key);
    if (raw === '') return 0;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) return 0;
    try {
      this.getUnit(id);
      return id;
    } catch (err) {
      if (err instanceof NotFoundError) return 0;
      throw err;
    }
  }

  private setSettingUnitID(key: string, id: number): void {
    if (id === 0) {
      this.orm.delete(settings).where(eq(settings.key, key)).run();
      return;
    }
    try {
      this.getUnit(id);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    this.setSetting(key, String(id));
  }

  // --- chains ---

  listRetailChains(): RetailChain[] {
    return this.orm
      .select({
        ID: retailChains.id,
        Name: retailChains.name,
        LegalName: retailChains.legalName,
        TaxID: retailChains.taxId,
        StoryCount: chainStoryCount,
      })
      .from(retailChains)
      .orderBy(nocaseOrder(retailChains.name), retailChains.id)
      .all();
  }

  getRetailChain(id: number): RetailChain {
    const row = this.orm
      .select({
        ID: retailChains.id,
        Name: retailChains.name,
        LegalName: retailChains.legalName,
        TaxID: retailChains.taxId,
        StoryCount: chainStoryCount,
      })
      .from(retailChains)
      .where(eq(retailChains.id, id))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createRetailChain(name: string, legalName: string, taxID: string): RetailChain {
    const c = this.normalizeRetailChain(name, legalName, taxID);
    try {
      const id = lastId(
        this.orm.insert(retailChains).values({ name: c.Name, legalName: c.LegalName, taxId: c.TaxID }).run(),
      );
      return this.getRetailChain(id);
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  updateRetailChain(id: number, name: string, legalName: string, taxID: string): void {
    const c = this.normalizeRetailChain(name, legalName, taxID);
    try {
      const n = changesOf(
        this.orm
          .update(retailChains)
          .set({ name: c.Name, legalName: c.LegalName, taxId: c.TaxID })
          .where(eq(retailChains.id, id))
          .run(),
      );
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  deleteRetailChain(id: number): void {
    const c = this.getRetailChain(id);
    if (c.StoryCount > 0) throw new RetailChainInUseError();
    const n = changesOf(this.orm.delete(retailChains).where(eq(retailChains.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  private normalizeRetailChain(name: string, legalName: string, taxID: string): RetailChain {
    const c: RetailChain = {
      ID: 0,
      Name: name.trim(),
      LegalName: legalName.trim(),
      TaxID: this.normalizeTaxID(taxID),
      StoryCount: 0,
    };
    if (c.Name === '') throw new RetailChainNameError();
    if (c.LegalName === '') throw new RetailChainLegalNameError();
    if (c.TaxID === '') throw new RetailChainTaxIDError();
    return c;
  }

  private normalizeTaxID(s: string): string {
    return [...s.trim()].filter((r) => /[\p{L}\p{N}]/u.test(r)).join('').toUpperCase();
  }

  // --- stories ---

  listStories(): Story[] {
    return this.storyQuery().groupBy(stories.id).orderBy(nocaseOrder(stories.name), stories.id).all();
  }

  getStory(id: number): Story {
    const row = this.storyQuery().where(eq(stories.id, id)).groupBy(stories.id).get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createStory(
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalID: string,
    retailChainID: number,
  ): Story {
    const c = this.normalizeStory(name, streetName, building, apartment, postalCode, city, externalID);
    const id = this.insertStory(c, retailChainID);
    return this.getStory(id);
  }

  updateStory(
    id: number,
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalID: string,
    retailChainID: number,
  ): void {
    const c = this.normalizeStory(name, streetName, building, apartment, postalCode, city, externalID);
    const chain = this.optionalChain(retailChainID);
    try {
      const n = changesOf(
        this.orm
          .update(stories)
          .set({
            name: c.Name,
            streetName: c.StreetName,
            buildingNumber: c.BuildingNumber,
            apartmentNumber: c.ApartmentNumber,
            postalCode: c.PostalCode,
            city: c.City,
            externalId: c.ExternalID,
            retailChainId: chain,
          })
          .where(eq(stories.id, id))
          .run(),
      );
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof InvalidRetailChainError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  deleteStory(id: number): void {
    const c = this.getStory(id);
    if (c.PurchaseCount > 0) throw new StoryInUseError();
    const n = changesOf(this.orm.delete(stories).where(eq(stories.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  private storyQuery() {
    return this.orm
      .select({
        ID: stories.id,
        Name: stories.name,
        StreetName: stories.streetName,
        BuildingNumber: stories.buildingNumber,
        ApartmentNumber: stories.apartmentNumber,
        PostalCode: stories.postalCode,
        City: stories.city,
        ExternalID: stories.externalId,
        RetailChainID: int0(stories.retailChainId),
        RetailChainName: emptyStr(retailChains.name),
        PurchaseCount: sql<number>`cast(count(${purchases.id}) as integer)`.mapWith(Number),
      })
      .from(stories)
      .leftJoin(retailChains, eq(retailChains.id, stories.retailChainId))
      .leftJoin(purchases, eq(purchases.storyId, stories.id));
  }

  private insertStory(c: Story, retailChainID: number): number {
    const chain = this.optionalChain(retailChainID);
    try {
      return lastId(
        this.orm
          .insert(stories)
          .values({
            name: c.Name,
            streetName: c.StreetName,
            buildingNumber: c.BuildingNumber,
            apartmentNumber: c.ApartmentNumber,
            postalCode: c.PostalCode,
            city: c.City,
            externalId: c.ExternalID,
            retailChainId: chain,
          })
          .run(),
      );
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  private normalizeStory(
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalID: string,
  ): Story {
    const c: Story = {
      ID: 0,
      Name: name.trim(),
      StreetName: streetName.trim(),
      BuildingNumber: building.trim(),
      ApartmentNumber: apartment.trim(),
      PostalCode: postalCode.trim(),
      City: city.trim(),
      ExternalID: externalID.trim(),
      RetailChainID: 0,
      RetailChainName: '',
      PurchaseCount: 0,
    };
    if (c.Name === '') throw new StoryNameError();
    if (c.StreetName === '') throw new StoryStreetError();
    if (c.BuildingNumber === '') throw new StoryBuildingError();
    if (c.PostalCode === '') throw new StoryPostalError();
    if (c.City === '') throw new StoryCityError();
    return c;
  }

  private optionalStory(id: number): number | null {
    if (id === 0) return null;
    const n = this.orm.select({ n: count() }).from(stories).where(eq(stories.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidStoryError();
    return id;
  }

  private optionalChain(id: number): number | null {
    if (id === 0) return null;
    const n = this.orm.select({ n: count() }).from(retailChains).where(eq(retailChains.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidRetailChainError();
    return id;
  }

  // --- products ---

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
    name = name.trim();
    if (name === '') throw new Error('name is required');
    try {
      this.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    if (this.aliasExistsExcept(name, 0)) throw new DuplicateError();
    const id = this.immediate(() => {
      const pid = lastId(
        this.orm
          .insert(products)
          .values({ name, unitId: unitID, imagePath: image, createdAt: this.nowRFC3339() })
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
    name = name.trim();
    if (name === '') throw new Error('name is required');
    try {
      this.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    if (this.aliasExistsExcept(name, id)) throw new DuplicateError();
    const cur = this.getProduct(id);
    if (unitID !== cur.UnitID) throw new InvalidUnitError();
    let path: string | null;
    if (clearImage) path = null;
    else if (imagePathVal !== null) path = imagePathVal;
    else path = cur.ImagePath.Valid ? cur.ImagePath.String : null;
    this.immediate(() => {
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
    this.immediate(() => {
      this.orm.update(products).set({ unitId: newUnitID }).where(eq(products.id, productID)).run();
      const buys = this.listPurchasesAsc(productID);
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
    const history = this.listPurchases(from.ID);
    const aliases = this.listAliasesByProduct(from.ID);
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
    return this.immediate(() => {
      const into = this.getProductRow(intoID);
      const from = this.getProductRow(fromID);
      into.Conversions = this.listProductConversions(into.ID);
      from.Conversions = this.listProductConversions(from.ID);
      if (into.UnitID !== from.UnitID) throw new UnitMismatchError();
      this.mergeConversions(into.ID, from.ID);
      this.orm.update(purchases).set({ productId: into.ID }).where(eq(purchases.productId, from.ID)).run();
      this.orm.run(sql`
        DELETE FROM product_aliases
        WHERE product_aliases.product_id = ${from.ID}
          AND (
            product_aliases.alias = ${into.Name} COLLATE NOCASE
            OR EXISTS (
              SELECT 1 FROM product_aliases AS k
              WHERE k.product_id = ${into.ID}
                AND k.alias = product_aliases.alias COLLATE NOCASE
                AND (
                  (k.story_id IS NULL AND product_aliases.story_id IS NULL)
                  OR k.story_id = product_aliases.story_id
                )
            )
          )
      `);
      this.orm.update(productAliases).set({ productId: into.ID }).where(eq(productAliases.productId, from.ID)).run();
      const groupRows = this.orm
        .select({ groupId: comparisonGroupProducts.groupId })
        .from(comparisonGroupProducts)
        .where(eq(comparisonGroupProducts.productId, from.ID))
        .all();
      for (const row of groupRows) {
        this.orm
          .insert(comparisonGroupProducts)
          .values({ groupId: row.groupId, productId: into.ID })
          .onConflictDoNothing()
          .run();
      }
      const dropImage = this.handOffImage(into, from);
      this.orm.delete(products).where(eq(products.id, from.ID)).run();
      this.maybeAliasDroppedName(into.ID, into.Name, from.Name);
      return { keeper: this.getProduct(into.ID), dropImage };
    });
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
      this.createAlias(intoID, 0, 0, fromName);
    } catch (err) {
      if (err instanceof DuplicateError || err instanceof InvalidAliasError) return;
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
      ...this.mapProduct(r),
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
    if (q !== '') out = this.filterProductSearch(out, q, this.listAliases());
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
    const buys = this.listPurchasesForProductIDs(items.map((it) => it.ID));
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

  private mapProduct(row: ProductRow): Product {
    return {
      ID: row.ID,
      Name: row.Name,
      UnitID: row.UnitID,
      UnitName: row.UnitName,
      ImagePath: imagePath(row.image_path),
      CreatedAt: row.CreatedAt,
      Conversions: [],
    };
  }

  private getProductRow(id: number): Product {
    const row = this.productQuery().where(eq(products.id, id)).get();
    if (!row) throw new NotFoundError();
    return this.mapProduct(row);
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

  setProductConversionsPublic(productID: number, conversions: ProductConversion[]): void {
    const p = this.getProduct(productID);
    this.immediate(() => this.setProductConversions(productID, p.UnitID, conversions));
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

  // --- purchases ---

  listPurchases(productID: number): Purchase[] {
    return this.mapPurchases(
      this.purchaseQuery()
        .where(eq(purchases.productId, productID))
        .orderBy(desc(purchases.boughtOn), desc(purchases.id))
        .all(),
    );
  }

  private listPurchasesAsc(productID: number): Purchase[] {
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
    this.getProduct(productID);
    this.parsePurchaseKind(kind);
    const story = this.optionalStory(storyID);
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
          createdAt: this.nowRFC3339(),
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
    const story = this.optionalStory(storyID);
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

  private validQuantity(quantity: Decimal): void {
    if (quantity.isZero() || quantity.isNegative()) throw new InvalidQuantityError();
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

  listPurchasesForProductIDs(ids: number[]): Purchase[] {
    if (ids.length === 0) return [];
    return this.mapPurchases(
      this.purchaseQuery()
        .where(inArray(purchases.productId, ids))
        .orderBy(desc(purchases.boughtOn), desc(purchases.id))
        .all(),
    );
  }

  // --- aliases ---

  listAliases(): ProductAlias[] {
    return this.aliasQuery()
      .orderBy(
        nocaseOrder(products.name),
        nocaseOrder(stories.name),
        nocaseOrder(retailChains.name),
        nocaseOrder(productAliases.alias),
        productAliases.id,
      )
      .all();
  }

  listAliasesByProduct(productID: number): ProductAlias[] {
    return this.aliasQuery()
      .where(eq(productAliases.productId, productID))
      .orderBy(
        sql`${productAliases.storyId} is not null`,
        sql`${productAliases.retailChainId} is not null`,
        nocaseOrder(stories.name),
        nocaseOrder(retailChains.name),
        nocaseOrder(productAliases.alias),
        productAliases.id,
      )
      .all();
  }

  getAlias(id: number): ProductAlias {
    const row = this.aliasQuery().where(eq(productAliases.id, id)).get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createAlias(productID: number, storyID: number, chainID: number, alias: string): ProductAlias {
    const params = this.prepareAlias(productID, storyID, chainID, alias);
    try {
      const id = lastId(
        this.orm
          .insert(productAliases)
          .values({
            productId: params.productID,
            storyId: params.storyID,
            retailChainId: params.chainID,
            alias: params.alias,
          })
          .run(),
      );
      return this.getAlias(id);
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  updateAlias(id: number, productID: number, storyID: number, chainID: number, alias: string): void {
    this.getAlias(id);
    const params = this.prepareAlias(productID, storyID, chainID, alias);
    try {
      const n = changesOf(
        this.orm
          .update(productAliases)
          .set({
            productId: params.productID,
            storyId: params.storyID,
            retailChainId: params.chainID,
            alias: params.alias,
          })
          .where(eq(productAliases.id, id))
          .run(),
      );
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  deleteAlias(id: number): void {
    const n = changesOf(this.orm.delete(productAliases).where(eq(productAliases.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  private aliasQuery() {
    return this.orm
      .select({
        ID: productAliases.id,
        ProductID: productAliases.productId,
        ProductName: products.name,
        StoryID: int0(productAliases.storyId),
        StoryName: emptyStr(stories.name),
        RetailChainID: int0(productAliases.retailChainId),
        RetailChainName: emptyStr(retailChains.name),
        Alias: productAliases.alias,
      })
      .from(productAliases)
      .innerJoin(products, eq(products.id, productAliases.productId))
      .leftJoin(stories, eq(stories.id, productAliases.storyId))
      .leftJoin(retailChains, eq(retailChains.id, productAliases.retailChainId));
  }

  private prepareAlias(productID: number, storyID: number, chainID: number, alias: string) {
    alias = alias.trim();
    if (alias === '') throw new InvalidAliasError();
    if (storyID !== 0 && chainID !== 0) throw new AliasScopeError();
    const n = this.orm.select({ n: count() }).from(products).where(eq(products.id, productID)).get();
    if (countOf(n?.n) === 0) throw new NotFoundError();
    const story = this.optionalStory(storyID);
    const chain = this.optionalChain(chainID);
    const clash = this.orm
      .select({ n: count() })
      .from(products)
      .where(and(nocaseEq(products.name, alias), ne(products.id, productID)))
      .get();
    if (countOf(clash?.n) > 0) throw new DuplicateError();
    return { productID, storyID: story, chainID: chain, alias };
  }

  private aliasExistsExcept(alias: string, exceptProductID: number): boolean {
    const row = this.orm
      .select({ n: count() })
      .from(productAliases)
      .where(and(nocaseEq(productAliases.alias, alias.trim()), ne(productAliases.productId, exceptProductID)))
      .get();
    return countOf(row?.n) > 0;
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
      const chainID = this.storyChainID(storyID);
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
    return this.mapProduct(row);
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
    return this.mapProduct(row);
  }

  private storyChainID(storyID: number): number {
    if (storyID <= 0) return 0;
    const row = this.orm.select({ retailChainId: stories.retailChainId }).from(stories).where(eq(stories.id, storyID)).get();
    return row?.retailChainId ?? 0;
  }

  // --- comparison groups ---

  listComparisonGroups(): ComparisonGroup[] {
    return this.groupQuery().orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id).all();
  }

  getComparisonGroup(id: number): ComparisonGroup {
    const row = this.groupQuery().where(eq(comparisonGroups.id, id)).get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createComparisonGroup(name: string, unitID: number, productIDs: number[]): ComparisonGroup {
    name = this.normalizeGroupName(name);
    try {
      this.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    const id = this.immediate(() => {
      let gid: number;
      try {
        gid = lastId(
          this.orm.insert(comparisonGroups).values({ name, unitId: unitID, createdAt: this.nowRFC3339() }).run(),
        );
      } catch (err) {
        if (isUniqueErr(err)) throw new DuplicateError();
        throw err;
      }
      this.setComparisonGroupProducts(gid, productIDs);
      return gid;
    });
    return this.getComparisonGroup(id);
  }

  updateComparisonGroup(id: number, name: string, unitID: number, productIDs: number[]): void {
    name = this.normalizeGroupName(name);
    try {
      this.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    this.immediate(() => {
      try {
        const n = changesOf(
          this.orm.update(comparisonGroups).set({ name, unitId: unitID }).where(eq(comparisonGroups.id, id)).run(),
        );
        if (n === 0) throw new NotFoundError();
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (isUniqueErr(err)) throw new DuplicateError();
        throw err;
      }
      this.setComparisonGroupProducts(id, productIDs);
    });
  }

  deleteComparisonGroup(id: number): void {
    const n = changesOf(this.orm.delete(comparisonGroups).where(eq(comparisonGroups.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  listComparisonGroupProductIDs(groupID: number): number[] {
    return this.orm
      .select({ productId: comparisonGroupProducts.productId })
      .from(comparisonGroupProducts)
      .where(eq(comparisonGroupProducts.groupId, groupID))
      .orderBy(comparisonGroupProducts.productId)
      .all()
      .map((r) => r.productId);
  }

  listComparisonGroupsForProduct(productID: number): ComparisonGroup[] {
    return this.orm
      .select({
        ID: comparisonGroups.id,
        Name: comparisonGroups.name,
        UnitID: comparisonGroups.unitId,
        UnitName: units.name,
        CreatedAt: comparisonGroups.createdAt,
        ProductCount: groupMemberCount,
      })
      .from(comparisonGroupProducts)
      .innerJoin(comparisonGroups, eq(comparisonGroups.id, comparisonGroupProducts.groupId))
      .innerJoin(units, eq(units.id, comparisonGroups.unitId))
      .where(eq(comparisonGroupProducts.productId, productID))
      .orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id)
      .all();
  }

  setProductComparisonGroups(productID: number, groupIDs: number[]): void {
    this.getProduct(productID);
    this.immediate(() => {
      const ids = this.uniquePositiveIDs(groupIDs);
      for (const id of ids) {
        const n = this.orm.select({ n: count() }).from(comparisonGroups).where(eq(comparisonGroups.id, id)).get();
        if (countOf(n?.n) === 0) throw new InvalidComparisonGroupError();
      }
      this.orm.delete(comparisonGroupProducts).where(eq(comparisonGroupProducts.productId, productID)).run();
      for (const id of ids) {
        this.orm.insert(comparisonGroupProducts).values({ groupId: id, productId: productID }).run();
      }
    });
  }

  relatedGroupProducts(productID: number, now: Date): RelatedProduct[] {
    this.getProduct(productID);
    const mine = tableAlias(comparisonGroupProducts, 'mine');
    const member = tableAlias(comparisonGroupProducts, 'm');
    const rows = this.orm
      .selectDistinct({
        ID: products.id,
        Name: products.name,
        UnitID: products.unitId,
        UnitName: units.name,
        image_path: products.imagePath,
        CreatedAt: products.createdAt,
      })
      .from(mine)
      .innerJoin(member, eq(member.groupId, mine.groupId))
      .innerJoin(products, eq(products.id, member.productId))
      .innerJoin(units, eq(units.id, products.unitId))
      .where(and(eq(mine.productId, productID), ne(products.id, productID)))
      .orderBy(nocaseOrder(products.name), products.id)
      .all();
    if (rows.length === 0) return [];
    const buys = this.listPurchasesForProductIDs(rows.map((r) => r.ID));
    const quotes = quotesByProduct(buys, now);
    const out: RelatedProduct[] = [];
    for (const r of rows) {
      const q = quotes.get(r.ID);
      if (!q) continue;
      out.push({ ...this.mapProduct(r), Quote: q });
    }
    return out;
  }

  comparisonLeaders(productID: number): GroupComparison[] {
    this.getProduct(productID);
    const mine = tableAlias(comparisonGroupProducts, 'mine');
    const member = tableAlias(comparisonGroupProducts, 'm');
    const members = this.orm
      .select({
        GroupID: comparisonGroups.id,
        GroupName: comparisonGroups.name,
        GroupUnitID: comparisonGroups.unitId,
        GroupUnitName: units.name,
        ProductID: products.id,
        ProductName: products.name,
        ProductUnitID: products.unitId,
        ConversionFactor: productUnitConversions.factor,
      })
      .from(mine)
      .innerJoin(comparisonGroups, eq(comparisonGroups.id, mine.groupId))
      .innerJoin(units, eq(units.id, comparisonGroups.unitId))
      .innerJoin(member, eq(member.groupId, comparisonGroups.id))
      .innerJoin(products, eq(products.id, member.productId))
      .leftJoin(
        productUnitConversions,
        and(
          eq(productUnitConversions.productId, products.id),
          eq(productUnitConversions.unitId, comparisonGroups.unitId),
        ),
      )
      .where(eq(mine.productId, productID))
      .orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id, nocaseOrder(products.name), products.id)
      .all();
    if (members.length === 0) return [];
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const m of members) {
      if (seen.has(m.ProductID)) continue;
      seen.add(m.ProductID);
      ids.push(m.ProductID);
    }
    const last = lastPricesByProduct(this.listPurchasesForProductIDs(ids));
    return this.pickGroupLeaders(productID, members, last);
  }

  private pickGroupLeaders(
    selectedID: number,
    members: ComparisonMemberRow[],
    last: Map<number, { BoughtOn: string; Price: Decimal }>,
  ): GroupComparison[] {
    const out: GroupComparison[] = [];
    let idx = -1;
    for (const m of members) {
      if (idx < 0 || out[idx]!.Group.ID !== m.GroupID) {
        out.push({
          Group: {
            ID: m.GroupID,
            Name: m.GroupName,
            UnitID: m.GroupUnitID,
            UnitName: m.GroupUnitName,
            CreatedAt: '',
            ProductCount: 0,
          },
          Selected: null,
          Leader: null,
          SelectedIsLeader: false,
          SelectedComparable: false,
        });
        idx = out.length - 1;
      }
      const offer = this.comparableOffer(m, last);
      if (!offer) continue;
      if (m.ProductID === selectedID) {
        out[idx]!.Selected = offer;
        out[idx]!.SelectedComparable = true;
      }
      if (this.betterOffer(offer, out[idx]!.Leader, selectedID)) out[idx]!.Leader = offer;
    }
    for (const g of out) {
      if (g.Leader && g.Selected && g.Leader.ProductID === selectedID) g.SelectedIsLeader = true;
    }
    return out;
  }

  private comparableOffer(
    m: {
      ProductID: number;
      ProductName: string;
      ProductUnitID: number;
      GroupUnitID: number;
      ConversionFactor: string | null;
    },
    last: Map<number, { BoughtOn: string; Price: Decimal }>,
  ): ComparisonOffer | null {
    const pt = last.get(m.ProductID);
    if (!pt) return null;
    let factor: Decimal;
    if (m.ProductUnitID === m.GroupUnitID) factor = new Decimal(1);
    else if (!m.ConversionFactor) return null;
    else {
      factor = new Decimal(m.ConversionFactor);
      if (factor.isZero() || factor.isNegative()) return null;
    }
    return {
      ProductID: m.ProductID,
      ProductName: m.ProductName,
      Price: pt.Price.div(factor),
      BoughtOn: pt.BoughtOn,
    };
  }

  private betterOffer(candidate: ComparisonOffer, current: ComparisonOffer | null, selectedID: number): boolean {
    if (!current) return true;
    if (candidate.Price.lt(current.Price)) return true;
    if (current.Price.lt(candidate.Price)) return false;
    if (candidate.ProductID === selectedID) return true;
    if (current.ProductID === selectedID) return false;
    return candidate.ProductID < current.ProductID;
  }

  private groupQuery() {
    return this.orm
      .select({
        ID: comparisonGroups.id,
        Name: comparisonGroups.name,
        UnitID: comparisonGroups.unitId,
        UnitName: units.name,
        CreatedAt: comparisonGroups.createdAt,
        ProductCount: groupMemberCount,
      })
      .from(comparisonGroups)
      .innerJoin(units, eq(units.id, comparisonGroups.unitId));
  }

  private normalizeGroupName(name: string): string {
    name = name.trim();
    if (name === '') throw new ComparisonGroupNameError();
    return name;
  }

  private setComparisonGroupProducts(groupID: number, productIDs: number[]): void {
    const ids = this.uniquePositiveIDs(productIDs);
    for (const id of ids) {
      const n = this.orm.select({ n: count() }).from(products).where(eq(products.id, id)).get();
      if (countOf(n?.n) === 0) throw new NotFoundError();
    }
    this.orm.delete(comparisonGroupProducts).where(eq(comparisonGroupProducts.groupId, groupID)).run();
    for (const id of ids) {
      this.orm.insert(comparisonGroupProducts).values({ groupId: groupID, productId: id }).run();
    }
  }

  private uniquePositiveIDs(ids: number[]): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of ids) {
      if (id === 0) continue;
      if (id < 0) throw new NotFoundError();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  // --- receipts ---

  createReceipt(imagePathVal: string): Receipt {
    return this.createSourcedReceiptInner(imagePathVal, RECEIPT_SOURCE_OCR, '', '');
  }

  createSourcedReceipt(imagePathVal: string, source: string, externalID: string, payload: string): Receipt {
    source = source.trim().toLowerCase();
    externalID = externalID.trim();
    if (source === '' || externalID === '') throw new Error('source and id are required');
    return this.createSourcedReceiptInner(imagePathVal, source, externalID, payload);
  }

  private createSourcedReceiptInner(imagePathVal: string, source: string, externalID: string, payload: string): Receipt {
    imagePathVal = imagePathVal.trim();
    source = source.trim().toLowerCase();
    if (imagePathVal === '') throw new Error('image is required');
    if (source === '') throw new Error('source is required');
    try {
      const id = lastId(
        this.orm
          .insert(receipts)
          .values({
            imagePath: imagePathVal,
            rawResponse: '',
            status: RECEIPT_PENDING,
            errorMessage: '',
            createdAt: this.nowRFC3339(),
            source,
            externalId: externalID,
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
    return this.immediate(() => {
      const r = this.getReceipt(id);
      if (r.Status === RECEIPT_MIGRATED) throw new ReceiptMigratedError();
      if (r.Status !== RECEIPT_READY) throw new ReceiptNotReadyError();
      inn.ReceiptID = id;
      const res = this.importBill(inn);
      this.orm.update(receipts).set({ status: RECEIPT_MIGRATED, rawResponse: rawJSON }).where(eq(receipts.id, id)).run();
      return res;
    });
  }

  updateReceiptVisit(id: number, storyID: number, boughtOn: string): void {
    const story = this.optionalStory(storyID);
    boughtOn = normalizeBoughtOn(boughtOn);
    this.immediate(() => {
      const r = this.getReceipt(id);
      if (r.Status !== RECEIPT_MIGRATED) {
        if (r.Status === RECEIPT_READY) throw new ReceiptNotReadyError();
        throw new NotFoundError();
      }
      this.orm.update(purchases).set({ storyId: story, boughtOn }).where(eq(purchases.receiptId, id)).run();
      const raw = this.patchBillVisitJSON(r.RawResponse, storyID, boughtOn);
      this.orm.update(receipts).set({ rawResponse: raw }).where(eq(receipts.id, id)).run();
    });
  }

  importBillPublic(inn: BillImport): BillImportResult {
    if (inn.Lines.length === 0) throw new Error('no products to import');
    return this.immediate(() => this.importBill(inn));
  }

  private importBill(inn: BillImport): BillImportResult {
    if (inn.Lines.length === 0) throw new Error('no products to import');
    let storyID = inn.StoryID;
    if (storyID > 0) this.getStory(storyID);
    else if (inn.Story) {
      const c = this.normalizeStory(
        inn.Story.Name,
        inn.Story.StreetName,
        inn.Story.BuildingNumber,
        inn.Story.ApartmentNumber,
        inn.Story.PostalCode,
        inn.Story.City,
        inn.Story.ExternalID,
      );
      storyID = this.insertStory(c, inn.Story.RetailChainID);
    }
    const created = new Map<string, number>();
    const newIDs = new Set<number>();
    const result: BillImportResult = { StoryID: storyID, ProductIDs: [], Purchases: 0 };
    for (const line of inn.Lines) {
      const pid = this.resolveImportProduct(line, created, newIDs, storyID);
      result.ProductIDs.push(pid);
      this.insertPurchase(pid, storyID, inn.ReceiptID, inn.BoughtOn, line.Quantity, line.Amount);
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
      const p = this.getProductRow(line.ProductID);
      this.maybeAliasFromReceipt(p.ID, storyID, line.ReceiptName);
      return p.ID;
    }
    const key = line.ProductName.trim().toLowerCase();
    if (key === '') throw new Error('product name is required');
    const existingCreated = created.get(key);
    if (existingCreated !== undefined) {
      if (newIDs.has(existingCreated)) this.maybeAliasFromReceipt(existingCreated, storyID, line.ReceiptName);
      return existingCreated;
    }
    try {
      const existing = this.findProductByName(line.ProductName, storyID);
      created.set(key, existing.ID);
      return existing.ID;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const p = this.createProductInner(line.ProductName, line.UnitID);
    created.set(key, p.ID);
    newIDs.add(p.ID);
    this.maybeAliasFromReceipt(p.ID, storyID, line.ReceiptName);
    return p.ID;
  }

  private createProductInner(name: string, unitID: number): Product {
    name = name.trim();
    if (name === '') throw new Error('name is required');
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
        .values({ name, unitId: unitID, imagePath: null, createdAt: this.nowRFC3339() })
        .run(),
    );
    return this.getProductRow(id);
  }

  private maybeAliasFromReceipt(productID: number, storyID: number, receiptName: string): void {
    receiptName = receiptName.trim();
    if (receiptName === '') return;
    let chainID = 0;
    if (storyID > 0) {
      const st = this.getStory(storyID);
      if (st.RetailChainID > 0) {
        chainID = st.RetailChainID;
        storyID = 0;
      }
    }
    try {
      this.createAlias(productID, storyID, chainID, receiptName);
    } catch (err) {
      if (err instanceof DuplicateError || err instanceof InvalidAliasError || err instanceof AliasScopeError) {
        return;
      }
      throw err;
    }
  }

  private insertPurchase(
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
          createdAt: this.nowRFC3339(),
        })
        .run(),
    );
    return this.getPurchase(id);
  }

  private patchBillVisitJSON(raw: string, storyID: number, boughtOn: string): string {
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
}

function splitBoughtOnSafe(s: string): { date: string; clock: string } {
  const t = s.trim().replaceAll('T', ' ').replaceAll('\u00a0', ' ');
  const parts = t.split(/\s+/);
  return { date: parts[0] ?? '', clock: parts[1]?.slice(0, 5) ?? '' };
}
