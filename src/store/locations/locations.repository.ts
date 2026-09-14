import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service';
import { changesOf, countOf, emptyStr, int0, lastId, nocaseOrder } from '../../db/query';
import { purchases, retailChains, stories } from '../../db/schema';
import {
  DuplicateError,
  InvalidRetailChainError,
  InvalidStoryError,
  isUniqueErr,
  NotFoundError,
  RetailChainInUseError,
  StoryInUseError,
} from '../../domain/errors';
import type { RetailChain, Story } from './locations.models';

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

  insertStory(c: Story, retailChainID: number): number {
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

  normalizeStory(
    name: string,
    streetName: string,
    building: string,
    apartment: string,
    postalCode: string,
    city: string,
    externalID: string,
  ): Story {
    return {
      ID: 0,
      Name: name,
      StreetName: streetName,
      BuildingNumber: building,
      ApartmentNumber: apartment,
      PostalCode: postalCode,
      City: city,
      ExternalID: externalID,
      RetailChainID: 0,
      RetailChainName: '',
      PurchaseCount: 0,
    };
  }

  optionalStory(id: number): number | null {
    if (id === 0) return null;
    const n = this.orm.select({ n: count() }).from(stories).where(eq(stories.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidStoryError();
    return id;
  }

  optionalChain(id: number): number | null {
    if (id === 0) return null;
    const n = this.orm.select({ n: count() }).from(retailChains).where(eq(retailChains.id, id)).get();
    if (countOf(n?.n) === 0) throw new InvalidRetailChainError();
    return id;
  }

  storyChainID(storyID: number): number {
    if (storyID <= 0) return 0;
    const row = this.orm.select({ retailChainId: stories.retailChainId }).from(stories).where(eq(stories.id, storyID)).get();
    return row?.retailChainId ?? 0;
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

  private normalizeRetailChain(name: string, legalName: string, taxID: string): RetailChain {
    return {
      ID: 0,
      Name: name,
      LegalName: legalName,
      TaxID: this.normalizeTaxID(taxID),
      StoryCount: 0,
    };
  }

  private normalizeTaxID(s: string): string {
    return [...s.trim()].filter((r) => /[\p{L}\p{N}]/u.test(r)).join('').toUpperCase();
  }
}
