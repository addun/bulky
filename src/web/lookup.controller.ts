import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ComparisonGroupsRepository } from '#app/store/comparison-groups';
import { ProductsRepository, type ProductQuote } from '#app/store/products';
import { PurchasesRepository, type Purchase } from '#app/store/purchases';
import { formatMoneyPerUnit } from '../domain/format.js';
import { bestRecentPrice, pricesBetween } from '../domain/price-stats.js';
import { boughtOnDate } from '../domain/bought-on.js';
import { ViewsService } from './views.service.js';
import { presentProductPage, presentPromoCard } from './present.js';
import { id, qQuery } from './schema.js';

const SUGGEST_LIMIT = 10;
const POPULAR_LIMIT = 6;

@Controller()
export class LookupController {
  constructor(
    private readonly products: ProductsRepository,
    private readonly purchases: PurchasesRepository,
    private readonly groups: ComparisonGroupsRepository,
    private readonly views: ViewsService,
  ) {}

  @Get('/')
  home(@Query({ schema: qQuery }) query: { q: string }, @Res() res: Response): void {
    const q = query.q;
    try {
      const popularItems = this.loadPopular();
      const popular = this.presentCards(popularItems);
      const products = q ? this.presentCards(this.loadSuggestions(q)) : popular;
      this.views.html(res, 'lookup', 200, {
        page: this.views.page('Czy to promka', q, ''),
        query: q,
        mode: q ? 'search' : 'popular',
        products,
        popular,
      });
    } catch {
      this.views.text(res, 500, 'could not search products');
    }
  }

  @Get('/api/products/suggestions.json')
  suggestionsJSON(@Query({ schema: qQuery }) query: { q: string }, @Res() res: Response): void {
    try {
      const items = this.loadSuggestions(query.q);
      res.json(this.toSuggestItems(items));
    } catch {
      this.views.text(res, 500, 'could not search products');
    }
  }

  @Get('/api/products/suggestions.html')
  suggestionsHTML(@Query({ schema: qQuery }) query: { q: string }, @Res() res: Response): void {
    const q = query.q;
    try {
      const items = q ? this.loadSuggestions(q) : this.loadPopular();
      this.views.html(res, 'lookup_suggestions', 200, {
        query: q,
        mode: q ? 'search' : 'popular',
        products: this.presentCards(items),
      });
    } catch {
      this.views.text(res, 500, 'could not search products');
    }
  }

  @Get('/products/:id')
  showLookup(@Param('id', { schema: id }) productId: number, @Res() res: Response): void {
    try {
      const p = this.products.getProduct(productId);
      const purchases = this.purchases.listPurchases(productId);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const from365 = new Date(today);
      from365.setDate(from365.getDate() - 365);
      const points = pricesBetween(purchases, from365, today);
      const rows = points.map((pt) => ({ on: boughtOnDate(pt.boughtOn), price: pt.price.toString() }));
      const related = this.groups.relatedGroupProducts(productId, now);
      this.views.html(res, 'lookup_show', 200, {
        page: this.views.page(p.name, '', ''),
        ...presentProductPage(p, purchases, bestRecentPrice(purchases, now), points),
        chartJSON: JSON.stringify(rows),
        hasChart: points.length > 0,
        chartFrom: fmtDay(from365),
        chartTo: fmtDay(today),
        related: this.presentCards(
          related.map((r) => ({ product: this.products.getProduct(r.id), quote: r.quote })),
        ),
      });
    } catch (err) {
      if ((err as Error).name === 'NotFoundError') {
        this.views.text(res, 404, 'not found');
        return;
      }
      this.views.text(res, 500, 'could not load product');
    }
  }

  private loadSuggestions(q: string) {
    return this.products.searchProductQuotes(q, new Date(), SUGGEST_LIMIT);
  }

  private loadPopular() {
    return this.products.listPopularProductQuotes(new Date(), POPULAR_LIMIT);
  }

  private presentCards(items: ProductQuote[]) {
    const byProduct = groupPurchases(this.purchases.listPurchasesForProductIDs(items.map((it) => it.product.id)));
    return items.map((it) => presentPromoCard(it.product, it.quote, byProduct.get(it.product.id) ?? []));
  }

  private toSuggestItems(items: ReturnType<ProductsRepository['searchProductQuotes']>) {
    return items.map((it) => {
      const img =
        it.product.imagePath && it.product.imagePath.trim() !== ''
          ? `/images/${it.product.imagePath}`
          : '';
      return {
        id: it.product.id,
        name: it.product.name,
        unit: it.product.unitName,
        image: img,
        price: it.quote
          ? formatMoneyPerUnit(it.quote.price, this.views.symbol, it.product.unitName)
          : undefined,
      };
    });
  }
}

function groupPurchases(buys: Purchase[]): Map<number, Purchase[]> {
  const out = new Map<number, Purchase[]>();
  for (const buy of buys) {
    const list = out.get(buy.productId) ?? [];
    list.push(buy);
    out.set(buy.productId, list);
  }
  return out;
}

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
