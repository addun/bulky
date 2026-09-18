import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service.js';
import { changesOf, countOf, emptyStr, lastId, nocaseOrder } from '../../db/query.js';
import { purchases, retailChains, stores } from '../../db/schema.js';
import {
  DuplicateError,
  InvalidRetailChainError,
  InvalidStoreError,
  isUniqueErr,
  NotFoundError,
  RetailChainInUseError,
  StoreInUseError,
} from '../../domain/errors.js';
import type { ImportedShop, RetailChain, Store, StoreImportResult } from './locations.models.js';

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
}

function storeAddrMatchKey(s: { streetName: string; buildingNumber: string; city: string }): string {
  const street = s.streetName.trim().toLowerCase();
  const city = s.city.trim().toLowerCase();
  if (street === '' || city === '') return '';
  return `${street}\0${s.buildingNumber.trim().toLowerCase()}\0${city}`;
}
