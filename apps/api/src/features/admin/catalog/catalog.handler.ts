import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import { fromDatetimeLocal, nowBoughtOn } from '../../../domain/bought-on.js';
import { parseDecimal } from '../../../domain/format.js';
import { ComparisonGroupsRepository } from '#app/store/comparison-groups';
import { LocationsRepository } from '#app/store/locations';
import { ProductsRepository, type Product, type ProductConversion } from '#app/store/products';
import { KIND_PURCHASE, PurchasesRepository, type Purchase } from '#app/store/purchases';
import { UnitsRepository } from '#app/store/units';
import { ImagesService } from '../../../web/images.service.js';
import { presentProduct, presentPurchase, presentStore, storesByID } from '../../../web/present.js';
import { asResponse, problem } from '../http.js';
import { type MergeRequest, type ProductRequest, type PurchaseRequest, type UnitIdRequest } from './contract/request.js';
import {
  AdminCatalogBlankResponse,
  AdminCatalogChangeUnitResponse,
  AdminCatalogIdResponse,
  AdminCatalogMergeOptionsResponse,
  AdminCatalogMergePlanResponse,
  AdminCatalogOkResponse,
  AdminCatalogPurchaseDeletedResponse,
  AdminCatalogPurchaseFormResponse,
  AdminCatalogPurchaseResponse,
  AdminCatalogPurchaseUpdatedResponse,
  AdminCatalogShowResponse,
} from './contract/response.js';

@Injectable()
export class AdminCatalogHandler {
  constructor(
    private readonly products: ProductsRepository,
    private readonly units: UnitsRepository,
    private readonly groups: ComparisonGroupsRepository,
    private readonly purchases: PurchasesRepository,
    private readonly locations: LocationsRepository,
    private readonly images: ImagesService,
    private readonly config: ConfigService,
  ) {}

  blank(): AdminCatalogBlankResponse {
    return asResponse(AdminCatalogBlankResponse, {
      product: presentProduct(emptyProduct()),
      units: this.units.listUnits(),
      groups: this.groupOptions([]),
    });
  }

  show(productId: number): AdminCatalogShowResponse {
    const product = this.products.getProduct(productId);
    return asResponse(AdminCatalogShowResponse, {
      product: presentProduct(product),
      purchases: this.purchases.listPurchases(productId).map(presentPurchase),
      storeById: storesByID(this.locations.listStores()),
      groups: this.groups.listComparisonGroupsForProduct(productId),
      symbol: this.symbol(),
    });
  }

  edit(productId: number): AdminCatalogBlankResponse {
    const product = this.products.getProduct(productId);
    const selected = this.groups.listComparisonGroupsForProduct(productId).map((group) => group.id);
    return asResponse(AdminCatalogBlankResponse, {
      product: presentProduct(product),
      units: this.units.listUnits(),
      groups: this.groupOptions(selected),
    });
  }

  create(body: z.infer<typeof ProductRequest>, file?: Express.Multer.File): Promise<AdminCatalogIdResponse> {
    return this.save(body, 0, file);
  }

  update(productId: number, body: z.infer<typeof ProductRequest>, file?: Express.Multer.File): Promise<AdminCatalogIdResponse> {
    return this.save(body, productId, file);
  }

  remove(productId: number): AdminCatalogOkResponse {
    const image = this.products.deleteProduct(productId);
    this.images.deleteImage(image);
    return asResponse(AdminCatalogOkResponse, { ok: true });
  }

  changeUnitForm(productId: number): AdminCatalogChangeUnitResponse {
    const product = this.products.getProduct(productId);
    return asResponse(AdminCatalogChangeUnitResponse, {
      product: presentProduct(product),
      history: this.purchases.listPurchases(productId).length,
    });
  }

  changeUnit(productId: number, body: z.infer<typeof UnitIdRequest>): AdminCatalogIdResponse {
    const product = this.products.getProduct(productId);
    if (!product.conversions.some((conversion) => conversion.unitId === body.unit_id)) {
      problem(422, 'Choose one of the extra units on this product.');
    }
    this.products.changePurchaseUnit(productId, body.unit_id);
    return asResponse(AdminCatalogIdResponse, { id: productId });
  }

  mergeOptions(productId: number): AdminCatalogMergeOptionsResponse {
    const product = this.products.getProduct(productId);
    return asResponse(AdminCatalogMergeOptionsResponse, {
      product: presentProduct(product),
      targets: this.products.listProducts('').filter((item) => item.id !== product.id),
    });
  }

  mergePlan(productId: number, intoId: number): AdminCatalogMergePlanResponse {
    const plan = this.products.mergePlan(intoId, productId);
    return asResponse(AdminCatalogMergePlanResponse, {
      plan: { ...plan, into: presentProduct(plan.into), from: presentProduct(plan.from) },
    });
  }

  merge(productId: number, body: z.infer<typeof MergeRequest>): AdminCatalogIdResponse {
    const { keeper, dropImage } = this.products.mergeProducts(body.into_id, productId);
    this.images.deleteImage(dropImage);
    return asResponse(AdminCatalogIdResponse, { id: keeper.id });
  }

  newPurchase(productId: number): AdminCatalogPurchaseFormResponse {
    const product = this.products.getProduct(productId);
    const purchase: Purchase = {
      id: 0,
      productId: product.id,
      storeId: null,
      kind: KIND_PURCHASE,
      receiptId: null,
      boughtOn: nowBoughtOn(),
      quantity: new Decimal(0),
      amount: new Decimal(0),
      createdAt: '',
    };
    return this.purchasePayload(product, purchase);
  }

  createPurchase(productId: number, body: z.infer<typeof PurchaseRequest>): AdminCatalogPurchaseResponse {
    const parsed = this.parsePurchase(body);
    if (parsed.err) problem(422, parsed.err);
    const product = this.products.getProduct(productId);
    const kind = this.purchases.parsePurchaseKind(body.kind);
    const storeId = this.resolveStore(body.store_id);
    return asResponse(
      AdminCatalogPurchaseResponse,
      this.purchases.createPurchase(product.id, storeId, parsed.boughtOn, parsed.qty, parsed.amount, kind),
    );
  }

  purchase(purchaseId: number): AdminCatalogPurchaseFormResponse {
    const purchase = this.purchases.getPurchase(purchaseId);
    const product = this.products.getProduct(purchase.productId);
    return this.purchasePayload(product, purchase);
  }

  updatePurchase(purchaseId: number, body: z.infer<typeof PurchaseRequest>): AdminCatalogPurchaseUpdatedResponse {
    const parsed = this.parsePurchase(body);
    if (parsed.err) problem(422, parsed.err);
    const current = this.purchases.getPurchase(purchaseId);
    const kind = this.purchases.parsePurchaseKind(body.kind);
    const storeId = this.resolveStore(body.store_id);
    this.purchases.updatePurchase(purchaseId, storeId, parsed.boughtOn, parsed.qty, parsed.amount, kind);
    return asResponse(AdminCatalogPurchaseUpdatedResponse, { id: purchaseId, productId: current.productId });
  }

  removePurchase(purchaseId: number): AdminCatalogPurchaseDeletedResponse {
    const purchase = this.purchases.getPurchase(purchaseId);
    this.purchases.deletePurchase(purchaseId);
    return asResponse(AdminCatalogPurchaseDeletedResponse, { productId: purchase.productId, kind: purchase.kind });
  }

  private purchasePayload(product: Product, purchase: Purchase): AdminCatalogPurchaseFormResponse {
    return asResponse(AdminCatalogPurchaseFormResponse, {
      product: presentProduct(product),
      purchase: presentPurchase(purchase),
      stores: this.locations.listStores().map(presentStore),
      symbol: this.symbol(),
      currency: this.config.get<string>('CURRENCY') || 'PLN',
    });
  }

  private symbol(): string {
    return this.config.get<string>('CURRENCY_SYMBOL') || 'zł';
  }

  private async save(body: z.infer<typeof ProductRequest>, productId: number, file?: Express.Multer.File): Promise<AdminCatalogIdResponse> {
    const { convs, msg } = parseExtraUnits(body, body.unit_id);
    if (msg) problem(422, msg);
    let imageName = '';
    try {
      imageName = await this.images.saveImage(file);
    } catch (err) {
      problem(422, (err instanceof Error ? err.message : 'could not save image') + '.');
    }
    const clearImage = body.clear_image === '1';
    try {
      if (productId === 0) {
        const created = this.products.createProduct(body.name, body.unit_id, imageName || null, convs, body.ean);
        this.groups.setProductComparisonGroups(created.id, body.group_id);
        return asResponse(AdminCatalogIdResponse, { id: created.id });
      }
      const current = this.products.getProduct(productId);
      this.products.updateProduct(
        productId,
        body.name,
        current.unitId,
        imageName || null,
        clearImage && imageName === '',
        convs,
        body.ean,
      );
      this.groups.setProductComparisonGroups(productId, body.group_id);
      if (imageName && current.imagePath) this.images.deleteImage(current.imagePath);
      if (clearImage && imageName === '' && current.imagePath) this.images.deleteImage(current.imagePath);
      return asResponse(AdminCatalogIdResponse, { id: productId });
    } catch (err) {
      if (imageName) this.images.deleteImage(imageName);
      throw err;
    }
  }

  private groupOptions(selected: number[]) {
    const set = new Set(selected);
    return this.groups.listComparisonGroups().map((group) => ({ ...group, selected: set.has(group.id) }));
  }

  private resolveStore(storeId: number): number {
    if (storeId <= 0) return 0;
    this.locations.getStore(storeId);
    return storeId;
  }

  private parsePurchase(body: z.infer<typeof PurchaseRequest>): { boughtOn: string; qty: Decimal; amount: Decimal; err: string } {
    const when = fromDatetimeLocal(body.bought_on);
    if (when === '') return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Date must be a valid day.' };
    try {
      return {
        boughtOn: when,
        qty: parseDecimal(body.quantity, 8, false),
        amount: parseDecimal(body.amount, 2, true),
        err: '',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (body.amount !== '') {
        try {
          parseDecimal(body.amount, 2, true);
        } catch (amountErr) {
          return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Amount ' + (amountErr as Error).message + '.' };
        }
      }
      return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Quantity ' + message + '.' };
    }
  }
}

function emptyProduct(): Product {
  return {
    id: 0,
    name: '',
    ean: '',
    unitId: 0,
    unitName: '',
    compareValue: new Decimal(1),
    imagePath: null,
    createdAt: '',
    conversions: [],
  };
}

function parseExtraUnits(
  body: z.infer<typeof ProductRequest>,
  purchaseUnitId: number,
): { convs: ProductConversion[]; msg: string } {
  const ids = body.extra_unit_id;
  const factors = body.extra_factor;
  const n = Math.max(ids.length, factors.length);
  const out: ProductConversion[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const idStr = ids[i] ?? '';
    const factorStr = factors[i] ?? '';
    if (idStr === '' && factorStr === '') continue;
    if (idStr === '') return { convs: out, msg: 'Choose a unit for each extra unit.' };
    const extraUnitId = Number.parseInt(idStr, 10) || 0;
    if (extraUnitId === purchaseUnitId) return { convs: out, msg: 'An extra unit cannot be the same as the purchase unit.' };
    if (seen.has(extraUnitId)) return { convs: out, msg: 'Each extra unit can only be listed once.' };
    seen.add(extraUnitId);
    try {
      out.push({ unitId: extraUnitId, unitName: '', compareValue: new Decimal(1), factor: parseDecimal(factorStr, 8, false) });
    } catch (err) {
      return { convs: out, msg: 'Extra unit factor ' + (err as Error).message + '.' };
    }
  }
  return { convs: out, msg: '' };
}
