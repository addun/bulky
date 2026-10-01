import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ComparisonGroupsRepository } from '#app/store/comparison-groups';
import { ProductsRepository, type ProductQuote } from '#app/store/products';
import { PurchasesRepository, type Purchase } from '#app/store/purchases';
import { NotFoundError } from '../domain/errors.js';
import { compareUnitLabel, formatMoney, formatMoneyPerUnit, priceAtCompare } from '../domain/format.js';
import { bestRecentPrice, pricesBetween } from '../domain/price-stats.js';
import { boughtOnDate } from '../domain/bought-on.js';
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
    private readonly config: ConfigService,
  ) {}

  @Get('/api/lookup.json')
  lookupJSON(@Query({ schema: qQuery }) query: { q: string }, @Res() res: Response): void {
    const q = query.q;
    try {
      const items = q ? this.loadSuggestions(q) : this.loadPopular();
      res.json({
        query: q,
        mode: q ? 'search' : 'popular',
        products: this.toViewCards(this.presentCards(items)),
      });
    } catch {
      res.status(500).json({ error: 'could not search products' });
    }
  }

  @Get('/api/lookup/:id')
  showLookup(@Param('id', { schema: id }) productId: number, @Res() res: Response): void {
    try {
      const p = this.products.getProduct(productId);
      const purchases = this.purchases.listPurchases(productId);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const from365 = new Date(today);
      from365.setDate(from365.getDate() - 365);
      const points = pricesBetween(purchases, from365, today);
      const page = presentProductPage(p, purchases, bestRecentPrice(purchases, now), points);
      const symbol = this.symbol;
      const product = page.product;
      const related = this.groups.relatedGroupProducts(productId, now);
      const chartPoints = points.map((pt) => ({
        on: boughtOnDate(pt.boughtOn),
        price: priceAtCompare(pt.price, p.compareValue).toString(),
      }));
      res.json({
        id: product.id,
        name: product.name,
        image: product.imagePath && product.imagePath.trim() !== '' ? `/images/${product.imagePath}` : '',
        initial: page.initial,
        priceEyebrow: page.priceEyebrow,
        priceNote: page.priceNote,
        now: page.quote
          ? formatMoneyPerUnit(
              priceAtCompare(page.quote.price, product.compareValue),
              symbol,
              compareUnitLabel(product.unitName, product.compareValue),
            )
          : '',
        extras: page.extras.map((extra) => ({
          price: formatMoney(extra.price, symbol),
          unitName: extra.unitName,
        })),
        stats: page.stats.map((stat) => ({
          label: stat.label,
          value: stat.money ? formatMoney(stat.money, symbol) : (stat.text ?? ''),
        })),
        chart: chartPoints.length
          ? { points: chartPoints, from: fmtDay(from365), to: fmtDay(today), symbol }
          : null,
        related: this.toViewCards(
          this.presentCards(related.map((r) => ({ product: this.products.getProduct(r.id), quote: r.quote }))),
        ),
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.status(500).json({ error: 'could not load product' });
    }
  }

  @Get('/api/products/suggestions.json')
  suggestionsJSON(@Query({ schema: qQuery }) query: { q: string }, @Res() res: Response): void {
    try {
      const items = this.loadSuggestions(query.q);
      res.json(this.toSuggestItems(items));
    } catch {
      res.status(500).json({ error: 'could not search products' });
    }
  }

  private get symbol(): string {
    return this.config.get<string>('CURRENCY_SYMBOL') || 'zł';
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

  private toViewCards(cards: Array<ReturnType<typeof presentPromoCard>>): Array<{
    id: number;
    name: string;
    image: string;
    tint: string;
    initial: string;
    now: string;
    extras: Array<{ price: string; unitName: string }>;
    priceNote: string;
  }> {
    const symbol = this.symbol;
    return cards.map((card) => {
      const product = card.product;
      return {
        id: product.id,
        name: product.name,
        image: product.imagePath && product.imagePath.trim() !== '' ? `/images/${product.imagePath}` : '',
        tint: card.tint,
        initial: card.initial,
        now: card.current
          ? formatMoneyPerUnit(
              priceAtCompare(card.current, product.compareValue),
              symbol,
              compareUnitLabel(product.unitName, product.compareValue),
            )
          : '',
        extras: card.extras.map((extra) => ({
          price: formatMoney(extra.price, symbol),
          unitName: extra.unitName,
        })),
        priceNote: card.priceNote,
      };
    });
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
        unit: compareUnitLabel(it.product.unitName, it.product.compareValue),
        image: img,
        price: it.quote
          ? formatMoneyPerUnit(
              priceAtCompare(it.quote.price, it.product.compareValue),
              this.symbol,
              compareUnitLabel(it.product.unitName, it.product.compareValue),
            )
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
