import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { NotFoundError } from '../../../domain/errors.js';
import { fetchBiedronkaShops, importedShopsFromBiedronka } from '../../../imports/biedronka-shops.js';
import { LocationsRepository, type RetailChain } from '#app/store/locations';
import { presentChain } from '../../../web/present.js';
import { asResponse, problem } from '../http.js';
import { type BiedronkaShopsImportRequest } from './contract/request.js';
import {
  AdminBiedronkaImportedResponse,
  AdminBiedronkaImportResponse,
  AdminImportsResponse,
} from './contract/response.js';

@Injectable()
export class AdminImportsHandler {
  private readonly log = new Logger('StoreImports');

  constructor(private readonly locations: LocationsRepository) {}

  list(): AdminImportsResponse {
    return asResponse(AdminImportsResponse, {
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

  biedronka(): AdminBiedronkaImportResponse {
    const chains = this.locations.listRetailChains();
    return asResponse(AdminBiedronkaImportResponse, {
      retailChains: chains.map(presentChain),
      retailChainId: defaultChainId(chains),
    });
  }

  async importBiedronka(body: z.infer<typeof BiedronkaShopsImportRequest>): Promise<AdminBiedronkaImportedResponse> {
    try {
      this.locations.getRetailChain(body.retail_chain_id);
    } catch (err) {
      if (err instanceof NotFoundError) problem(422, 'Choose a retail chain.');
      throw err;
    }
    let shops;
    try {
      shops = await fetchBiedronkaShops();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load Biedronka shops';
      this.log.warn(`biedronka shops fetch failed: ${message}`);
      problem(502, message);
    }
    const imported = importedShopsFromBiedronka(shops);
    try {
      const counts = this.locations.upsertImportedStores(body.retail_chain_id, imported);
      const result = { ...counts, skipped: shops.length - imported.length, total: shops.length };
      this.log.log(`biedronka shops: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`);
      return asResponse(AdminBiedronkaImportedResponse, { retailChainId: body.retail_chain_id, result });
    } catch (err) {
      this.log.warn(`biedronka shops save failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}

function defaultChainId(chains: RetailChain[]): number {
  const named = chains.find((chain) => chain.name.toLowerCase() === 'biedronka');
  if (named) return named.id;
  if (chains.length === 1) return chains[0]!.id;
  return 0;
}
