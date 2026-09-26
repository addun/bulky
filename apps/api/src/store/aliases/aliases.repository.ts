import { Injectable } from '@nestjs/common';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service.js';
import { changesOf, countOf, emptyStr, lastId, nocaseEq, nocaseOrder } from '../../db/query.js';
import { productAliases, products, retailChains, stores } from '../../db/schema.js';
import { AliasScopeError, DuplicateError, isUniqueErr, NotFoundError } from '../../domain/errors.js';
import { stripAliasWhitespace, type ProductAlias } from './aliases.models.js';
import { LocationsRepository } from '#app/store/locations';

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
        nocaseOrder(stores.name),
        nocaseOrder(retailChains.name),
        nocaseOrder(productAliases.alias),
        productAliases.id,
      )
      .all();
  }

  listAliasesByProduct(productId: number): ProductAlias[] {
    return this.aliasQuery()
      .where(eq(productAliases.productId, productId))
      .orderBy(
        sql`${productAliases.storeId} is not null`,
        sql`${productAliases.retailChainId} is not null`,
        nocaseOrder(stores.name),
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

  createAlias(productId: number, storeId: number | null, chainId: number | null, alias: string): ProductAlias {
    const params = this.prepareAlias(productId, storeId, chainId, alias);
    try {
      const id = lastId(
        this.orm
          .insert(productAliases)
          .values({
            productId: params.productId,
            storeId: params.storeId,
            retailChainId: params.chainId,
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

  updateAlias(id: number, productId: number, storeId: number | null, chainId: number | null, alias: string): void {
    this.getAlias(id);
    const params = this.prepareAlias(productId, storeId, chainId, alias);
    try {
      const n = changesOf(
        this.orm
          .update(productAliases)
          .set({
            productId: params.productId,
            storeId: params.storeId,
            retailChainId: params.chainId,
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

  aliasExistsExcept(alias: string, exceptProductId: number): boolean {
    alias = stripAliasWhitespace(alias);
    if (alias === '') return false;
    const row = this.orm
      .select({ n: count() })
      .from(productAliases)
      .where(and(nocaseEq(productAliases.alias, alias), ne(productAliases.productId, exceptProductId)))
      .get();
    return countOf(row?.n) > 0;
  }

  reassignProduct(fromId: number, intoId: number, intoName: string): void {
    const compactName = stripAliasWhitespace(intoName);
    this.orm.run(sql`
      DELETE FROM product_aliases
      WHERE product_aliases.product_id = ${fromId}
        AND (
          product_aliases.alias = ${compactName} COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM product_aliases AS k
            WHERE k.product_id = ${intoId}
              AND k.alias = product_aliases.alias COLLATE NOCASE
              AND (
                (k.store_id IS NULL AND product_aliases.store_id IS NULL)
                OR k.store_id = product_aliases.store_id
              )
          )
        )
    `);
    this.orm.update(productAliases).set({ productId: intoId }).where(eq(productAliases.productId, fromId)).run();
  }

  private aliasQuery() {
    return this.orm
      .select({
        id: productAliases.id,
        productId: productAliases.productId,
        productName: products.name,
        storeId: productAliases.storeId,
        storeName: emptyStr(stores.name),
        retailChainId: productAliases.retailChainId,
        retailChainName: emptyStr(retailChains.name),
        alias: productAliases.alias,
      })
      .from(productAliases)
      .innerJoin(products, eq(products.id, productAliases.productId))
      .leftJoin(stores, eq(stores.id, productAliases.storeId))
      .leftJoin(retailChains, eq(retailChains.id, productAliases.retailChainId));
  }

  private prepareAlias(productId: number, storeId: number | null, chainId: number | null, alias: string) {
    if (storeId && chainId) throw new AliasScopeError();
    alias = stripAliasWhitespace(alias);
    if (alias === '') throw new DuplicateError();
    const n = this.orm.select({ n: count() }).from(products).where(eq(products.id, productId)).get();
    if (countOf(n?.n) === 0) throw new NotFoundError();
    const store = this.locations.optionalStore(storeId);
    const chain = this.locations.optionalChain(chainId);
    const names = this.orm
      .select({ name: products.name })
      .from(products)
      .where(ne(products.id, productId))
      .all();
    if (names.some((p) => stripAliasWhitespace(p.name).toLowerCase() === alias.toLowerCase())) throw new DuplicateError();
    return { productId, storeId: store, chainId: chain, alias };
  }
}
