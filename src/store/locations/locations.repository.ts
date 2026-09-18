import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service.js';
import { changesOf, countOf, emptyStr, lastId, nocaseOrder } from '../../db/query.js';
import { productAliases, purchases, retailChains, stores } from '../../db/schema.js';
import {
  DuplicateError,
  InvalidRetailChainError,
  InvalidStoreError,
  isUniqueErr,
  NotFoundError,
  RetailChainInUseError,
  SameStoreError,
  StoreInUseError,
} from '../../domain/errors.js';
import type { ImportedShop, RetailChain, Store, StoreImportResult, StoreMergePlan } from './locations.models.js';

const chainStoreCount = sql<number>`cast(count(${stores.id}) as integer)`.mapWith(Number);

@Injectable()
export class LocationsRepository {
  constructor(private readonly db: DatabaseService) {}

  private get orm() {
    return this.db.drizzle;
  }

  listRetailChains(): RetailChain[] {
    return this.chainQuery().groupBy(retailChains.id).orderBy(nocaseOrder(retailChains.name), retailChains.id).all();
  }

  getRetailChain(id: number): RetailChain {
    const row = this.chainQuery().where(eq(retailChains.id, id)).groupBy(retailChains.id).get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createRetailChain(name: string, legalName: string, taxId: string): RetailChain {
    const c = this.normalizeRetailChain(name, legalName, taxId);
    try {
      const id = lastId(
        this.orm.insert(retailChains).values({ name: c.name, legalName: c.legalName, taxId: c.taxId }).run(),
      );
      return this.getRetailChain(id);
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  updateRetailChain(id: number, name: string, legalName: string, taxId: string): void {
    const c = this.normalizeRetailChain(name, legalName, taxId);
    try {
      const n = changesOf(
        this.orm
          .update(retailChains)
          .set({ name: c.name, legalName: c.legalName, taxId: c.taxId })
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
    if (c.storeCount > 0) throw new RetailChainInUseError();
    const n = changesOf(this.orm.delete(retailChains).where(eq(retailChains.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  listStores(): Store[] {
    return this.storeQuery().groupBy(stores.id).orderBy(nocaseOrder(stores.name), stores.id).all();
  }

  getStore(id: number): Store {
    const row = this.storeQuery().where(eq(stores.id, id)).groupBy(stores.id).get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createStore(
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalId: string,
    retailChainId: number | null,
    lat: number | null = null,
    lng: number | null = null,
  ): Store {
    const c = this.normalizeStore(name, streetName, building, apartment, postalCode, city, externalId, lat, lng);
    const id = this.insertStore(c, retailChainId);
    return this.getStore(id);
  }

  updateStore(
    id: number,
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalId: string,
    retailChainId: number | null,
    lat: number | null = null,
    lng: number | null = null,
  ): void {
    const c = this.normalizeStore(name, streetName, building, apartment, postalCode, city, externalId, lat, lng);
    const chain = this.optionalChain(retailChainId);
    try {
      const n = changesOf(
        this.orm
          .update(stores)
          .set({
            name: c.name,
            streetName: c.streetName,
            buildingNumber: c.buildingNumber,
            apartmentNumber: c.apartmentNumber,
            postalCode: c.postalCode,
            city: c.city,
            externalId: c.externalId,
            retailChainId: chain,
            lat: c.lat,
            lng: c.lng,
          })
          .where(eq(stores.id, id))
          .run(),
      );
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof InvalidRetailChainError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  deleteStore(id: number): void {
    const c = this.getStore(id);
    if (c.purchaseCount > 0) throw new StoreInUseError();
    const n = changesOf(this.orm.delete(stores).where(eq(stores.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  mergePlan(intoId: number, fromId: number): StoreMergePlan {
    const { into, from } = this.mergePair(intoId, fromId);
    const aliases = this.orm.select({ n: count() }).from(productAliases).where(eq(productAliases.storeId, from.id)).get();
    return {
      into,
      from,
      history: from.purchaseCount,
      aliases: countOf(aliases?.n),
      takeCode: into.externalId === '' && from.externalId !== '',
      takeCoords: into.lat == null && into.lng == null && (from.lat != null || from.lng != null),
      takeChain: into.retailChainId == null && from.retailChainId != null,
    };
  }

  mergeStores(intoId: number, fromId: number): { keeper: Store } {
    return this.db.immediate(() => {
      const { into, from } = this.mergePair(intoId, fromId);
      this.reassignPurchases(from.id, into.id);
      this.reassignAliases(from.id, into.id);
      this.reassignReceipts(from.id, into.id);
      this.orm.delete(stores).where(eq(stores.id, from.id)).run();
      this.handOffStoreFields(into, from);
      return { keeper: this.getStore(into.id) };
    });
  }

  upsertImportedStores(retailChainId: number, shops: ImportedShop[]): StoreImportResult {
    this.optionalChain(retailChainId);
    return this.db.immediate(() => {
      const existing = this.listStores();
      const byExt = new Map<string, Store>();
      const byAddr = new Map<string, Store>();
      for (const store of existing) {
        if (store.externalId !== '') byExt.set(store.externalId.toLowerCase(), store);
        if (store.retailChainId !== retailChainId || store.externalId !== '') continue;
        const addr = storeAddrMatchKey(store);
        if (addr !== '') byAddr.set(addr, store);
      }
      let created = 0;
      let updated = 0;
      for (const shop of shops) {
        const ext = shop.externalId.trim();
        if (ext === '') continue;
        const extKey = ext.toLowerCase();
        const addr = storeAddrMatchKey(shop);
        const match = byExt.get(extKey) ?? (addr === '' ? undefined : byAddr.get(addr));
        if (match) {
          this.updateStore(
            match.id,
            shop.name,
            shop.streetName,
            shop.buildingNumber,
            match.apartmentNumber,
            match.postalCode,
            shop.city,
            ext,
            retailChainId,
            shop.lat,
            shop.lng,
          );
          const next = this.getStore(match.id);
          byExt.set(extKey, next);
          if (addr !== '') byAddr.delete(addr);
          updated += 1;
          continue;
        }
        const next = this.createStore(
          shop.name,
          shop.streetName,
          shop.buildingNumber,
          '',
          '',
          shop.city,
          ext,
          retailChainId,
          shop.lat,
          shop.lng,
        );
        byExt.set(extKey, next);
        created += 1;
      }
      return { created, updated };
    });
  }

  insertStore(c: Store, retailChainId: number | null): number {
    const chain = this.optionalChain(retailChainId);
    try {
      return lastId(
        this.orm
          .insert(stores)
          .values({
            name: c.name,
            streetName: c.streetName,
            buildingNumber: c.buildingNumber,
            apartmentNumber: c.apartmentNumber,
            postalCode: c.postalCode,
            city: c.city,
            externalId: c.externalId,
            retailChainId: chain,
            lat: c.lat,
            lng: c.lng,
          })
          .run(),
      );
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  normalizeStore(
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalId: string,
    lat: number | null = null,
    lng: number | null = null,
  ): Store {
    return {
      id: 0,
      name,
      streetName,
      buildingNumber: building,
      apartmentNumber: apartment,
      postalCode,
      city,
      externalId,
      lat,
      lng,
      retailChainId: null,
      retailChainName: '',
      purchaseCount: 0,
    };
  }

  optionalStore(id: number | null | undefined): number | null {
    if (!id) return null;
    const n = this.orm.select({ n: count() }).from(stores).where(eq(stores.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidStoreError();
    return id;
  }

  optionalChain(id: number | null | undefined): number | null {
    if (!id) return null;
    const n = this.orm.select({ n: count() }).from(retailChains).where(eq(retailChains.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidRetailChainError();
    return id;
  }

  storeChainID(storeId: number | null | undefined): number | null {
    if (!storeId) return null;
    const row = this.orm.select({ retailChainId: stores.retailChainId }).from(stores).where(eq(stores.id, storeId)).get();
    return row?.retailChainId ?? null;
  }

  private storeQuery() {
    return this.orm
      .select({
        id: stores.id,
        name: stores.name,
        streetName: stores.streetName,
        buildingNumber: stores.buildingNumber,
        apartmentNumber: stores.apartmentNumber,
        postalCode: stores.postalCode,
        city: stores.city,
        externalId: stores.externalId,
        lat: stores.lat,
        lng: stores.lng,
        retailChainId: stores.retailChainId,
        retailChainName: emptyStr(retailChains.name),
        purchaseCount: sql<number>`cast(count(${purchases.id}) as integer)`.mapWith(Number),
      })
      .from(stores)
      .leftJoin(retailChains, eq(retailChains.id, stores.retailChainId))
      .leftJoin(purchases, eq(purchases.storeId, stores.id));
  }

  private chainQuery() {
    return this.orm
      .select({
        id: retailChains.id,
        name: retailChains.name,
        legalName: retailChains.legalName,
        taxId: retailChains.taxId,
        storeCount: chainStoreCount,
      })
      .from(retailChains)
      .leftJoin(stores, eq(stores.retailChainId, retailChains.id));
  }

  private normalizeRetailChain(name: string, legalName: string, taxId: string): RetailChain {
    return {
      id: 0,
      name,
      legalName,
      taxId: this.normalizeTaxID(taxId),
      storeCount: 0,
    };
  }

  private normalizeTaxID(s: string): string {
    return [...s.trim()].filter((r) => /[\p{L}\p{N}]/u.test(r)).join('').toUpperCase();
  }

  private mergePair(intoId: number, fromId: number): { into: Store; from: Store } {
    if (intoId === fromId) throw new SameStoreError();
    const into = this.getStore(intoId);
    const from = this.getStore(fromId);
    if (into.externalId !== '' && from.externalId !== '' && into.externalId.toLowerCase() !== from.externalId.toLowerCase()) {
      throw new DuplicateError();
    }
    return { into, from };
  }

  private reassignPurchases(fromId: number, intoId: number): void {
    this.orm.update(purchases).set({ storeId: intoId }).where(eq(purchases.storeId, fromId)).run();
  }

  private reassignAliases(fromId: number, intoId: number): void {
    this.orm.run(sql`
      DELETE FROM product_aliases
      WHERE product_aliases.store_id = ${fromId}
        AND EXISTS (
          SELECT 1 FROM product_aliases AS k
          WHERE k.store_id = ${intoId}
            AND k.alias = product_aliases.alias COLLATE NOCASE
        )
    `);
    this.orm.update(productAliases).set({ storeId: intoId }).where(eq(productAliases.storeId, fromId)).run();
  }

  private reassignReceipts(fromId: number, intoId: number): void {
    this.orm.run(sql`
      UPDATE receipts
      SET raw_response = json_set(raw_response, '$.company_id', ${intoId})
      WHERE json_valid(raw_response)
        AND CAST(json_extract(raw_response, '$.company_id') AS INTEGER) = ${fromId}
    `);
  }

  private handOffStoreFields(into: Store, from: Store): void {
    this.orm
      .update(stores)
      .set({
        streetName: filledStr(into.streetName, from.streetName),
        buildingNumber: filledStr(into.buildingNumber, from.buildingNumber),
        apartmentNumber: filledStr(into.apartmentNumber, from.apartmentNumber),
        postalCode: filledStr(into.postalCode, from.postalCode),
        city: filledStr(into.city, from.city),
        externalId: filledStr(into.externalId, from.externalId),
        lat: into.lat ?? from.lat,
        lng: into.lng ?? from.lng,
        retailChainId: into.retailChainId ?? from.retailChainId,
      })
      .where(eq(stores.id, into.id))
      .run();
  }
}

function filledStr(into: string, from: string): string {
  return into.trim() === '' ? from : into;
}

function storeAddrMatchKey(s: { streetName: string; buildingNumber: string; city: string }): string {
  const street = s.streetName.trim().toLowerCase();
  const city = s.city.trim().toLowerCase();
  if (street === '' || city === '') return '';
  return `${street}\0${s.buildingNumber.trim().toLowerCase()}\0${city}`;
}
