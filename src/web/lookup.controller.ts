import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { StoreService } from '../store/store.service';
import { formatMoneyPerUnit } from '../domain/format';
import { bestRecentPrice, pricesBetween } from '../domain/price-stats';
import { boughtOnDate } from '../domain/bought-on';
import { ViewsService } from './views.service';
import { presentProduct, presentQuote, presentRelated } from './present';

const querySchema = z.object({ q: z.string().optional().default('') });
const SUGGEST_LIMIT = 10;

@Controller()
export class LookupController {
  constructor(
    private readonly store: StoreService,
    private readonly views: ViewsService,
  ) {}

  @Get('/')
  home(@Req() req: Request, @Res() res: Response): void {
    const q = querySchema.parse({ q: req.query.q }).q.trim();
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
  suggestionsJSON(@Req() req: Request, @Res() res: Response): void {
    try {
      const items = this.loadSuggestions(String(req.query.q ?? ''));
      res.json(this.toSuggestItems(items));
    } catch {
      this.views.text(res, 500, 'could not search products');
    }
  }

  @Get('/api/products/suggestions.html')
  suggestionsHTML(@Req() req: Request, @Res() res: Response): void {
    const q = String(req.query.q ?? '').trim();
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
  showLookup(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      this.views.text(res, 404, 'not found');
      return;
    }
    try {
      const p = this.store.getProduct(id);
      const purchases = this.store.listPurchases(id);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const from365 = new Date(today);
      from365.setDate(from365.getDate() - 365);
      const points = pricesBetween(purchases, from365, today);
      const rows = points.map((pt) => ({ on: boughtOnDate(pt.BoughtOn), price: pt.Price.toString() }));
      const related = this.store.relatedGroupProducts(id, now);
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
    return this.store.searchProductQuotes(q.trim(), new Date(), SUGGEST_LIMIT);
  }

  private toSuggestItems(items: ReturnType<StoreService['searchProductQuotes']>) {
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
