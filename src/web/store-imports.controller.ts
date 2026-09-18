import { Body, Controller, Get, Logger, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InvalidRetailChainError, NotFoundError } from '../domain/errors.js';
import { fetchBiedronkaShops, importedShopsFromBiedronka } from '../imports/biedronka-shops.js';
import { LocationsRepository, type RetailChain, type StoreImportResult } from '#app/store/locations';
import { presentChain } from './present.js';
import { ViewsService } from './views.service.js';
import { biedronkaShopsImportForm, flashQuery, formIssue } from './schema.js';

@Controller()
export class StoreImportsController {
  private readonly log = new Logger('StoreImports');

  constructor(
    private readonly locations: LocationsRepository,
    private readonly views: ViewsService,
  ) {}

  @Get('/admin/retail-chains/imports')
  list(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    this.views.html(res, 'retail_chain_imports', 200, {
      page: this.views.adminPage('Imports', '', query.error),
      importers: [
        {
          id: 'biedronka',
          name: 'Biedronka',
          description: 'Public shop list from moja.biedronka.pl',
          href: '/admin/retail-chains/imports/biedronka',
        },
      ],
    });
  }

  @Get('/admin/retail-chains/imports/biedronka')
  biedronka(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    try {
      this.renderBiedronka(res, 200, defaultChainId(this.locations.listRetailChains()), query.error, null);
    } catch {
      this.views.text(res, 500, 'could not load retail chains');
    }
  }

  @Post('/admin/retail-chains/imports/biedronka')
  async importBiedronka(@Body() raw: unknown, @Res() res: Response): Promise<void> {
    const parsed = biedronkaShopsImportForm.safeParse(raw);
    if (!parsed.success) {
      this.renderBiedronka(res, 422, chainIdFrom(raw), formIssue(parsed.error), null);
      return;
    }
    const chainId = parsed.data.retail_chain_id;
    try {
      this.locations.getRetailChain(chainId);
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof InvalidRetailChainError) {
        this.renderBiedronka(res, 422, chainId, 'Choose a retail chain.', null);
        return;
      }
      this.renderBiedronka(res, 500, chainId, 'Could not load the retail chain.', null);
      return;
    }
    let shops;
    try {
      shops = await fetchBiedronkaShops();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load Biedronka shops';
      this.log.warn(`biedronka shops fetch failed: ${msg}`);
      this.renderBiedronka(res, 502, chainId, msg, null);
      return;
    }
    const imported = importedShopsFromBiedronka(shops);
    try {
      const counts = this.locations.upsertImportedStores(chainId, imported);
      const result = { ...counts, skipped: shops.length - imported.length, total: shops.length };
      this.log.log(`biedronka shops: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`);
      this.renderBiedronka(res, 200, chainId, '', result);
    } catch (err) {
      if (err instanceof InvalidRetailChainError) {
        this.renderBiedronka(res, 422, chainId, 'Choose a retail chain.', null);
        return;
      }
      this.log.warn(`biedronka shops save failed: ${err instanceof Error ? err.message : String(err)}`);
      this.renderBiedronka(res, 500, chainId, 'Could not save the shops.', null);
    }
  }

  private renderBiedronka(
    res: Response,
    status: number,
    chainId: number,
    errMsg: string,
    result: (StoreImportResult & { skipped: number; total: number }) | null,
  ): void {
    try {
      this.views.html(res, 'retail_chain_import_biedronka', status, {
        page: this.views.adminPage('Import Biedronka shops', '', errMsg),
        retailChains: this.locations.listRetailChains().map(presentChain),
        retailChainId: chainId,
        result,
      });
    } catch {
      this.views.text(res, 500, 'could not load retail chains');
    }
  }
}

function defaultChainId(chains: RetailChain[]): number {
  const named = chains.find((c) => c.name.toLowerCase() === 'biedronka');
  if (named) return named.id;
  if (chains.length === 1) return chains[0]!.id;
  return 0;
}

function chainIdFrom(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
  const n = Number.parseInt(String((raw as Record<string, unknown>).retail_chain_id ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}
