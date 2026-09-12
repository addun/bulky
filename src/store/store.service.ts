import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DatabaseService } from '../db/database.service';
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
import { bestRecentPrice, lastPricesByProduct, quotesByProduct } from '../domain/price-stats';
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
  type ImagePath,
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

type Stmt = ReturnType<DatabaseService['sqlite']['prepare']>;

@Injectable()
export class StoreService {
  constructor(private readonly db: DatabaseService) {}

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
    return this.all(
      `SELECT u.id AS ID, u.name AS Name,
        CAST((SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id)
          + (SELECT COUNT(*) FROM product_unit_conversions c WHERE c.unit_id = u.id) AS INTEGER) AS ProductCount
       FROM units u ORDER BY u.name COLLATE NOCASE`,
    );
  }

  getUnit(id: number): Unit {
    const row = this.get<Unit>(
      `SELECT u.id AS ID, u.name AS Name,
        CAST((SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id)
          + (SELECT COUNT(*) FROM product_unit_conversions c WHERE c.unit_id = u.id) AS INTEGER) AS ProductCount
       FROM units u WHERE u.id = ?`,
      id,
    );
    if (!row) throw new NotFoundError();
    return row;
  }

  findUnitByName(name: string): Unit {
    const row = this.get<Unit>(
      `SELECT u.id AS ID, u.name AS Name,
        CAST((SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id)
          + (SELECT COUNT(*) FROM product_unit_conversions c WHERE c.unit_id = u.id) AS INTEGER) AS ProductCount
       FROM units u WHERE u.name = ? COLLATE NOCASE`,
      name,
    );
    if (!row) throw new NotFoundError();
    return row;
  }

  createUnit(name: string): Unit {
    name = name.trim();
    if (name === '') throw new InvalidUnitError();
    try {
      const id = this.insert(`INSERT INTO units (name) VALUES (?)`, name);
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
      const n = this.run(`UPDATE units SET name = ? WHERE id = ?`, name, id);
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
    const groups = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM comparison_groups WHERE unit_id = ?`, id);
    if ((groups?.n ?? 0) > 0) throw new UnitInUseError();
    const n = this.run(`DELETE FROM units WHERE id = ?`, id);
    if (n === 0) throw new NotFoundError();
  }

  // --- settings ---

  getSetting(key: string): string {
    const row = this.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key);
    return row?.value ?? '';
  }

  setSetting(key: string, value: string): void {
    key = key.trim();
    value = value.trim();
    if (key === '' || value === '') throw new InvalidSettingError();
    this.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
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
      this.run(`DELETE FROM settings WHERE key = ?`, key);
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
    return this.all(
      `SELECT rc.id AS ID, rc.name AS Name, rc.legal_name AS LegalName, rc.tax_id AS TaxID,
        CAST((SELECT COUNT(*) FROM stories s WHERE s.retail_chain_id = rc.id) AS INTEGER) AS StoryCount
       FROM retail_chains rc ORDER BY rc.name COLLATE NOCASE, rc.id`,
    );
  }

  getRetailChain(id: number): RetailChain {
    const row = this.get<RetailChain>(
      `SELECT rc.id AS ID, rc.name AS Name, rc.legal_name AS LegalName, rc.tax_id AS TaxID,
        CAST((SELECT COUNT(*) FROM stories s WHERE s.retail_chain_id = rc.id) AS INTEGER) AS StoryCount
       FROM retail_chains rc WHERE rc.id = ?`,
      id,
    );
    if (!row) throw new NotFoundError();
    return row;
  }

  createRetailChain(name: string, legalName: string, taxID: string): RetailChain {
    const c = this.normalizeRetailChain(name, legalName, taxID);
    try {
      const id = this.insert(
        `INSERT INTO retail_chains (name, legal_name, tax_id) VALUES (?, ?, ?)`,
        c.Name,
        c.LegalName,
        c.TaxID,
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
      const n = this.run(
        `UPDATE retail_chains SET name = ?, legal_name = ?, tax_id = ? WHERE id = ?`,
        c.Name,
        c.LegalName,
        c.TaxID,
        id,
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
    const n = this.run(`DELETE FROM retail_chains WHERE id = ?`, id);
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
    return this.all(this.storySelect() + ` GROUP BY c.id ORDER BY c.name COLLATE NOCASE, c.id`);
  }

  getStory(id: number): Story {
    const row = this.get<Story>(this.storySelect() + ` WHERE c.id = ? GROUP BY c.id`, id);
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
      const n = this.run(
        `UPDATE stories SET name = ?, street_name = ?, building_number = ?, apartment_number = ?, postal_code = ?, city = ?, external_id = ?, retail_chain_id = ? WHERE id = ?`,
        c.Name,
        c.StreetName,
        c.BuildingNumber,
        c.ApartmentNumber,
        c.PostalCode,
        c.City,
        c.ExternalID,
        chain,
        id,
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
    const n = this.run(`DELETE FROM stories WHERE id = ?`, id);
    if (n === 0) throw new NotFoundError();
  }

  private storySelect(): string {
    return `SELECT c.id AS ID, c.name AS Name, c.street_name AS StreetName, c.building_number AS BuildingNumber,
      c.apartment_number AS ApartmentNumber, c.postal_code AS PostalCode, c.city AS City, c.external_id AS ExternalID,
      CAST(COALESCE(c.retail_chain_id, 0) AS INTEGER) AS RetailChainID,
      COALESCE(rc.name, '') AS RetailChainName,
      CAST(COUNT(p.id) AS INTEGER) AS PurchaseCount
      FROM stories c
      LEFT JOIN retail_chains rc ON rc.id = c.retail_chain_id
      LEFT JOIN purchases p ON p.story_id = c.id`;
  }

  private insertStory(c: Story, retailChainID: number): number {
    const chain = this.optionalChain(retailChainID);
    try {
      return this.insert(
        `INSERT INTO stories (name, street_name, building_number, apartment_number, postal_code, city, external_id, retail_chain_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        c.Name,
        c.StreetName,
        c.BuildingNumber,
        c.ApartmentNumber,
        c.PostalCode,
        c.City,
        c.ExternalID,
        chain,
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
    const n = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stories WHERE id = ?`, id);
    if (!n || n.n === 0) throw new InvalidStoryError();
    return id;
  }

  private optionalChain(id: number): number | null {
    if (id === 0) return null;
    const n = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM retail_chains WHERE id = ?`, id);
    if (!n || n.n === 0) throw new InvalidRetailChainError();
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
      const pid = this.insert(
        `INSERT INTO products (name, unit_id, image_path, created_at) VALUES (?, ?, ?, ?)`,
        name,
        unitID,
        image,
        this.nowRFC3339(),
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
      const n = this.run(`UPDATE products SET name = ?, unit_id = ?, image_path = ? WHERE id = ?`, name, unitID, path, id);
      if (n === 0) throw new NotFoundError();
      if (conversions) this.setProductConversions(id, unitID, conversions);
    });
  }

  deleteProduct(id: number): string {
    const p = this.getProduct(id);
    this.run(`DELETE FROM products WHERE id = ?`, id);
    return p.ImagePath.Valid ? p.ImagePath.String : '';
  }

  changePurchaseUnit(productID: number, newUnitID: number): void {
    const p = this.getProduct(productID);
    if (newUnitID === p.UnitID) throw new InvalidUnitError();
    const conv = p.Conversions.find((c) => c.UnitID === newUnitID);
    if (!conv) throw new InvalidConversionError();
    const factor = conv.Factor;
    this.immediate(() => {
      this.run(`UPDATE products SET unit_id = ? WHERE id = ?`, newUnitID, productID);
      const buys = this.listPurchasesAsc(productID);
      for (const buy of buys) {
        this.run(`UPDATE purchases SET quantity = ? WHERE id = ?`, buy.Quantity.mul(factor).toString(), buy.ID);
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
      this.run(`UPDATE purchases SET product_id = ? WHERE product_id = ?`, into.ID, from.ID);
      this.run(
        `DELETE FROM product_aliases
         WHERE product_aliases.product_id = ?
           AND (
             product_aliases.alias = ? COLLATE NOCASE
             OR EXISTS (
               SELECT 1 FROM product_aliases AS k
               WHERE k.product_id = ?
                 AND k.alias = product_aliases.alias COLLATE NOCASE
                 AND (
                   (k.story_id IS NULL AND product_aliases.story_id IS NULL)
                   OR k.story_id = product_aliases.story_id
                 )
             )
           )`,
        from.ID,
        into.Name,
        into.ID,
      );
      this.run(`UPDATE product_aliases SET product_id = ? WHERE product_id = ?`, into.ID, from.ID);
      this.run(
        `INSERT OR IGNORE INTO comparison_group_products (group_id, product_id)
         SELECT m.group_id, ? FROM comparison_group_products m WHERE m.product_id = ?`,
        into.ID,
        from.ID,
      );
      const dropImage = this.handOffImage(into, from);
      this.run(`DELETE FROM products WHERE id = ?`, from.ID);
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
    this.run(`UPDATE products SET image_path = ? WHERE id = ?`, from.ImagePath.String, into.ID);
    this.run(`UPDATE products SET image_path = NULL WHERE id = ?`, from.ID);
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
    const rows = this.all<{
      ID: number;
      Name: string;
      UnitID: number;
      UnitName: string;
      image_path: string | null;
      CreatedAt: string;
    }>(
      `SELECT p.id AS ID, p.name AS Name, p.unit_id AS UnitID, u.name AS UnitName, p.image_path, p.created_at AS CreatedAt
       FROM products p JOIN units u ON u.id = p.unit_id ORDER BY p.name COLLATE NOCASE`,
    );
    const items: ProductListItem[] = rows.map((r) => ({
      ID: r.ID,
      Name: r.Name,
      UnitID: r.UnitID,
      UnitName: r.UnitName,
      ImagePath: imagePath(r.image_path),
      CreatedAt: r.CreatedAt,
      Conversions: [],
      LastBought: emptyImage(),
      LifetimeAmount: new Decimal(0),
      PurchaseCount: 0,
      Quote: null,
    }));
    const index = new Map<number, number>();
    items.forEach((it, i) => index.set(it.ID, i));
    if (items.length === 0) return items;
    const prows = this.all<{ ProductID: number; BoughtOn: string; Amount: string }>(
      `SELECT product_id AS ProductID, bought_on AS BoughtOn, amount AS Amount FROM purchases WHERE kind = ?`,
      KIND_PURCHASE,
    );
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
    const rows = this.all<{ ProductID: number; UnitID: number; UnitName: string; Factor: string }>(
      `SELECT c.product_id AS ProductID, c.unit_id AS UnitID, u.name AS UnitName, c.factor AS Factor
       FROM product_unit_conversions c JOIN units u ON u.id = c.unit_id ORDER BY u.name COLLATE NOCASE`,
    );
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

  private getProductRow(id: number): Product {
    const row = this.get<{
      ID: number;
      Name: string;
      UnitID: number;
      UnitName: string;
      image_path: string | null;
      CreatedAt: string;
    }>(
      `SELECT p.id AS ID, p.name AS Name, p.unit_id AS UnitID, u.name AS UnitName, p.image_path, p.created_at AS CreatedAt
       FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = ?`,
      id,
    );
    if (!row) throw new NotFoundError();
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
    return this.all<{ UnitID: number; UnitName: string; Factor: string }>(
      `SELECT c.unit_id AS UnitID, u.name AS UnitName, c.factor AS Factor
       FROM product_unit_conversions c JOIN units u ON u.id = c.unit_id
       WHERE c.product_id = ? ORDER BY u.name COLLATE NOCASE`,
      productID,
    ).map((r) => ({ UnitID: r.UnitID, UnitName: r.UnitName, Factor: new Decimal(r.Factor) }));
  }

  setProductConversionsPublic(productID: number, conversions: ProductConversion[]): void {
    const p = this.getProduct(productID);
    this.immediate(() => this.setProductConversions(productID, p.UnitID, conversions));
  }

  private setProductConversions(productID: number, purchaseUnitID: number, conversions: ProductConversion[]): void {
    const normalized = this.normalizeConversions(purchaseUnitID, conversions);
    this.run(`DELETE FROM product_unit_conversions WHERE product_id = ?`, productID);
    for (const c of normalized) {
      this.run(
        `INSERT INTO product_unit_conversions (product_id, unit_id, factor) VALUES (?, ?, ?)`,
        productID,
        c.UnitID,
        c.Factor.toString(),
      );
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
      const n = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM units WHERE id = ?`, c.UnitID);
      if (!n || n.n === 0) throw new InvalidUnitError();
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
      this.run(
        `INSERT INTO product_unit_conversions (product_id, unit_id, factor) VALUES (?, ?, ?)`,
        intoID,
        c.UnitID,
        c.Factor.toString(),
      );
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
      this.all(this.purchaseSelect() + ` WHERE p.product_id = ? ORDER BY p.bought_on DESC, p.id DESC`, productID),
    );
  }

  private listPurchasesAsc(productID: number): Purchase[] {
    return this.mapPurchases(this.all(this.purchaseSelect() + ` WHERE p.product_id = ? ORDER BY p.id`, productID));
  }

  listPurchasesByReceipt(receiptID: number): ReceiptPurchase[] {
    const rows = this.all<Record<string, unknown>>(
      `SELECT p.id AS ID, p.product_id AS ProductID, CAST(COALESCE(p.story_id, 0) AS INTEGER) AS StoryID,
        p.kind AS Kind, CAST(COALESCE(p.receipt_id, 0) AS INTEGER) AS ReceiptID, p.bought_on AS BoughtOn,
        p.quantity AS Quantity, p.amount AS Amount, p.created_at AS CreatedAt,
        pr.name AS ProductName, u.name AS UnitName, pr.image_path
       FROM purchases p
       JOIN products pr ON pr.id = p.product_id
       JOIN units u ON u.id = pr.unit_id
       WHERE p.receipt_id = ? ORDER BY p.id`,
      receiptID,
    );
    return rows.map((r) => ({
      ...this.mapPurchase(r),
      ProductName: String(r.ProductName),
      UnitName: String(r.UnitName),
      ImagePath: imagePath(r.image_path as string | null),
    }));
  }

  getPurchase(id: number): Purchase {
    const row = this.get<Record<string, unknown>>(this.purchaseSelect() + ` WHERE p.id = ?`, id);
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
    const id = this.insert(
      `INSERT INTO purchases (product_id, story_id, kind, receipt_id, bought_on, quantity, amount, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      productID,
      story,
      kind,
      boughtOn,
      quantity.toString(),
      amount.toString(),
      this.nowRFC3339(),
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
    const n = this.run(
      `UPDATE purchases SET story_id = ?, kind = ?, bought_on = ?, quantity = ?, amount = ? WHERE id = ?`,
      story,
      kind,
      boughtOn,
      quantity.toString(),
      amount.toString(),
      id,
    );
    if (n === 0) throw new NotFoundError();
  }

  deletePurchase(id: number): void {
    const n = this.run(`DELETE FROM purchases WHERE id = ?`, id);
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

  private purchaseSelect(): string {
    return `SELECT p.id AS ID, p.product_id AS ProductID, CAST(COALESCE(p.story_id, 0) AS INTEGER) AS StoryID,
      p.kind AS Kind, CAST(COALESCE(p.receipt_id, 0) AS INTEGER) AS ReceiptID, p.bought_on AS BoughtOn,
      p.quantity AS Quantity, p.amount AS Amount, p.created_at AS CreatedAt FROM purchases p`;
  }

  private mapPurchases(rows: Record<string, unknown>[]): Purchase[] {
    return rows.map((r) => this.mapPurchase(r));
  }

  private mapPurchase(r: Record<string, unknown>): Purchase {
    return {
      ID: Number(r.ID),
      ProductID: Number(r.ProductID),
      StoryID: Number(r.StoryID),
      Kind: String(r.Kind) as PurchaseKind,
      ReceiptID: Number(r.ReceiptID),
      BoughtOn: String(r.BoughtOn),
      Quantity: new Decimal(String(r.Quantity)),
      Amount: new Decimal(String(r.Amount)),
      CreatedAt: String(r.CreatedAt),
    };
  }

  listPurchasesForProductIDs(ids: number[]): Purchase[] {
    if (ids.length === 0) return [];
    const ph = ids.map(() => '?').join(',');
    return this.mapPurchases(
      this.all(
        this.purchaseSelect() + ` WHERE p.product_id IN (${ph}) ORDER BY p.bought_on DESC, p.id DESC`,
        ...ids,
      ),
    );
  }

  // --- aliases ---

  listAliases(): ProductAlias[] {
    return this.all(this.aliasSelect() + ` ORDER BY p.name COLLATE NOCASE, c.name COLLATE NOCASE, rc.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id`);
  }

  listAliasesByProduct(productID: number): ProductAlias[] {
    return this.all(
      this.aliasSelect() +
        ` WHERE a.product_id = ? ORDER BY a.story_id IS NOT NULL, a.retail_chain_id IS NOT NULL, c.name COLLATE NOCASE, rc.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id`,
      productID,
    );
  }

  getAlias(id: number): ProductAlias {
    const row = this.get<ProductAlias>(this.aliasSelect() + ` WHERE a.id = ?`, id);
    if (!row) throw new NotFoundError();
    return row;
  }

  createAlias(productID: number, storyID: number, chainID: number, alias: string): ProductAlias {
    const params = this.prepareAlias(productID, storyID, chainID, alias);
    try {
      const id = this.insert(
        `INSERT INTO product_aliases (product_id, story_id, retail_chain_id, alias) VALUES (?, ?, ?, ?)`,
        params.productID,
        params.storyID,
        params.chainID,
        params.alias,
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
      const n = this.run(
        `UPDATE product_aliases SET product_id = ?, story_id = ?, retail_chain_id = ?, alias = ? WHERE id = ?`,
        params.productID,
        params.storyID,
        params.chainID,
        params.alias,
        id,
      );
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  deleteAlias(id: number): void {
    const n = this.run(`DELETE FROM product_aliases WHERE id = ?`, id);
    if (n === 0) throw new NotFoundError();
  }

  private aliasSelect(): string {
    return `SELECT a.id AS ID, a.product_id AS ProductID, p.name AS ProductName,
      CAST(COALESCE(a.story_id, 0) AS INTEGER) AS StoryID, COALESCE(c.name, '') AS StoryName,
      CAST(COALESCE(a.retail_chain_id, 0) AS INTEGER) AS RetailChainID, COALESCE(rc.name, '') AS RetailChainName,
      a.alias AS Alias
      FROM product_aliases a
      JOIN products p ON p.id = a.product_id
      LEFT JOIN stories c ON c.id = a.story_id
      LEFT JOIN retail_chains rc ON rc.id = a.retail_chain_id`;
  }

  private prepareAlias(productID: number, storyID: number, chainID: number, alias: string) {
    alias = alias.trim();
    if (alias === '') throw new InvalidAliasError();
    if (storyID !== 0 && chainID !== 0) throw new AliasScopeError();
    const n = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE id = ?`, productID);
    if (!n || n.n === 0) throw new NotFoundError();
    const story = this.optionalStory(storyID);
    const chain = this.optionalChain(chainID);
    const clash = this.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM products WHERE name = ? COLLATE NOCASE AND id != ?`,
      alias,
      productID,
    );
    if ((clash?.n ?? 0) > 0) throw new DuplicateError();
    return { productID, storyID: story, chainID: chain, alias };
  }

  private aliasExistsExcept(alias: string, exceptProductID: number): boolean {
    const row = this.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM product_aliases WHERE alias = ? COLLATE NOCASE AND product_id != ?`,
      alias.trim(),
      exceptProductID,
    );
    return (row?.n ?? 0) > 0;
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
    const row = this.get<{
      ID: number;
      Name: string;
      UnitID: number;
      UnitName: string;
      image_path: string | null;
      CreatedAt: string;
    }>(
      `SELECT p.id AS ID, p.name AS Name, p.unit_id AS UnitID, u.name AS UnitName, p.image_path, p.created_at AS CreatedAt
       FROM products p JOIN units u ON u.id = p.unit_id WHERE p.name = ? COLLATE NOCASE ORDER BY p.id LIMIT 1`,
      name,
    );
    if (!row) throw new NotFoundError();
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

  productByAlias(alias: string, storyID: number, chainID: number): Product {
    alias = alias.trim();
    if (alias === '') throw new NotFoundError();
    let row: {
      ID: number;
      Name: string;
      UnitID: number;
      UnitName: string;
      image_path: string | null;
      CreatedAt: string;
    } | undefined;
    if (storyID > 0) {
      row = this.get(
        `SELECT p.id AS ID, p.name AS Name, p.unit_id AS UnitID, u.name AS UnitName, p.image_path, p.created_at AS CreatedAt
         FROM product_aliases a JOIN products p ON p.id = a.product_id JOIN units u ON u.id = p.unit_id
         WHERE a.alias = ? COLLATE NOCASE AND a.story_id = ? ORDER BY a.id LIMIT 1`,
        alias,
        storyID,
      );
    } else if (chainID > 0) {
      row = this.get(
        `SELECT p.id AS ID, p.name AS Name, p.unit_id AS UnitID, u.name AS UnitName, p.image_path, p.created_at AS CreatedAt
         FROM product_aliases a JOIN products p ON p.id = a.product_id JOIN units u ON u.id = p.unit_id
         WHERE a.alias = ? COLLATE NOCASE AND a.retail_chain_id = ? ORDER BY a.id LIMIT 1`,
        alias,
        chainID,
      );
    } else {
      row = this.get(
        `SELECT p.id AS ID, p.name AS Name, p.unit_id AS UnitID, u.name AS UnitName, p.image_path, p.created_at AS CreatedAt
         FROM product_aliases a JOIN products p ON p.id = a.product_id JOIN units u ON u.id = p.unit_id
         WHERE a.alias = ? COLLATE NOCASE AND a.story_id IS NULL AND a.retail_chain_id IS NULL ORDER BY a.id LIMIT 1`,
        alias,
      );
    }
    if (!row) throw new NotFoundError();
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

  private storyChainID(storyID: number): number {
    if (storyID <= 0) return 0;
    const row = this.get<{ retail_chain_id: number | null }>(`SELECT retail_chain_id FROM stories WHERE id = ?`, storyID);
    return row?.retail_chain_id ?? 0;
  }

  // --- comparison groups ---

  listComparisonGroups(): ComparisonGroup[] {
    return this.all(this.groupSelect() + ` ORDER BY g.name COLLATE NOCASE, g.id`);
  }

  getComparisonGroup(id: number): ComparisonGroup {
    const row = this.get<ComparisonGroup>(this.groupSelect() + ` WHERE g.id = ?`, id);
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
        gid = this.insert(
          `INSERT INTO comparison_groups (name, unit_id, created_at) VALUES (?, ?, ?)`,
          name,
          unitID,
          this.nowRFC3339(),
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
        const n = this.run(`UPDATE comparison_groups SET name = ?, unit_id = ? WHERE id = ?`, name, unitID, id);
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
    const n = this.run(`DELETE FROM comparison_groups WHERE id = ?`, id);
    if (n === 0) throw new NotFoundError();
  }

  listComparisonGroupProductIDs(groupID: number): number[] {
    return this.all<{ product_id: number }>(
      `SELECT product_id FROM comparison_group_products WHERE group_id = ? ORDER BY product_id`,
      groupID,
    ).map((r) => r.product_id);
  }

  listComparisonGroupsForProduct(productID: number): ComparisonGroup[] {
    return this.all(
      `SELECT g.id AS ID, g.name AS Name, g.unit_id AS UnitID, u.name AS UnitName, g.created_at AS CreatedAt,
        CAST((SELECT COUNT(*) FROM comparison_group_products m WHERE m.group_id = g.id) AS INTEGER) AS ProductCount
       FROM comparison_group_products mine
       JOIN comparison_groups g ON g.id = mine.group_id
       JOIN units u ON u.id = g.unit_id
       WHERE mine.product_id = ? ORDER BY g.name COLLATE NOCASE, g.id`,
      productID,
    );
  }

  setProductComparisonGroups(productID: number, groupIDs: number[]): void {
    this.getProduct(productID);
    this.immediate(() => {
      const ids = this.uniquePositiveIDs(groupIDs);
      for (const id of ids) {
        const n = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM comparison_groups WHERE id = ?`, id);
        if (!n || n.n === 0) throw new InvalidComparisonGroupError();
      }
      this.run(`DELETE FROM comparison_group_products WHERE product_id = ?`, productID);
      for (const id of ids) {
        this.run(`INSERT INTO comparison_group_products (group_id, product_id) VALUES (?, ?)`, id, productID);
      }
    });
  }

  relatedGroupProducts(productID: number, now: Date): RelatedProduct[] {
    this.getProduct(productID);
    const rows = this.all<{
      ID: number;
      Name: string;
      UnitID: number;
      UnitName: string;
      image_path: string | null;
      CreatedAt: string;
    }>(
      `SELECT DISTINCT p.id AS ID, p.name AS Name, p.unit_id AS UnitID, u.name AS UnitName, p.image_path, p.created_at AS CreatedAt
       FROM comparison_group_products mine
       JOIN comparison_group_products m ON m.group_id = mine.group_id
       JOIN products p ON p.id = m.product_id
       JOIN units u ON u.id = p.unit_id
       WHERE mine.product_id = ? AND p.id != ?
       ORDER BY p.name COLLATE NOCASE, p.id`,
      productID,
      productID,
    );
    if (rows.length === 0) return [];
    const buys = this.listPurchasesForProductIDs(rows.map((r) => r.ID));
    const quotes = quotesByProduct(buys, now);
    const out: RelatedProduct[] = [];
    for (const r of rows) {
      const q = quotes.get(r.ID);
      if (!q) continue;
      out.push({
        ID: r.ID,
        Name: r.Name,
        UnitID: r.UnitID,
        UnitName: r.UnitName,
        ImagePath: imagePath(r.image_path),
        CreatedAt: r.CreatedAt,
        Conversions: [],
        Quote: q,
      });
    }
    return out;
  }

  comparisonLeaders(productID: number): GroupComparison[] {
    this.getProduct(productID);
    const members = this.all<{
      GroupID: number;
      GroupName: string;
      GroupUnitID: number;
      GroupUnitName: string;
      ProductID: number;
      ProductName: string;
      ProductUnitID: number;
      ConversionFactor: string | null;
    }>(
      `SELECT g.id AS GroupID, g.name AS GroupName, g.unit_id AS GroupUnitID, u.name AS GroupUnitName,
        p.id AS ProductID, p.name AS ProductName, p.unit_id AS ProductUnitID, c.factor AS ConversionFactor
       FROM comparison_group_products mine
       JOIN comparison_groups g ON g.id = mine.group_id
       JOIN units u ON u.id = g.unit_id
       JOIN comparison_group_products m ON m.group_id = g.id
       JOIN products p ON p.id = m.product_id
       LEFT JOIN product_unit_conversions c ON c.product_id = p.id AND c.unit_id = g.unit_id
       WHERE mine.product_id = ?
       ORDER BY g.name COLLATE NOCASE, g.id, p.name COLLATE NOCASE, p.id`,
      productID,
    );
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
    members: {
      GroupID: number;
      GroupName: string;
      GroupUnitID: number;
      GroupUnitName: string;
      ProductID: number;
      ProductName: string;
      ProductUnitID: number;
      ConversionFactor: string | null;
    }[],
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

  private groupSelect(): string {
    return `SELECT g.id AS ID, g.name AS Name, g.unit_id AS UnitID, u.name AS UnitName, g.created_at AS CreatedAt,
      CAST((SELECT COUNT(*) FROM comparison_group_products m WHERE m.group_id = g.id) AS INTEGER) AS ProductCount
      FROM comparison_groups g JOIN units u ON u.id = g.unit_id`;
  }

  private normalizeGroupName(name: string): string {
    name = name.trim();
    if (name === '') throw new ComparisonGroupNameError();
    return name;
  }

  private setComparisonGroupProducts(groupID: number, productIDs: number[]): void {
    const ids = this.uniquePositiveIDs(productIDs);
    for (const id of ids) {
      const n = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE id = ?`, id);
      if (!n || n.n === 0) throw new NotFoundError();
    }
    this.run(`DELETE FROM comparison_group_products WHERE group_id = ?`, groupID);
    for (const id of ids) {
      this.run(`INSERT INTO comparison_group_products (group_id, product_id) VALUES (?, ?)`, groupID, id);
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
      const id = this.insert(
        `INSERT INTO receipts (image_path, raw_response, status, error_message, created_at, source, external_id, source_payload)
         VALUES (?, '', ?, '', ?, ?, ?, ?)`,
        imagePathVal,
        RECEIPT_PENDING,
        this.nowRFC3339(),
        source,
        externalID,
        payload,
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
    return this.all<{ external_id: string }>(
      `SELECT external_id FROM receipts WHERE source = ? AND external_id != ''`,
      source,
    ).map((r) => r.external_id);
  }

  latestSourcedBoughtOn(source: string): string {
    source = source.trim().toLowerCase();
    if (source === '') return '';
    const row = this.get<{ bought_on: string }>(
      `SELECT COALESCE(MAX(json_extract(raw_response, '$.bought_on')), '') AS bought_on
       FROM receipts WHERE source = ? AND json_valid(raw_response) AND json_extract(raw_response, '$.bought_on') != ''`,
      source,
    );
    return (row?.bought_on ?? '').trim();
  }

  getReceipt(id: number): Receipt {
    const row = this.get<Receipt>(
      `SELECT id AS ID, image_path AS ImagePath, raw_response AS RawResponse, status AS Status,
        created_at AS CreatedAt, error_message AS ErrorMessage, source AS Source, external_id AS ExternalID,
        source_payload AS SourcePayload FROM receipts WHERE id = ?`,
      id,
    );
    if (!row) throw new NotFoundError();
    return row;
  }

  listReceipts(): Receipt[] {
    return this.all<{
      ID: number;
      ImagePath: string;
      Status: string;
      ErrorMessage: string;
      CreatedAt: string;
    }>(
      `SELECT id AS ID, image_path AS ImagePath, status AS Status, error_message AS ErrorMessage, created_at AS CreatedAt
       FROM receipts ORDER BY id DESC`,
    ).map((r) => ({
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
    return this.all<{ id: number }>(`SELECT id FROM receipts WHERE status = ? ORDER BY id`, RECEIPT_PENDING).map(
      (r) => r.id,
    );
  }

  saveAIResponse(id: number, rawJSON: string): void {
    const n = this.run(
      `UPDATE receipts SET raw_response = ?, status = ?, error_message = '' WHERE id = ? AND status IN (?, ?)`,
      rawJSON,
      RECEIPT_READY,
      id,
      RECEIPT_PENDING,
      RECEIPT_FAILED,
    );
    if (n === 0) {
      const r = this.getReceipt(id);
      if (r.Status === RECEIPT_MIGRATED) throw new ReceiptMigratedError();
      throw new NotFoundError();
    }
  }

  failReceipt(id: number, msg: string): void {
    const n = this.run(
      `UPDATE receipts SET status = ?, error_message = ? WHERE id = ? AND status = ?`,
      RECEIPT_FAILED,
      msg.trim(),
      id,
      RECEIPT_PENDING,
    );
    if (n === 0) {
      this.getReceipt(id);
      throw new NotFoundError();
    }
  }

  requeueReceipt(id: number): void {
    const n = this.run(
      `UPDATE receipts SET status = ?, error_message = '' WHERE id = ? AND status = ?`,
      RECEIPT_PENDING,
      id,
      RECEIPT_FAILED,
    );
    if (n === 0) {
      const r = this.getReceipt(id);
      if (r.Status === RECEIPT_PENDING) return;
      throw new ReceiptNotReadyError();
    }
  }

  updateReceiptJSON(id: number, rawJSON: string): void {
    const n = this.run(`UPDATE receipts SET raw_response = ? WHERE id = ? AND status = ?`, rawJSON, id, RECEIPT_READY);
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
      this.run(`UPDATE receipts SET status = ?, raw_response = ? WHERE id = ?`, RECEIPT_MIGRATED, rawJSON, id);
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
      this.run(`UPDATE purchases SET story_id = ?, bought_on = ? WHERE receipt_id = ?`, story, boughtOn, id);
      const raw = this.patchBillVisitJSON(r.RawResponse, storyID, boughtOn);
      this.run(`UPDATE receipts SET raw_response = ? WHERE id = ?`, raw, id);
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
    const n = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM units WHERE id = ?`, unitID);
    if (!n || n.n === 0) throw new InvalidUnitError();
    const aliasCount = this.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM product_aliases WHERE alias = ? COLLATE NOCASE`,
      name,
    );
    if ((aliasCount?.n ?? 0) > 0) throw new DuplicateError();
    const id = this.insert(
      `INSERT INTO products (name, unit_id, image_path, created_at) VALUES (?, ?, NULL, ?)`,
      name,
      unitID,
      this.nowRFC3339(),
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
      if (
        err instanceof DuplicateError ||
        err instanceof InvalidAliasError ||
        err instanceof AliasScopeError
      ) {
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
    const id = this.insert(
      `INSERT INTO purchases (product_id, story_id, kind, receipt_id, bought_on, quantity, amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      productID,
      storyID || null,
      KIND_PURCHASE,
      receiptID || null,
      boughtOn,
      quantity.toString(),
      amount.toString(),
      this.nowRFC3339(),
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

  private all<T>(sql: string, ...params: unknown[]): T[] {
    return this.db.sqlite.prepare(sql).all(...params) as T[];
  }

  private get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.sqlite.prepare(sql).get(...params) as T | undefined;
  }

  private run(sql: string, ...params: unknown[]): number {
    return this.db.sqlite.prepare(sql).run(...params).changes;
  }

  private insert(sql: string, ...params: unknown[]): number {
    return Number(this.db.sqlite.prepare(sql).run(...params).lastInsertRowid);
  }
}

function splitBoughtOnSafe(s: string): { date: string; clock: string } {
  const t = s.trim().replaceAll('T', ' ').replaceAll('\u00a0', ' ');
  const parts = t.split(/\s+/);
  return { date: parts[0] ?? '', clock: parts[1]?.slice(0, 5) ?? '' };
}
