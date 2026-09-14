import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ComparisonGroupsRepository } from '@app/store/comparison-groups';
import { ProductsRepository } from '@app/store/products';
import { PurchasesRepository } from '@app/store/purchases';
import { formatMoneyPerUnit } from '../domain/format';
import { bestRecentPrice, pricesBetween } from '../domain/price-stats';
import { boughtOnDate } from '../domain/bought-on';
import { ViewsService } from './views.service';
import { presentProduct, presentQuote, presentRelated } from './present';
import { id, qQuery } from './schema';

const SUGGEST_LIMIT = 10;

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
      const items = this.loadSuggestions(q);
      this.views.html(res, 'lookup', 200, {
        Page: this.views.page('Find a product', q, ''),
        Query: q,
        Products: items.map((it) => ({
          Product: presentProduct(it.Product),
          Quote: presentQuote(it.Quote),
        })),
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
      const items = this.loadSuggestions(q);
      this.views.html(res, 'lookup_suggestions', 200, {
        Query: q,
        Products: items.map((it) => ({
          Product: presentProduct(it.Product),
          Quote: presentQuote(it.Quote),
        })),
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
      const rows = points.map((pt) => ({ on: boughtOnDate(pt.BoughtOn), price: pt.Price.toString() }));
      const related = this.groups.relatedGroupProducts(productId, now);
      this.views.html(res, 'lookup_show', 200, {
        Page: this.views.page(p.Name, '', ''),
        Product: presentProduct(p),
        Quote: presentQuote(bestRecentPrice(purchases, now)),
        ChartJSON: JSON.stringify(rows),
        HasChart: points.length > 0,
        ChartFrom: fmtDay(from365),
        ChartTo: fmtDay(today),
        Related: related.map(presentRelated),
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

  private toSuggestItems(items: ReturnType<ProductsRepository['searchProductQuotes']>) {
    return items.map((it) => {
      const img =
        it.Product.ImagePath.Valid && it.Product.ImagePath.String.trim() !== ''
          ? `/images/${it.Product.ImagePath.String}`
          : '';
      return {
        id: it.Product.ID,
        name: it.Product.Name,
        unit: it.Product.UnitName,
        image: img,
        price: it.Quote
          ? formatMoneyPerUnit(it.Quote.Price, this.views.symbol, it.Product.UnitName)
          : undefined,
      };
    });
  }
}

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
