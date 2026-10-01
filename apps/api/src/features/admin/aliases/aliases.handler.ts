import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { InvalidRetailChainError, InvalidStoreError } from '../../../domain/errors.js';
import { AliasesRepository, type ProductAlias } from '#app/store/aliases';
import { LocationsRepository } from '#app/store/locations';
import { ProductsRepository, type Product } from '#app/store/products';
import { presentAlias, presentChain, presentStore } from '../../../web/present.js';
import { asResponse } from '../http.js';
import { type AliasRequest } from './contract/request.js';
import {
  AdminAliasDeletedResponse,
  AdminAliasFormResponse,
  AdminAliasResponse,
  AdminAliasesResponse,
} from './contract/response.js';

@Injectable()
export class AdminAliasesHandler {
  constructor(
    private readonly aliases: AliasesRepository,
    private readonly products: ProductsRepository,
    private readonly locations: LocationsRepository,
  ) {}

  list(query: { product: number }): AdminAliasesResponse {
    const filter = query.product > 0 ? this.products.getProduct(query.product) : null;
    const rows = filter ? this.aliases.listAliasesByProduct(filter.id) : this.aliases.listAliases();
    return asResponse(AdminAliasesResponse, {
      aliases: rows.map(presentAlias),
      filter,
      productQuery: filter ? `?product=${filter.id}` : '',
    });
  }

  blank(query: { product: number }): AdminAliasFormResponse {
    const lookups = this.lookups();
    const alias = emptyAlias();
    let locked: Product | null = null;
    if (query.product > 0) {
      locked = this.products.getProduct(query.product);
      alias.productId = locked.id;
    }
    return asResponse(AdminAliasFormResponse, {
      ...lookups,
      alias: presentAlias(alias),
      lockedProduct: locked,
      fromProduct: query.product,
    });
  }

  get(aliasId: number): AdminAliasFormResponse {
    return asResponse(AdminAliasFormResponse, {
      ...this.lookups(),
      alias: presentAlias(this.aliases.getAlias(aliasId)),
      lockedProduct: null,
      fromProduct: 0,
    });
  }

  create(body: z.infer<typeof AliasRequest>): AdminAliasResponse {
    const { storeID, chainID } = parseAliasScope(body.scope);
    return asResponse(
      AdminAliasResponse,
      presentAlias(this.aliases.createAlias(body.product_id, storeID || null, chainID || null, body.alias)),
    );
  }

  update(aliasId: number, body: z.infer<typeof AliasRequest>): AdminAliasResponse {
    this.aliases.getAlias(aliasId);
    const { storeID, chainID } = parseAliasScope(body.scope);
    this.aliases.updateAlias(aliasId, body.product_id, storeID || null, chainID || null, body.alias);
    return asResponse(AdminAliasResponse, presentAlias(this.aliases.getAlias(aliasId)));
  }

  remove(aliasId: number): AdminAliasDeletedResponse {
    const alias = this.aliases.getAlias(aliasId);
    this.aliases.deleteAlias(aliasId);
    return asResponse(AdminAliasDeletedResponse, { ok: true, alias: alias.alias });
  }

  private lookups() {
    return {
      products: this.products.listProducts(''),
      stores: this.locations.listStores().map(presentStore),
      chains: this.locations.listRetailChains().map(presentChain),
    };
  }
}

function parseAliasScope(raw: string): { storeID: number; chainID: number } {
  raw = raw.trim();
  if (raw === '') return { storeID: 0, chainID: 0 };
  const i = raw.indexOf(':');
  if (i < 0) throw new InvalidStoreError();
  const kind = raw.slice(0, i);
  const n = Number.parseInt(raw.slice(i + 1), 10);
  if (!Number.isFinite(n) || n <= 0) {
    if (kind === 'chain') throw new InvalidRetailChainError();
    throw new InvalidStoreError();
  }
  if (kind === 'store') return { storeID: n, chainID: 0 };
  if (kind === 'chain') return { storeID: 0, chainID: n };
  throw new InvalidStoreError();
}

function emptyAlias(): ProductAlias {
  return {
    id: 0,
    productId: 0,
    productName: '',
    storeId: null,
    storeName: '',
    retailChainId: null,
    retailChainName: '',
    alias: '',
  };
}
