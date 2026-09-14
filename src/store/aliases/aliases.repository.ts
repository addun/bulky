import { Injectable } from '@nestjs/common';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service';
import { changesOf, countOf, emptyStr, int0, lastId, nocaseEq, nocaseOrder } from '../../db/query';
import { productAliases, products, retailChains, stories } from '../../db/schema';
import { AliasScopeError, DuplicateError, isUniqueErr, NotFoundError } from '../../domain/errors';
import type { ProductAlias } from './aliases.models';
import { LocationsRepository } from '@app/store/locations';

@Injectable()
export class AliasesRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly locations: LocationsRepository,
  ) {}

  private get orm() {
    return this.db.drizzle;
  }

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

  aliasExistsExcept(alias: string, exceptProductID: number): boolean {
    const row = this.orm
      .select({ n: count() })
      .from(productAliases)
      .where(and(nocaseEq(productAliases.alias, alias.trim()), ne(productAliases.productId, exceptProductID)))
      .get();
    return countOf(row?.n) > 0;
  }

  reassignProduct(fromID: number, intoID: number, intoName: string): void {
    this.orm.run(sql`
      DELETE FROM product_aliases
      WHERE product_aliases.product_id = ${fromID}
        AND (
          product_aliases.alias = ${intoName} COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM product_aliases AS k
            WHERE k.product_id = ${intoID}
              AND k.alias = product_aliases.alias COLLATE NOCASE
              AND (
                (k.story_id IS NULL AND product_aliases.story_id IS NULL)
                OR k.story_id = product_aliases.story_id
              )
          )
        )
    `);
    this.orm.update(productAliases).set({ productId: intoID }).where(eq(productAliases.productId, fromID)).run();
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
    if (storyID !== 0 && chainID !== 0) throw new AliasScopeError();
    const n = this.orm.select({ n: count() }).from(products).where(eq(products.id, productID)).get();
    if (countOf(n?.n) === 0) throw new NotFoundError();
    const story = this.locations.optionalStory(storyID);
    const chain = this.locations.optionalChain(chainID);
    const clash = this.orm
      .select({ n: count() })
      .from(products)
      .where(and(nocaseEq(products.name, alias), ne(products.id, productID)))
      .get();
    if (countOf(clash?.n) > 0) throw new DuplicateError();
    return { productID, storyID: story, chainID: chain, alias };
  }
}
