import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { boughtOnDate } from '../domain/bought-on.js';
import { compareUnitLabel, priceAtCompare } from '../domain/format.js';
import { ProductsRepository } from '#app/store/products';

const matchLimit = 10;
const noMatchHint =
  'No catalog match. Catalog names are Polish; retry with a translation (for example bananas → banany).';

const matchSchema = z.object({
  id: z.number().describe('Catalog product id'),
  name: z.string().describe('Catalog product name'),
  unit: z.string().describe('Compare quantity and unit, for example kg or 100 g'),
  price: z.string().optional().describe('Price for that compare quantity, as a decimal string'),
  bought_on: z.string().optional().describe('Purchase date YYYY-MM-DD'),
  window: z
    .string()
    .optional()
    .describe('last_30_days when a purchase exists in the last 30 days, otherwise last_record'),
  currency: z.string().optional().describe('ISO currency code'),
});

export type BestPriceMatch = z.infer<typeof matchSchema>;

export type BestPriceOutput = {
  query: string;
  matches: BestPriceMatch[];
  hint?: string;
};

@Injectable()
export class McpService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly config: ConfigService,
  ) {}

  currency(): string {
    return this.config.get<string>('CURRENCY') || 'PLN';
  }

  createServer(): McpServer {
    const currency = this.currency();
    const products = this.products;
    const server = new McpServer({ name: 'bulkly', version: '1.0.0' });
    server.registerTool(
      'best_price',
      {
        description:
          'Find products in the Bulkly purchase log and return the best price for the unit compare quantity (1 by default, often 100 for grams). ' +
          'Uses the lowest unit price from the last 30 days when one exists; otherwise the most recent recorded unit price. ' +
          'Catalog names are Polish (plus receipt aliases). Search with the user\'s words first, then retry with a Polish translation if nothing matches. ' +
          'If several products match, return all of them and do not pick one.',
        inputSchema: {
          query: z
            .string()
            .describe(
              'Product name as the user said it. Catalog names are Polish; if nothing matches, retry with a Polish translation.',
            ),
        },
        outputSchema: {
          query: z.string(),
          matches: z.array(matchSchema),
          hint: z.string().optional().describe('Set when nothing matched, so the agent can retry in Polish'),
        },
      },
      async ({ query }) => {
        const out = bestPrice(products, query, new Date(), currency);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(out) }],
          structuredContent: out,
        };
      },
    );
    return server;
  }

  async handle(req: Request, res: Response): Promise<void> {
    const server = this.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const close = () => {
      void transport.close();
      void server.close();
    };
    res.on('close', close);
    try {
      await transport.handleRequest(req, res, req.body);
    } catch {
      close();
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }
}

export function bestPrice(products: ProductsRepository, query: string, now: Date, currency: string): BestPriceOutput {
  query = query.trim();
  if (query === '') throw new Error('query is required');
  if (currency === '') currency = 'PLN';
  const quotes = products.searchProductQuotes(query, now, matchLimit);
  const out: BestPriceOutput = { query, matches: [] };
  for (const q of quotes) {
    const unit = compareUnitLabel(q.product.unitName, q.product.compareValue);
    const m: BestPriceMatch = { id: q.product.id, name: q.product.name, unit };
    if (q.quote) {
      m.price = priceAtCompare(q.quote.price, q.product.compareValue).toString();
      m.bought_on = boughtOnDate(q.quote.boughtOn);
      m.window = q.quote.window;
      m.currency = currency;
    }
    out.matches.push(m);
  }
  if (out.matches.length === 0) out.hint = noMatchHint;
  return out;
}
