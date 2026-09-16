import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service.js';
import { changesOf, countOf, emptyStr, lastId, nocaseOrder } from '../../db/query.js';
import { purchases, retailChains, stories } from '../../db/schema.js';
import {
  DuplicateError,
  InvalidRetailChainError,
  InvalidStoryError,
  isUniqueErr,
  NotFoundError,
  RetailChainInUseError,
  StoryInUseError,
} from '../../domain/errors.js';
import type { RetailChain, Story } from './locations.models.js';

const chainStoryCount = sql<number>`cast((
  select count(*) from stories s where s.retail_chain_id = ${retailChains.id}
) as integer)`.mapWith(Number);

@Injectable()
export class LocationsRepository {
  constructor(private readonly db: DatabaseService) {}

  private get orm() {
    return this.db.drizzle;
  }

  listRetailChains(): RetailChain[] {
    return this.orm
      .select({
        id: retailChains.id,
        name: retailChains.name,
        legalName: retailChains.legalName,
        taxId: retailChains.taxId,
        storyCount: chainStoryCount,
      })
      .from(retailChains)
      .orderBy(nocaseOrder(retailChains.name), retailChains.id)
      .all();
  }

  getRetailChain(id: number): RetailChain {
    const row = this.orm
      .select({
        id: retailChains.id,
        name: retailChains.name,
        legalName: retailChains.legalName,
        taxId: retailChains.taxId,
        storyCount: chainStoryCount,
      })
      .from(retailChains)
      .where(eq(retailChains.id, id))
      .get();
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
    if (c.storyCount > 0) throw new RetailChainInUseError();
    const n = changesOf(this.orm.delete(retailChains).where(eq(retailChains.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

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
    externalId: string,
    retailChainId: number | null,
  ): Story {
    const c = this.normalizeStory(name, streetName, building, apartment, postalCode, city, externalId);
    const id = this.insertStory(c, retailChainId);
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
    externalId: string,
    retailChainId: number | null,
  ): void {
    const c = this.normalizeStory(name, streetName, building, apartment, postalCode, city, externalId);
    const chain = this.optionalChain(retailChainId);
    try {
      const n = changesOf(
        this.orm
          .update(stories)
          .set({
            name: c.name,
            streetName: c.streetName,
            buildingNumber: c.buildingNumber,
            apartmentNumber: c.apartmentNumber,
            postalCode: c.postalCode,
            city: c.city,
            externalId: c.externalId,
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
    if (c.purchaseCount > 0) throw new StoryInUseError();
    const n = changesOf(this.orm.delete(stories).where(eq(stories.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  insertStory(c: Story, retailChainId: number | null): number {
    const chain = this.optionalChain(retailChainId);
    try {
      return lastId(
        this.orm
          .insert(stories)
          .values({
            name: c.name,
            streetName: c.streetName,
            buildingNumber: c.buildingNumber,
            apartmentNumber: c.apartmentNumber,
            postalCode: c.postalCode,
            city: c.city,
            externalId: c.externalId,
            retailChainId: chain,
          })
          .run(),
      );
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  normalizeStory(
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalId: string,
  ): Story {
    return {
      id: 0,
      name,
      streetName,
      buildingNumber: building,
      apartmentNumber: apartment,
      postalCode,
      city,
      externalId,
      retailChainId: null,
      retailChainName: '',
      purchaseCount: 0,
    };
  }

  optionalStory(id: number | null | undefined): number | null {
    if (!id) return null;
    const n = this.orm.select({ n: count() }).from(stories).where(eq(stories.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidStoryError();
    return id;
  }

  optionalChain(id: number | null | undefined): number | null {
    if (!id) return null;
    const n = this.orm.select({ n: count() }).from(retailChains).where(eq(retailChains.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidRetailChainError();
    return id;
  }

  storyChainID(storyId: number | null | undefined): number | null {
    if (!storyId) return null;
    const row = this.orm.select({ retailChainId: stories.retailChainId }).from(stories).where(eq(stories.id, storyId)).get();
    return row?.retailChainId ?? null;
  }

  private storyQuery() {
    return this.orm
      .select({
        id: stories.id,
        name: stories.name,
        streetName: stories.streetName,
        buildingNumber: stories.buildingNumber,
        apartmentNumber: stories.apartmentNumber,
        postalCode: stories.postalCode,
        city: stories.city,
        externalId: stories.externalId,
        retailChainId: stories.retailChainId,
        retailChainName: emptyStr(retailChains.name),
        purchaseCount: sql<number>`cast(count(${purchases.id}) as integer)`.mapWith(Number),
      })
      .from(stories)
      .leftJoin(retailChains, eq(retailChains.id, stories.retailChainId))
      .leftJoin(purchases, eq(purchases.storyId, stories.id));
  }

  private normalizeRetailChain(name: string, legalName: string, taxId: string): RetailChain {
    return {
      id: 0,
      name,
      legalName,
      taxId: this.normalizeTaxID(taxId),
      storyCount: 0,
    };
  }

  private normalizeTaxID(s: string): string {
    return [...s.trim()].filter((r) => /[\p{L}\p{N}]/u.test(r)).join('').toUpperCase();
  }
}
