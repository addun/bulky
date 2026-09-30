import { format, startOfDay, subDays } from 'date-fns';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';
import { and, desc, eq, exists, gte, gt, inArray, like, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { nocaseOrder } from '../../../db/query.js';
import { productAliases, products, purchases, units } from '../../../db/schema.js';
import { quotesByProduct, type QuotedPrice } from '../../../domain/price-stats.js';
import { KIND_PURCHASE, type Purchase, type PurchaseKind } from '../../../store/purchases/purchases.models.js';
import { type GetAdminProductsRequest } from './contract/request.js';
import { AdminProductsResponse } from './contract/response.js';
import { DATABASE, type Database } from './database.js';

const laterPurchase = alias(purchases, 'later_purchase');

@Injectable()
export class AdminProductsHandler {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly config: ConfigService,
  ) { }

  list(query: z.infer<typeof GetAdminProductsRequest>): AdminProductsResponse {
    const whereStatement = this.getWhereStatement(query.q);

    const rows = this.database
      .select({
        id: products.id,
        name: products.name,
        unitName: units.name,
        compareValue: units.compareValue,
        imagePath: products.imagePath,
      })
      .from(products)
      .where(whereStatement)
      .innerJoin(units, eq(units.id, products.unitId))
      .orderBy(nocaseOrder(products.name))
      .limit(query.limit)
      .offset(query.offset)
      .all();

    const lastBought = this.lastBought(rows.map((row) => row.id));
    const quotes = this.quotes(rows.map((row) => row.id));
    const symbol = this.config.get<string>('CURRENCY_SYMBOL') || 'zł';

    return AdminProductsResponse.parse({
      query: query.q,
      offset: query.offset,
      limit: query.limit,
      currency: symbol,
      products: rows.map((row) => {
        const imagePath = row.imagePath?.trim() ?? '';
        const quote = quotes.get(row.id);
        
        return {
          id: row.id,
          name: row.name,
          unitName: row.unitName,
          image: imagePath ? `/images/${imagePath}` : '',
          compareValue: row.compareValue,
          lastBought: lastBought.get(row.id) ?? '',
          price: quote ? quote.price.toString() : '',
        };
      }),
    });
  }

  private lastBought(ids: number[]): Map<number, string> {
    const out = new Map<number, string>();

    if (ids.length === 0) return out;

    const rows = this.database
      .select({
        productId: purchases.productId,
        boughtOn: sql<string>`max(${purchases.boughtOn})`.mapWith(String),
      })
      .from(purchases)
      .where(and(eq(purchases.kind, KIND_PURCHASE), inArray(purchases.productId, ids)))
      .groupBy(purchases.productId)
      .all();

    for (const row of rows) out.set(row.productId, row.boughtOn);
    
    return out;
  }

  private quotes(ids: number[]): Map<number, QuotedPrice> {
    if (ids.length === 0) return new Map();

    const now = new Date();
    const fromDay = format(subDays(startOfDay(now), 30), 'yyyy-MM-dd');

    const recent = this.purchaseRows(
      and(inArray(purchases.productId, ids), gte(purchases.boughtOn, fromDay)),
    );
    const quotes = quotesByProduct(recent, now);
    
    const missing = ids.filter((id) => !quotes.has(id));
    if (missing.length === 0) return quotes;
    const latest = this.purchaseRows(
      and(
        inArray(purchases.productId, missing),
        notExists(
          this.database
            .select({ id: laterPurchase.id })
            .from(laterPurchase)
            .where(
              and(
                eq(laterPurchase.productId, purchases.productId),
                or(
                  gt(laterPurchase.boughtOn, purchases.boughtOn),
                  and(eq(laterPurchase.boughtOn, purchases.boughtOn), gt(laterPurchase.id, purchases.id)),
                ),
              ),
            ),
        ),
      ),
    );
    for (const [id, quote] of quotesByProduct(latest, now)) quotes.set(id, quote);
    return quotes;
  }

  private purchaseRows(where: ReturnType<typeof and>): Purchase[] {
    return this.database
      .select()
      .from(purchases)
      .where(where)
      .orderBy(desc(purchases.boughtOn), desc(purchases.id))
      .all()
      .map((row) => ({
        ...row,
        kind: row.kind as PurchaseKind,
        quantity: new Decimal(row.quantity),
        amount: new Decimal(row.amount),
      }));
  }

  private getWhereStatement(q: string) {
    if (q === '') {
      return undefined;
    }

    const term = `%${q}%`;

    return or(
      like(products.name, term),
      exists(
        this.database
          .select({ id: productAliases.id })
          .from(productAliases)
          .where(and(eq(productAliases.productId, products.id), like(productAliases.alias, term))),
      ),
    )
  }
}
