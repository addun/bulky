import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { LocationsRepository, type Store } from '#app/store/locations';
import { presentChain, presentStore } from '../../../web/present.js';
import { asResponse, problem } from '../http.js';
import {
  type NewStoreRequest,
  type RetailChainRequest,
  type StoreMergeRequest,
  type StoreRequest,
} from './contract/request.js';
import {
  AdminChainResponse,
  AdminChainsResponse,
  AdminCreatedStoreResponse,
  AdminNewStoreResponse,
  AdminOkResponse,
  AdminStoreFormResponse,
  AdminStoreMergeOptionsResponse,
  AdminStoreMergePlanResponse,
  AdminStoreMergedResponse,
  AdminStoreResponse,
  AdminStoresResponse,
} from './contract/response.js';

@Injectable()
export class AdminLocationsHandler {
  constructor(private readonly locations: LocationsRepository) {}

  chains(): AdminChainsResponse {
    return asResponse(AdminChainsResponse, { retailChains: this.locations.listRetailChains().map(presentChain) });
  }

  chain(chainId: number): AdminChainResponse {
    return asResponse(AdminChainResponse, presentChain(this.locations.getRetailChain(chainId)));
  }

  createChain(body: z.infer<typeof RetailChainRequest>): AdminChainResponse {
    return asResponse(
      AdminChainResponse,
      presentChain(this.locations.createRetailChain(body.name, body.legal_name, body.tax_id)),
    );
  }

  updateChain(chainId: number, body: z.infer<typeof RetailChainRequest>): AdminChainResponse {
    this.locations.updateRetailChain(chainId, body.name, body.legal_name, body.tax_id);
    return asResponse(AdminChainResponse, presentChain(this.locations.getRetailChain(chainId)));
  }

  removeChain(chainId: number): AdminOkResponse {
    const chain = this.locations.getRetailChain(chainId);
    if (chain.storeCount > 0) problem(409, `Cannot delete “${chain.name}” while a store still uses it.`);
    this.locations.deleteRetailChain(chainId);
    return asResponse(AdminOkResponse, { ok: true });
  }

  stores(): AdminStoresResponse {
    return asResponse(AdminStoresResponse, { stores: this.locations.listStores().map(presentStore) });
  }

  newStore(query: z.infer<typeof NewStoreRequest>): AdminNewStoreResponse {
    const store = emptyStore();
    store.name = query.name;
    store.streetName = query.street_name;
    store.buildingNumber = query.building_number;
    store.apartmentNumber = query.apartment_number;
    store.postalCode = query.postal_code;
    store.city = query.city;
    store.externalId = query.external_id;
    return asResponse(AdminNewStoreResponse, {
      store: presentStore(store),
      retailChains: this.locations.listRetailChains().map(presentChain),
      next: receiptReturnPath(query.next),
    });
  }

  store(storeId: number): AdminStoreFormResponse {
    return asResponse(AdminStoreFormResponse, {
      store: presentStore(this.locations.getStore(storeId)),
      retailChains: this.locations.listRetailChains().map(presentChain),
    });
  }

  createStore(body: z.infer<typeof StoreRequest>): AdminCreatedStoreResponse {
    const created = this.locations.createStore(
      body.name,
      body.street_name,
      body.building_number,
      body.apartment_number,
      body.postal_code,
      body.city,
      body.external_id,
      body.retail_chain_id,
      body.lat,
      body.lng,
    );
    return asResponse(AdminCreatedStoreResponse, { ...presentStore(created), next: receiptReturnPath(body.next) });
  }

  updateStore(storeId: number, body: z.infer<typeof StoreRequest>): AdminStoreResponse {
    this.locations.updateStore(
      storeId,
      body.name,
      body.street_name,
      body.building_number,
      body.apartment_number,
      body.postal_code,
      body.city,
      body.external_id,
      body.retail_chain_id,
      body.lat,
      body.lng,
    );
    return asResponse(AdminStoreResponse, presentStore(this.locations.getStore(storeId)));
  }

  removeStore(storeId: number): AdminOkResponse {
    const store = this.locations.getStore(storeId);
    if (store.purchaseCount > 0) problem(409, `Cannot delete “${store.name}” while a purchase still uses it.`);
    this.locations.deleteStore(storeId);
    return asResponse(AdminOkResponse, { ok: true });
  }

  mergeOptions(storeId: number): AdminStoreMergeOptionsResponse {
    const store = this.locations.getStore(storeId);
    return asResponse(AdminStoreMergeOptionsResponse, {
      store: presentStore(store),
      targets: this.locations.listStores().filter((s) => s.id !== store.id).map(presentStore),
    });
  }

  mergePlan(storeId: number, intoId: number): AdminStoreMergePlanResponse {
    const plan = this.locations.mergePlan(intoId, storeId);
    return asResponse(AdminStoreMergePlanResponse, {
      plan: { ...plan, into: presentStore(plan.into), from: presentStore(plan.from) },
    });
  }

  merge(storeId: number, body: z.infer<typeof StoreMergeRequest>): AdminStoreMergedResponse {
    this.locations.mergeStores(body.into_id, storeId);
    return asResponse(AdminStoreMergedResponse, { id: body.into_id });
  }
}

function emptyStore(): Store {
  return {
    id: 0,
    name: '',
    streetName: '',
    buildingNumber: '',
    apartmentNumber: '',
    postalCode: '',
    city: '',
    externalId: '',
    lat: null,
    lng: null,
    retailChainId: null,
    retailChainName: '',
    purchaseCount: 0,
  };
}

function receiptReturnPath(s: string): string {
  s = s.trim();
  if (s === '') return '';
  try {
    const url = new URL(s, 'http://local');
    if (url.host !== 'local' || url.search || url.hash) return '';
    const path = url.pathname;
    if (!path.startsWith('/admin/receipts/')) return '';
    const receiptId = path.slice('/admin/receipts/'.length);
    if (receiptId === '' || /[/.]/.test(receiptId) || !/^\d+$/.test(receiptId)) return '';
    return '/admin/receipts/' + receiptId;
  } catch {
    return '';
  }
}
