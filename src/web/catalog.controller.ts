import { Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Decimal } from 'decimal.js';
import {
  AliasScopeError,
  ConversionConflictError,
  DuplicateError,
  InvalidConversionError,
  InvalidKindError,
  InvalidQuantityError,
  InvalidRetailChainError,
  InvalidStoreError,
  InvalidUnitError,
  NotFoundError,
  RetailChainInUseError,
  SameProductError,
  StoreInUseError,
  UnitInUseError,
  UnitMismatchError,
} from '../domain/errors.js';
import { parseDecimal } from '../domain/format.js';
import { fromDatetimeLocal, nowBoughtOn } from '../domain/bought-on.js';
import { AliasesRepository, type ProductAlias } from '#app/store/aliases';
import { ComparisonGroupsRepository } from '#app/store/comparison-groups';
import { LocationsRepository, type RetailChain, type Store } from '#app/store/locations';
import { ProductsRepository, type Product, type ProductConversion } from '#app/store/products';
import { KIND_PURCHASE, PurchasesRepository, type Purchase } from '#app/store/purchases';
import { UnitsRepository } from '#app/store/units';
import { ImagesService } from './images.service.js';
import {
  presentAlias,
  presentChain,
  presentListItem,
  presentProduct,
  presentPurchase,
  presentStore,
  storesByID,
} from './present.js';
import { ViewsService } from './views.service.js';
import {
  adminIndexQuery,
  aliasFields,
  aliasForm,
  comparisonGroupFields,
  comparisonGroupForm,
  flashQuery,
  formIssue,
  id,
  mergeForm,
  mergeParams,
  mergeQuery,
  nameFields,
  nameForm,
  newStoreQuery,
  productFields,
  productForm,
  productRefQuery,
  purchaseForm,
  retailChainFields,
  retailChainForm,
  settingsForm,
  storeFields,
  storeForm,
  unitIdForm,
  type AliasFields,
  type AliasForm,
  type NewStoreQuery,
  type ProductFields,
  type PurchaseForm,
  type StoreFields,
} from './schema.js';

@Controller()
export class CatalogController {
  constructor(
    private readonly unitsStore: UnitsRepository,
    private readonly locations: LocationsRepository,
    private readonly products: ProductsRepository,
    private readonly aliasesStore: AliasesRepository,
    private readonly purchases: PurchasesRepository,
    private readonly groups: ComparisonGroupsRepository,
    private readonly views: ViewsService,
    private readonly images: ImagesService,
  ) {}

  @Get('/admin')
  index(@Query({ schema: adminIndexQuery }) query: { q: string; error: string; imported: number }, @Res() res: Response): void {
    const q = query.q;
    try {
      const items = this.products.listProducts(q);
      this.views.html(res, 'index', 200, {
        page: this.views.adminPage('Products', q, query.error),
        products: items.map(presentListItem),
        imported: query.imported,
      });
    } catch {
      this.views.text(res, 500, 'could not load products');
    }
  }

  @Get('/admin/settings')
  admin(@Res() res: Response): void {
    this.renderAdmin(res, 200, '');
  }

  @Post('/admin/settings')
  updateAdmin(@Body() raw: unknown, @Res() res: Response): void {
    const parsed = settingsForm.safeParse(raw);
    if (!parsed.success) {
      this.renderAdmin(res, 422, formIssue(parsed.error));
      return;
    }
    const body = parsed.data;
    try {
      this.unitsStore.setUnitDefaults({
        pieceId: body.piece_unit_id,
        weightId: body.weight_unit_id,
      });
      this.unitsStore.setSetting('ocr_model', body.ocr_model);
    } catch (err) {
      if (err instanceof InvalidUnitError) {
        this.renderAdmin(res, 422, 'Choose a unit from the list.');
        return;
      }
      this.renderAdmin(res, 500, 'Could not save settings.');
      return;
    }
    this.views.redirect(res, '/admin/settings');
  }

  private renderAdmin(res: Response, status: number, errMsg: string): void {
    try {
      this.views.html(res, 'admin', status, {
        page: this.views.adminPage('Settings', '', errMsg),
        ocrModel: this.unitsStore.ocrModel(),
        units: this.unitsStore.listUnits(),
        defaults: this.unitsStore.unitDefaults(),
      });
    } catch {
      this.views.text(res, 500, 'could not load settings');
    }
  }

  // --- units ---

  @Get('/admin/units')
  units(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    try {
      this.views.html(res, 'units', 200, {
        page: this.views.adminPage('Units', '', query.error),
        units: this.unitsStore.listUnits(),
      });
    } catch {
      this.views.text(res, 500, 'could not load units');
    }
  }

  @Post('/admin/units')
  createUnit(@Body() raw: unknown, @Res() res: Response): void {
    const parsed = nameForm.safeParse(raw);
    if (!parsed.success) {
      this.views.redirect(res, '/admin/units?error=' + encodeURIComponent(formIssue(parsed.error)));
      return;
    }
    try {
      this.unitsStore.createUnit(parsed.data.name);
      this.views.redirect(res, '/admin/units');
    } catch (err) {
      if (err instanceof DuplicateError) {
        this.views.redirect(res, '/admin/units?error=' + encodeURIComponent('That unit already exists.'));
        return;
      }
      this.views.redirect(res, '/admin/units?error=' + encodeURIComponent('Could not save the unit.'));
    }
  }

  @Get('/admin/units/:id/edit')
  editUnit(@Param('id', { schema: id }) unitId: number, @Res() res: Response): void {
    try {
      const u = this.unitsStore.getUnit(unitId);
      this.views.html(res, 'unit_form', 200, { page: this.views.adminPage('Rename unit', '', ''), unit: u });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load unit');
    }
  }

  @Post('/admin/units/:id')
  updateUnit(@Param('id', { schema: id }) unitId: number, @Body() raw: unknown, @Res() res: Response): void {
    const parsed = nameForm.safeParse(raw);
    const name = nameFields.parse(raw).name;
    if (!parsed.success) {
      this.views.html(res, 'unit_form', 422, {
        page: this.views.adminPage('Rename unit', '', formIssue(parsed.error)),
        unit: { id: unitId, name: name, productCount: 0 },
      });
      return;
    }
    try {
      this.unitsStore.updateUnit(unitId, parsed.data.name);
      this.views.redirect(res, '/admin/units');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      if (err instanceof DuplicateError) {
        this.views.html(res, 'unit_form', 422, {
          page: this.views.adminPage('Rename unit', '', 'That unit already exists.'),
          unit: { id: unitId, name: name, productCount: 0 },
        });
        return;
      }
      this.views.text(res, 500, 'could not save unit');
    }
  }

  @Get('/admin/units/:id/delete')
  confirmDeleteUnit(@Param('id', { schema: id }) unitId: number, @Res() res: Response): void {
    try {
      const u = this.unitsStore.getUnit(unitId);
      if (u.productCount > 0) {
        this.views.redirect(
          res,
          '/admin/units?error=' + encodeURIComponent(`Cannot delete “${u.name}” while a product still uses it.`),
        );
        return;
      }
      this.views.html(res, 'confirm', 200, {
        page: this.views.adminPage('Delete unit', '', ''),
        title: `Delete unit “${u.name}”?`,
        body: 'This only removes the unit from the list. No products use it.',
        action: `/admin/units/${unitId}/delete`,
        cancel: '/admin/units',
        confirm: 'Delete unit',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load unit');
    }
  }

  @Post('/admin/units/:id/delete')
  deleteUnit(@Param('id', { schema: id }) unitId: number, @Res() res: Response): void {
    try {
      this.unitsStore.deleteUnit(unitId);
      this.views.redirect(res, '/admin/units');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      if (err instanceof UnitInUseError) {
        this.views.redirect(res, '/admin/units?error=' + encodeURIComponent('Cannot delete a unit while a product still uses it.'));
        return;
      }
      this.views.text(res, 500, 'could not delete unit');
    }
  }

  // --- retail chains ---

  @Get('/admin/retail-chains')
  retailChains(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    try {
      this.views.html(res, 'retail_chains', 200, {
        page: this.views.adminPage('Retail chains', '', query.error),
        retailChains: this.locations.listRetailChains().map(presentChain),
      });
    } catch {
      this.views.text(res, 500, 'could not load retail chains');
    }
  }

  @Get('/admin/retail-chains/new')
  newRetailChain(@Res() res: Response): void {
    this.renderRetailChainForm(res, 200, { id: 0, name: '', legalName: '', taxId: '', storeCount: 0 }, true, '');
  }

  @Post('/admin/retail-chains')
  createRetailChain(@Body() raw: unknown, @Res() res: Response): void {
    const fields = retailChainFields.parse(raw);
    const form = { id: 0, name: fields.name, legalName: fields.legal_name, taxId: fields.tax_id, storeCount: 0 };
    const parsed = retailChainForm.safeParse(raw);
    if (!parsed.success) {
      this.renderRetailChainForm(res, 422, form, true, formIssue(parsed.error));
      return;
    }
    try {
      this.locations.createRetailChain(parsed.data.name, parsed.data.legal_name, parsed.data.tax_id);
      this.views.redirect(res, '/admin/retail-chains');
    } catch (err) {
      const msg = retailChainFormError(err) || 'Could not save the retail chain.';
      this.renderRetailChainForm(res, 422, form, true, msg);
    }
  }

  @Get('/admin/retail-chains/:id/edit')
  editRetailChain(@Param('id', { schema: id }) chainId: number, @Res() res: Response): void {
    try {
      this.renderRetailChainForm(res, 200, this.locations.getRetailChain(chainId), false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load retail chain');
    }
  }

  @Post('/admin/retail-chains/:id')
  updateRetailChain(@Param('id', { schema: id }) chainId: number, @Body() raw: unknown, @Res() res: Response): void {
    const fields = retailChainFields.parse(raw);
    const parsed = retailChainForm.safeParse(raw);
    if (!parsed.success) {
      this.renderRetailChainForm(
        res,
        422,
        { id: chainId, name: fields.name, legalName: fields.legal_name, taxId: fields.tax_id, storeCount: 0 },
        false,
        formIssue(parsed.error),
      );
      return;
    }
    try {
      this.locations.updateRetailChain(chainId, parsed.data.name, parsed.data.legal_name, parsed.data.tax_id);
      this.views.redirect(res, '/admin/retail-chains');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = retailChainFormError(err) || 'Could not save the retail chain.';
      this.renderRetailChainForm(res, 422, { id: chainId, name: fields.name, legalName: fields.legal_name, taxId: fields.tax_id, storeCount: 0 }, false, msg);
    }
  }

  @Get('/admin/retail-chains/:id/delete')
  confirmDeleteRetailChain(@Param('id', { schema: id }) chainId: number, @Res() res: Response): void {
    try {
      const c = this.locations.getRetailChain(chainId);
      if (c.storeCount > 0) {
        this.views.redirect(
          res,
          '/admin/retail-chains?error=' + encodeURIComponent(`Cannot delete “${c.name}” while a store still uses it.`),
        );
        return;
      }
      this.views.html(res, 'confirm', 200, {
        page: this.views.adminPage('Delete retail chain', '', ''),
        title: `Delete retail chain “${c.name}”?`,
        body: 'This only removes the chain from the list. No stores use it.',
        action: `/admin/retail-chains/${chainId}/delete`,
        cancel: '/admin/retail-chains',
        confirm: 'Delete chain',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load retail chain');
    }
  }

  @Post('/admin/retail-chains/:id/delete')
  deleteRetailChain(@Param('id', { schema: id }) chainId: number, @Res() res: Response): void {
    try {
      this.locations.deleteRetailChain(chainId);
      this.views.redirect(res, '/admin/retail-chains');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      if (err instanceof RetailChainInUseError) {
        this.views.redirect(
          res,
          '/admin/retail-chains?error=' + encodeURIComponent('Cannot delete a retail chain while a store still uses it.'),
        );
        return;
      }
      this.views.text(res, 500, 'could not delete retail chain');
    }
  }

  private renderRetailChainForm(
    res: Response,
    status: number,
    chain: RetailChain,
    isNew: boolean,
    errMsg: string,
  ): void {
    this.views.html(res, 'retail_chain_form', status, {
      page: this.views.adminPage(isNew ? 'Add retail chain' : 'Edit retail chain', '', errMsg),
      retailChain: presentChain(chain),
      new: isNew,
    });
  }

  // --- stores ---

  @Get('/admin/stores')
  stores(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    try {
      this.views.html(res, 'stores', 200, {
        page: this.views.adminPage('Stores', '', query.error),
        stores: this.locations.listStores().map(presentStore),
      });
    } catch {
      this.views.text(res, 500, 'could not load stores');
    }
  }

  @Get('/admin/stores/new')
  newStore(@Query({ schema: newStoreQuery }) query: NewStoreQuery, @Res() res: Response): void {
    const next = receiptReturnPath(query.next);
    const form = emptyStore();
    form.name = query.name;
    form.streetName = query.street_name;
    form.buildingNumber = query.building_number;
    form.apartmentNumber = query.apartment_number;
    form.postalCode = query.postal_code;
    form.city = query.city;
    form.externalId = query.external_id;
    this.renderStoreForm(res, 200, form, true, '', next);
  }

  @Post('/admin/stores')
  createStore(@Body() raw: unknown, @Res() res: Response): void {
    const fields = storeFields.parse(raw);
    const next = receiptReturnPath(fields.next);
    const parsed = storeForm.safeParse(raw);
    if (!parsed.success) {
      const form = { ...emptyStore(), ...storeFromFields(fields), retailChainId: fields.retail_chain_id };
      this.renderStoreForm(res, 422, form, true, formIssue(parsed.error), next);
      return;
    }
    try {
      this.locations.createStore(
        parsed.data.name,
        parsed.data.street_name,
        parsed.data.building_number,
        parsed.data.apartment_number,
        parsed.data.postal_code,
        parsed.data.city,
        parsed.data.external_id,
        parsed.data.retail_chain_id,
        parsed.data.lat,
        parsed.data.lng,
      );
      this.views.redirect(res, next || '/admin/stores');
    } catch (err) {
      const form = { ...emptyStore(), ...storeFromFields(fields), retailChainId: fields.retail_chain_id };
      const msg = storeFormError(err) || 'Could not save the store.';
      this.renderStoreForm(res, 422, form, true, msg, next);
    }
  }

  @Get('/admin/stores/:id/edit')
  editStore(@Param('id', { schema: id }) storeId: number, @Res() res: Response): void {
    try {
      this.renderStoreForm(res, 200, this.locations.getStore(storeId), false, '', '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load store');
    }
  }

  @Post('/admin/stores/:id')
  updateStore(@Param('id', { schema: id }) storeId: number, @Body() raw: unknown, @Res() res: Response): void {
    const fields = storeFields.parse(raw);
    const parsed = storeForm.safeParse(raw);
    if (!parsed.success) {
      const form = { ...storeFromFields(fields), id: storeId, retailChainId: fields.retail_chain_id };
      this.renderStoreForm(res, 422, form, false, formIssue(parsed.error), '');
      return;
    }
    try {
      this.locations.updateStore(
        storeId,
        parsed.data.name,
        parsed.data.street_name,
        parsed.data.building_number,
        parsed.data.apartment_number,
        parsed.data.postal_code,
        parsed.data.city,
        parsed.data.external_id,
        parsed.data.retail_chain_id,
        parsed.data.lat,
        parsed.data.lng,
      );
      this.views.redirect(res, '/admin/stores');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const form = { ...storeFromFields(fields), id: storeId, retailChainId: fields.retail_chain_id };
      const msg = storeFormError(err) || 'Could not save the store.';
      this.renderStoreForm(res, 422, form, false, msg, '');
    }
  }

  @Get('/admin/stores/:id/delete')
  confirmDeleteStore(@Param('id', { schema: id }) storeId: number, @Res() res: Response): void {
    try {
      const co = this.locations.getStore(storeId);
      if (co.purchaseCount > 0) {
        this.views.redirect(
          res,
          '/admin/stores?error=' + encodeURIComponent(`Cannot delete “${co.name}” while a purchase still uses it.`),
        );
        return;
      }
      this.views.html(res, 'confirm', 200, {
        page: this.views.adminPage('Delete store', '', ''),
        title: `Delete store “${co.name}”?`,
        body: 'This only removes the store from the list. No purchases use it.',
        action: `/admin/stores/${storeId}/delete`,
        cancel: '/admin/stores',
        confirm: 'Delete store',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load store');
    }
  }

  @Post('/admin/stores/:id/delete')
  deleteStore(@Param('id', { schema: id }) storeId: number, @Res() res: Response): void {
    try {
      this.locations.deleteStore(storeId);
      this.views.redirect(res, '/admin/stores');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      if (err instanceof StoreInUseError) {
        this.views.redirect(res, '/admin/stores?error=' + encodeURIComponent('Cannot delete a store while a purchase still uses it.'));
        return;
      }
      this.views.text(res, 500, 'could not delete store');
    }
  }

  private renderStoreForm(res: Response, status: number, co: Store, isNew: boolean, errMsg: string, next: string): void {
    try {
      this.views.html(res, 'store_form', status, {
        page: this.views.adminPage(isNew ? 'Add store' : 'Edit store', '', errMsg),
        store: presentStore(co),
        retailChains: this.locations.listRetailChains().map(presentChain),
        new: isNew,
        next: next,
      });
    } catch {
      this.views.text(res, 500, 'could not load retail chains');
    }
  }

  // --- aliases ---

  @Get('/admin/aliases')
  aliases(@Query({ schema: productRefQuery }) query: { product: number; error: string }, @Res() res: Response): void {
    const productID = query.product;
    try {
      let filter: Product | null = null;
      if (productID > 0) filter = this.products.getProduct(productID);
      const list = filter ? this.aliasesStore.listAliasesByProduct(filter.id) : this.aliasesStore.listAliases();
      this.views.html(res, 'aliases', 200, {
        page: this.views.adminPage('Aliases', '', query.error),
        aliases: list.map(presentAlias),
        filter: filter,
        productQuery: aliasesQuerySuffix(filter?.id ?? 0),
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load aliases');
    }
  }

  @Get('/admin/aliases/new')
  newAlias(@Query({ schema: productRefQuery }) query: { product: number; error: string }, @Res() res: Response): void {
    const from = query.product;
    try {
      const lookups = this.aliasLookups();
      let locked: Product | null = null;
      const form = emptyAlias();
      if (from > 0) {
        locked = this.products.getProduct(from);
        form.productId = locked.id;
      }
      this.renderAliasForm(res, 200, form, lookups, from, locked, true, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load the catalog');
    }
  }

  @Post('/admin/aliases')
  createAlias(@Body() raw: unknown, @Res() res: Response): void {
    const fields = aliasFields.parse(raw);
    const from = fields.from_product;
    const parsed = aliasForm.safeParse(raw);
    if (!parsed.success) {
      try {
        const lookups = this.aliasLookups();
        let locked: Product | null = null;
        if (from > 0) {
          try {
            locked = this.products.getProduct(from);
          } catch {
            locked = null;
          }
        }
        this.renderAliasForm(res, 422, aliasFormFromPost(fields), lookups, from, locked, true, formIssue(parsed.error));
      } catch {
        this.views.text(res, 500, 'could not load the catalog');
      }
      return;
    }
    try {
      this.saveAliasFromForm(parsed.data, 0);
      this.views.redirect(res, aliasesPath(from));
    } catch (err) {
      try {
        const lookups = this.aliasLookups();
        let locked: Product | null = null;
        if (from > 0) {
          try {
            locked = this.products.getProduct(from);
          } catch {
            locked = null;
          }
        }
        this.renderAliasForm(res, 422, aliasFormFromPost(fields), lookups, from, locked, true, aliasFormError(err) || 'Could not save the alias.');
      } catch {
        this.views.text(res, 500, 'could not load the catalog');
      }
    }
  }

  @Get('/admin/aliases/:id/edit')
  editAlias(
    @Param('id', { schema: id }) aliasId: number,
    @Query({ schema: productRefQuery }) query: { product: number; error: string },
    @Res() res: Response,
  ): void {
    try {
      const a = this.aliasesStore.getAlias(aliasId);
      this.renderAliasForm(res, 200, a, this.aliasLookups(), query.product, null, false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load alias');
    }
  }

  @Post('/admin/aliases/:id')
  updateAlias(@Param('id', { schema: id }) aliasId: number, @Body() raw: unknown, @Res() res: Response): void {
    const fields = aliasFields.parse(raw);
    const from = fields.from_product;
    const parsed = aliasForm.safeParse(raw);
    if (!parsed.success) {
      const form = aliasFormFromPost(fields);
      form.id = aliasId;
      this.renderAliasForm(res, 422, form, this.aliasLookups(), from, null, false, formIssue(parsed.error));
      return;
    }
    try {
      this.aliasesStore.getAlias(aliasId);
      this.saveAliasFromForm(parsed.data, aliasId);
      this.views.redirect(res, aliasesPath(from));
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = aliasFormError(err);
      if (msg) {
        const form = aliasFormFromPost(fields);
        form.id = aliasId;
        this.renderAliasForm(res, 422, form, this.aliasLookups(), from, null, false, msg);
        return;
      }
      this.views.text(res, 500, 'could not save alias');
    }
  }

  @Get('/admin/aliases/:id/delete')
  confirmDeleteAlias(
    @Param('id', { schema: id }) aliasId: number,
    @Query({ schema: productRefQuery }) query: { product: number; error: string },
    @Res() res: Response,
  ): void {
    const from = query.product;
    try {
      const a = this.aliasesStore.getAlias(aliasId);
      let action = `/admin/aliases/${aliasId}/delete`;
      const q = aliasesQuerySuffix(from);
      if (q) action += q;
      this.views.html(res, 'confirm', 200, {
        page: this.views.adminPage(`Delete alias “${a.alias}”?`, '', ''),
        title: `Delete alias “${a.alias}”?`,
        body: 'This only removes the alternate name. The product stays.',
        action: action,
        cancel: aliasesPath(from),
        confirm: 'Delete alias',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load alias');
    }
  }

  @Post('/admin/aliases/:id/delete')
  deleteAlias(
    @Param('id', { schema: id }) aliasId: number,
    @Query({ schema: productRefQuery }) query: { product: number; error: string },
    @Res() res: Response,
  ): void {
    try {
      this.aliasesStore.deleteAlias(aliasId);
      this.views.redirect(res, aliasesPath(query.product));
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete alias');
    }
  }

  private aliasLookups() {
    return {
      products: this.products.listProducts(''),
      stores: this.locations.listStores(),
      chains: this.locations.listRetailChains(),
    };
  }

  private renderAliasForm(
    res: Response,
    status: number,
    a: ProductAlias,
    lookups: ReturnType<CatalogController['aliasLookups']>,
    from: number,
    locked: Product | null,
    isNew: boolean,
    errMsg: string,
  ): void {
    this.views.html(res, 'alias_form', status, {
      page: this.views.adminPage(isNew ? 'Add alias' : 'Edit alias', '', errMsg),
      alias: presentAlias(a),
      products: lookups.products,
      stores: lookups.stores.map(presentStore),
      chains: lookups.chains.map(presentChain),
      fromProduct: from,
      lockedProduct: locked,
      cancel: aliasesPath(from),
      new: isNew,
    });
  }

  private saveAliasFromForm(body: AliasForm, aliasId: number): void {
    const { storeID, chainID } = parseAliasScope(body.scope);
    if (aliasId === 0) this.aliasesStore.createAlias(body.product_id, storeID, chainID, body.alias);
    else this.aliasesStore.updateAlias(aliasId, body.product_id, storeID, chainID, body.alias);
  }

  // --- comparison groups ---

  @Get('/admin/comparison-groups')
  comparisonGroups(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    try {
      this.views.html(res, 'comparison_groups', 200, {
        page: this.views.adminPage('Comparison groups', '', query.error),
        groups: this.groups.listComparisonGroups(),
      });
    } catch {
      this.views.text(res, 500, 'could not load comparison groups');
    }
  }

  @Get('/admin/comparison-groups/new')
  newComparisonGroup(@Res() res: Response): void {
    this.renderComparisonGroupForm(res, 200, { id: 0, name: '', unitId: 0, unitName: '', createdAt: '', productCount: 0 }, [], true, '');
  }

  @Post('/admin/comparison-groups')
  createComparisonGroup(@Body() raw: unknown, @Res() res: Response): void {
    const fields = comparisonGroupFields.parse(raw);
    const parsed = comparisonGroupForm.safeParse(raw);
    if (!parsed.success) {
      this.renderComparisonGroupForm(
        res,
        422,
        { id: 0, name: fields.name, unitId: fields.unit_id, unitName: '', createdAt: '', productCount: 0 },
        fields.product_id,
        true,
        formIssue(parsed.error),
      );
      return;
    }
    try {
      this.groups.createComparisonGroup(parsed.data.name, parsed.data.unit_id, parsed.data.product_id);
      this.views.redirect(res, '/admin/comparison-groups');
    } catch (err) {
      const msg = comparisonGroupFormError(err) || 'Could not save the comparison group.';
      this.renderComparisonGroupForm(res, 422, { id: 0, name: fields.name, unitId: fields.unit_id, unitName: '', createdAt: '', productCount: 0 }, fields.product_id, true, msg);
    }
  }

  @Get('/admin/comparison-groups/:id/edit')
  editComparisonGroup(@Param('id', { schema: id }) groupId: number, @Res() res: Response): void {
    try {
      const g = this.groups.getComparisonGroup(groupId);
      const ids = this.groups.listComparisonGroupProductIDs(groupId);
      this.renderComparisonGroupForm(res, 200, g, ids, false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load comparison group');
    }
  }

  @Post('/admin/comparison-groups/:id')
  updateComparisonGroup(@Param('id', { schema: id }) groupId: number, @Body() raw: unknown, @Res() res: Response): void {
    const fields = comparisonGroupFields.parse(raw);
    const parsed = comparisonGroupForm.safeParse(raw);
    if (!parsed.success) {
      this.renderComparisonGroupForm(
        res,
        422,
        { id: groupId, name: fields.name, unitId: fields.unit_id, unitName: '', createdAt: '', productCount: 0 },
        fields.product_id,
        false,
        formIssue(parsed.error),
      );
      return;
    }
    try {
      this.groups.getComparisonGroup(groupId);
      this.groups.updateComparisonGroup(groupId, parsed.data.name, parsed.data.unit_id, parsed.data.product_id);
      this.views.redirect(res, '/admin/comparison-groups');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = comparisonGroupFormError(err);
      if (msg) {
        this.renderComparisonGroupForm(res, 422, { id: groupId, name: fields.name, unitId: fields.unit_id, unitName: '', createdAt: '', productCount: 0 }, fields.product_id, false, msg);
        return;
      }
      this.views.text(res, 500, 'could not save comparison group');
    }
  }

  @Get('/admin/comparison-groups/:id/delete')
  confirmDeleteComparisonGroup(@Param('id', { schema: id }) groupId: number, @Res() res: Response): void {
    try {
      const g = this.groups.getComparisonGroup(groupId);
      this.views.html(res, 'confirm', 200, {
        page: this.views.adminPage('Delete comparison group', '', ''),
        title: `Delete comparison group “${g.name}”?`,
        body: 'Products stay in the catalog. They just leave this group.',
        action: `/admin/comparison-groups/${groupId}/delete`,
        cancel: '/admin/comparison-groups',
        confirm: 'Delete group',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load comparison group');
    }
  }

  @Post('/admin/comparison-groups/:id/delete')
  deleteComparisonGroup(@Param('id', { schema: id }) groupId: number, @Res() res: Response): void {
    try {
      this.groups.deleteComparisonGroup(groupId);
      this.views.redirect(res, '/admin/comparison-groups');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete comparison group');
    }
  }

  private renderComparisonGroupForm(
    res: Response,
    status: number,
    g: { id: number; name: string; unitId: number; unitName: string; createdAt: string; productCount: number },
    selected: number[],
    isNew: boolean,
    errMsg: string,
  ): void {
    try {
      const selectedSet = new Set(selected);
      this.views.html(res, 'comparison_group_form', status, {
        page: this.views.adminPage(isNew ? 'Add comparison group' : 'Edit comparison group', '', errMsg),
        group: g,
        units: this.unitsStore.listUnits(),
        products: this.products.listProducts('').map((p) => ({ ...p, selected: selectedSet.has(p.id) })),
        new: isNew,
      });
    } catch {
      this.views.text(res, 500, 'could not load products');
    }
  }

  // --- products ---

  @Get('/admin/products/new')
  newProduct(@Res() res: Response): void {
    try {
      this.views.html(res, 'product_form', 200, {
        page: this.views.adminPage('Add product', '', ''),
        units: this.unitsStore.listUnits(),
        groups: this.comparisonGroupOptions([]),
        product: presentProduct(emptyProduct()),
        new: true,
      });
    } catch {
      this.views.text(res, 500, 'could not load units');
    }
  }

  @Get('/admin/products/:id')
  showProduct(
    @Param('id', { schema: id }) productId: number,
    @Query({ schema: flashQuery }) query: { error: string },
    @Res() res: Response,
  ): void {
    try {
      const p = this.products.getProduct(productId);
      const purchases = this.purchases.listPurchases(productId);
      const stores = this.locations.listStores();
      const groups = this.groups.listComparisonGroupsForProduct(productId);
      this.views.html(res, 'product_show', 200, {
        page: this.views.adminPage(p.name, '', query.error),
        product: presentProduct(p),
        purchases: purchases.map(presentPurchase),
        storeById: storesByID(stores),
        groups: groups,
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Get('/admin/products/:id/edit')
  editProduct(@Param('id', { schema: id }) productId: number, @Res() res: Response): void {
    try {
      const p = this.products.getProduct(productId);
      const selected = this.groups.listComparisonGroupsForProduct(productId).map((g) => g.id);
      this.views.html(res, 'product_form', 200, {
        page: this.views.adminPage('Edit ' + p.name, '', ''),
        units: this.unitsStore.listUnits(),
        groups: this.comparisonGroupOptions(selected),
        product: presentProduct(p),
        new: false,
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Post('/admin/products')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 6 << 20 } }))
  async createProduct(
    @Body() raw: unknown,
    @Res() res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<void> {
    await this.saveProduct(raw, res, 0, file);
  }

  @Post('/admin/products/:id')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 6 << 20 } }))
  async updateProduct(
    @Param('id', { schema: id }) productId: number,
    @Body() raw: unknown,
    @Res() res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<void> {
    await this.saveProduct(raw, res, productId, file);
  }

  private async saveProduct(raw: unknown, res: Response, productId: number, file?: Express.Multer.File): Promise<void> {
    const fields = productFields.parse(raw);
    const parsed = productForm.safeParse(raw);
    const name = fields.name;
    const unitID = fields.unit_id;
    const groupIDs = fields.group_id;
    const { convs, msg: convMsg } = parseExtraUnits(fields, unitID);
    const draft: Product = {
      ...emptyProduct(),
      id: productId,
      name: name,
      unitId: unitID,
      ean: fields.ean,
      conversions: convs,
    };
    try {
      const u = this.unitsStore.getUnit(unitID);
      draft.unitName = u.name;
    } catch {
      /* ignore */
    }
    const renderErr = (msg: string, p: Product) => {
      this.views.html(res, 'product_form', 422, {
        page: this.views.adminPage(productId === 0 ? 'Add product' : 'Edit product', '', msg),
        units: this.unitsStore.listUnits(),
        groups: this.comparisonGroupOptions(groupIDs),
        product: presentProduct(p),
        new: productId === 0,
      });
    };
    if (!parsed.success) {
      renderErr(formIssue(parsed.error), draft);
      return;
    }
    if (convMsg) {
      renderErr(convMsg, draft);
      return;
    }
    let imgName = '';
    try {
      imgName = await this.images.saveImage(file);
    } catch (err) {
      renderErr((err instanceof Error ? err.message : 'could not save image') + '.', draft);
      return;
    }
    const clearImage = fields.clear_image === '1';
    try {
      if (productId === 0) {
        const p = this.products.createProduct(parsed.data.name, parsed.data.unit_id, imgName || null, convs, parsed.data.ean);
        this.groups.setProductComparisonGroups(p.id, groupIDs);
        this.views.redirect(res, '/admin/products/' + p.id);
        return;
      }
      const cur = this.products.getProduct(productId);
      this.products.updateProduct(
        productId,
        parsed.data.name,
        cur.unitId,
        imgName || null,
        clearImage && imgName === '',
        convs,
        parsed.data.ean,
      );
      this.groups.setProductComparisonGroups(productId, groupIDs);
      if (imgName && cur.imagePath) this.images.deleteImage(cur.imagePath);
      if (clearImage && imgName === '' && cur.imagePath) this.images.deleteImage(cur.imagePath);
      this.views.redirect(res, '/admin/products/' + productId);
    } catch (err) {
      if (imgName) this.images.deleteImage(imgName);
      if (err instanceof NotFoundError) {
        this.views.text(res, 404, 'not found');
        return;
      }
      if (err instanceof DuplicateError) {
        renderErr('That name is already used as an alias.', draft);
        return;
      }
      if (err instanceof InvalidConversionError) {
        renderErr(
          'Check the extra units: each must be different from the purchase unit, unique, and have a factor greater than zero.',
          draft,
        );
        return;
      }
      renderErr('Could not save the product.', draft);
    }
  }

  @Get('/admin/products/:id/change-unit')
  changeProductUnitForm(@Param('id', { schema: id }) productId: number, @Res() res: Response): void {
    try {
      this.renderChangeUnit(res, 200, this.products.getProduct(productId), 0, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Post('/admin/products/:id/change-unit')
  changeProductUnit(@Param('id', { schema: id }) productId: number, @Body() raw: unknown, @Res() res: Response): void {
    const parsed = unitIdForm.safeParse(raw);
    try {
      const p = this.products.getProduct(productId);
      if (!parsed.success) {
        this.renderChangeUnit(res, 422, p, 0, formIssue(parsed.error));
        return;
      }
      const unitID = parsed.data.unit_id;
      if (!p.conversions.some((c) => c.unitId === unitID)) {
        this.renderChangeUnit(res, 422, p, unitID, 'Choose one of the extra units on this product.');
        return;
      }
      this.products.changePurchaseUnit(productId, unitID);
      this.views.redirect(res, '/admin/products/' + productId);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      let msg = 'Could not change the unit.';
      if (err instanceof InvalidUnitError) msg = 'Choose a different unit from the current purchase unit.';
      if (err instanceof InvalidConversionError) msg = 'Choose one of the extra units on this product.';
      try {
        this.renderChangeUnit(res, 422, this.products.getProduct(productId), parsed.success ? parsed.data.unit_id : 0, msg);
      } catch {
        this.views.text(res, 500, 'could not load product');
      }
    }
  }

  private renderChangeUnit(res: Response, status: number, p: Product, newUnitID: number, errMsg: string): void {
    try {
      const buys = this.purchases.listPurchases(p.id);
      this.views.html(res, 'product_change_unit', status, {
        page: this.views.adminPage('Change unit for ' + p.name, '', errMsg),
        product: presentProduct(p),
        newUnitId: newUnitID,
        history: buys.length,
      });
    } catch {
      this.views.text(res, 500, 'could not load purchases');
    }
  }

  @Get('/admin/products/:id/merge-with')
  mergeProductForm(
    @Param('id', { schema: id }) productId: number,
    @Query({ schema: mergeQuery }) query: { into_id: number },
    @Res() res: Response,
  ): void {
    try {
      this.renderMergeForm(res, 200, this.products.getProduct(productId), query.into_id, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Post('/admin/products/:id/merge-with')
  mergeProductRedirect(@Param('id', { schema: id }) productId: number, @Body() raw: unknown, @Res() res: Response): void {
    const parsed = mergeForm.safeParse(raw);
    if (!parsed.success) {
      try {
        this.renderMergeForm(res, 422, this.products.getProduct(productId), 0, formIssue(parsed.error));
      } catch (err) {
        if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
        this.views.text(res, 500, 'could not load product');
      }
      return;
    }
    this.views.redirect(res, `/admin/products/${productId}/merge-with/${parsed.data.into_id}/`);
  }

  @Get(['/admin/products/:id/merge-with/:into', '/admin/products/:id/merge-with/:into/'])
  mergeProductConfirm(
    @Param({ schema: mergeParams }) params: { id: number; into: number },
    @Res() res: Response,
  ): void {
    const productId = params.id;
    const intoID = params.into;
    try {
      const p = this.products.getProduct(productId);
      if (!intoID) {
        this.renderMergeForm(res, 422, p, 0, 'Choose a product.');
        return;
      }
      const plan = this.products.mergePlan(intoID, productId);
      this.views.html(res, 'product_merge_confirm', 200, {
        page: this.views.adminPage('Merge ' + plan.from.name, '', ''),
        plan: { ...plan, into: presentProduct(plan.into), from: presentProduct(plan.from) },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        try {
          this.renderMergeForm(res, 422, this.products.getProduct(productId), intoID, mergeFormError(err));
        } catch {
          this.views.text(res, 404, 'not found');
        }
        return;
      }
      const msg = mergeFormError(err);
      if (msg) {
        try {
          this.renderMergeForm(res, 422, this.products.getProduct(productId), intoID, msg);
          return;
        } catch {
          /* fallthrough */
        }
      }
      this.views.text(res, 500, 'could not load merge');
    }
  }

  @Post(['/admin/products/:id/merge-with/:into', '/admin/products/:id/merge-with/:into/'])
  mergeProduct(
    @Param({ schema: mergeParams }) params: { id: number; into: number },
    @Res() res: Response,
  ): void {
    const productId = params.id;
    const intoID = params.into;
    try {
      const p = this.products.getProduct(productId);
      if (!intoID) {
        this.renderMergeForm(res, 422, p, 0, 'Choose a product.');
        return;
      }
      const { keeper, dropImage } = this.products.mergeProducts(intoID, productId);
      this.images.deleteImage(dropImage);
      this.views.redirect(res, '/admin/products/' + keeper.id);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = mergeFormError(err);
      if (msg) {
        try {
          this.renderMergeForm(res, 422, this.products.getProduct(productId), intoID, msg);
          return;
        } catch {
          /* fallthrough */
        }
      }
      this.views.text(res, 500, 'could not merge');
    }
  }

  private renderMergeForm(res: Response, status: number, p: Product, intoID: number, errMsg: string): void {
    const items = this.products.listProducts('').filter((it) => it.id !== p.id);
    this.views.html(res, 'product_merge', status, {
      page: this.views.adminPage('Merge ' + p.name, '', errMsg),
      product: presentProduct(p),
      targets: items,
      intoId: intoID,
    });
  }

  @Get('/admin/products/:id/delete')
  confirmDeleteProduct(@Param('id', { schema: id }) productId: number, @Res() res: Response): void {
    try {
      const p = this.products.getProduct(productId);
      this.views.html(res, 'confirm', 200, {
        page: this.views.adminPage('Delete ' + p.name, '', ''),
        title: `Delete ${p.name}?`,
        body: 'This removes the product and every purchase and price recorded for it. The unit stays.',
        action: `/admin/products/${productId}/delete`,
        cancel: `/admin/products/${productId}`,
        confirm: 'Delete product',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Post('/admin/products/:id/delete')
  deleteProduct(@Param('id', { schema: id }) productId: number, @Res() res: Response): void {
    try {
      const img = this.products.deleteProduct(productId);
      this.images.deleteImage(img);
      this.views.redirect(res, '/admin');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete');
    }
  }

  // --- purchases ---

  @Get('/admin/products/:id/purchases/new')
  newPurchase(
    @Param('id', { schema: id }) productId: number,
    @Query({ schema: flashQuery }) query: { error: string },
    @Res() res: Response,
  ): void {
    const ctx = this.purchaseProduct(productId, res);
    if (!ctx) return;
    const draft: Purchase = {
      id: 0,
      productId: ctx.prod.id,
      storeId: null,
      kind: KIND_PURCHASE,
      receiptId: null,
      boughtOn: nowBoughtOn(),
      quantity: new Decimal(0),
      amount: new Decimal(0),
      createdAt: '',
    };
    this.renderPurchaseForm(res, 200, ctx.prod, draft, ctx.stores, true, query.error);
  }

  @Post('/admin/products/:id/purchases')
  createPurchase(
    @Param('id', { schema: id }) productId: number,
    @Body() raw: unknown,
    @Res() res: Response,
  ): void {
    const ctx = this.purchaseProduct(productId, res);
    if (!ctx) return;
    const body = purchaseForm.parse(raw);
    const form = purchaseFromForm(body);
    const parsed = this.parsePurchase(body);
    if (parsed.err) {
      this.renderPurchaseForm(res, 422, ctx.prod, form, ctx.stores, true, parsed.err);
      return;
    }
    try {
      const kind = this.purchases.parsePurchaseKind(body.kind);
      const storeID = this.resolveStoreForm(body.store_id);
      this.purchases.createPurchase(ctx.prod.id, storeID, parsed.boughtOn, parsed.qty, parsed.amount, kind);
      this.views.redirect(res, '/admin/products/' + ctx.prod.id);
    } catch (err) {
      this.renderPurchaseForm(res, 422, ctx.prod, form, ctx.stores, true, purchaseSaveError(err));
    }
  }

  @Get('/admin/purchases/:id/edit')
  editPurchase(@Param('id', { schema: id }) purchaseId: number, @Res() res: Response): void {
    try {
      const p = this.purchases.getPurchase(purchaseId);
      const prod = this.products.getProduct(p.productId);
      const stores = this.locations.listStores();
      this.renderPurchaseForm(res, 200, prod, p, stores, false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load purchase');
    }
  }

  @Post('/admin/purchases/:id')
  updatePurchase(
    @Param('id', { schema: id }) purchaseId: number,
    @Body() raw: unknown,
    @Res() res: Response,
  ): void {
    try {
      const p = this.purchases.getPurchase(purchaseId);
      const prod = this.products.getProduct(p.productId);
      const stores = this.locations.listStores();
      const body = purchaseForm.parse(raw);
      const form = purchaseFromForm(body);
      form.id = p.id;
      form.receiptId = p.receiptId;
      const parsed = this.parsePurchase(body);
      if (parsed.err) {
        this.renderPurchaseForm(res, 422, prod, form, stores, false, parsed.err);
        return;
      }
      const kind = this.purchases.parsePurchaseKind(body.kind);
      const storeID = this.resolveStoreForm(body.store_id);
      this.purchases.updatePurchase(purchaseId, storeID, parsed.boughtOn, parsed.qty, parsed.amount, kind);
      this.views.redirect(res, '/admin/products/' + p.productId);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load purchase');
    }
  }

  @Get('/admin/purchases/:id/delete')
  confirmDeletePurchase(@Param('id', { schema: id }) purchaseId: number, @Res() res: Response): void {
    try {
      const p = this.purchases.getPurchase(purchaseId);
      const prod = this.products.getProduct(p.productId);
      const noun = p.kind === 'price' ? 'price' : 'purchase';
      const body =
        p.kind === 'price'
          ? 'The product stays. Only this price is removed from the history.'
          : 'The product stays. Only this buy is removed from the history.';
      this.views.html(res, 'confirm', 200, {
        page: this.views.adminPage('Delete ' + noun, '', ''),
        title: `Delete this ${noun} of ${prod.name}?`,
        body: body,
        action: `/admin/purchases/${purchaseId}/delete`,
        cancel: `/admin/products/${p.productId}`,
        confirm: 'Delete ' + noun,
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load purchase');
    }
  }

  @Post('/admin/purchases/:id/delete')
  deletePurchase(@Param('id', { schema: id }) purchaseId: number, @Res() res: Response): void {
    try {
      const p = this.purchases.getPurchase(purchaseId);
      this.purchases.deletePurchase(purchaseId);
      this.views.redirect(res, '/admin/products/' + p.productId);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete');
    }
  }

  private purchaseProduct(productId: number, res: Response): { prod: Product; stores: Store[] } | null {
    try {
      return { prod: this.products.getProduct(productId), stores: this.locations.listStores() };
    } catch (err) {
      if (err instanceof NotFoundError) this.views.text(res, 404, 'not found');
      else this.views.text(res, 500, 'could not load product');
      return null;
    }
  }

  private renderPurchaseForm(
    res: Response,
    status: number,
    prod: Product,
    p: Purchase,
    stores: Store[],
    isNew: boolean,
    errMsg: string,
  ): void {
    let title = 'Add new purchase';
    if (!isNew) title = p.kind === 'price' ? 'Edit price' : 'Edit purchase';
    this.views.html(res, 'purchase_form', status, {
      page: this.views.adminPage(title, '', errMsg),
      product: presentProduct(prod),
      purchase: presentPurchase(p),
      stores: stores.map(presentStore),
      new: isNew,
    });
  }

  private parsePurchase(body: PurchaseForm): { boughtOn: string; qty: Decimal; amount: Decimal; err: string } {
    const when = fromDatetimeLocal(body.bought_on);
    if (when === '') {
      return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Date must be a valid day.' };
    }
    try {
      const amount = parseDecimal(body.amount, 2, true);
      const qty = parseDecimal(body.quantity, 8, false);
      return { boughtOn: when, qty, amount, err: '' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (body.amount !== '') {
        try {
          parseDecimal(body.amount, 2, true);
        } catch (e) {
          return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Amount ' + (e as Error).message + '.' };
        }
      }
      return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Quantity ' + msg + '.' };
    }
  }

  private resolveStoreForm(storeId: number): number {
    if (storeId <= 0) return 0;
    this.locations.getStore(storeId);
    return storeId;
  }

  private comparisonGroupOptions(selected: number[]) {
    const set = new Set(selected);
    return this.groups.listComparisonGroups().map((g) => ({ ...g, selected: set.has(g.id) }));
  }
}

function retailChainFormError(err: unknown): string {
  if (err instanceof DuplicateError) return 'A chain with that name or tax ID already exists.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  return '';
}

function storeFormError(err: unknown): string {
  if (err instanceof InvalidStoreError) return 'Choose a store.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  if (err instanceof DuplicateError) return 'That store code is already used.';
  return '';
}

function aliasFormError(err: unknown): string {
  if (err instanceof NotFoundError) return 'Choose a product.';
  if (err instanceof InvalidStoreError) return 'Choose a store.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  if (err instanceof AliasScopeError) return 'Choose either a chain or a store, not both.';
  if (err instanceof DuplicateError) return 'That alias already exists for this scope, or matches another product\'s name.';
  return '';
}

function comparisonGroupFormError(err: unknown): string {
  if (err instanceof InvalidUnitError) return 'Choose a comparison unit.';
  if (err instanceof DuplicateError) return 'A group with that name already exists.';
  if (err instanceof NotFoundError) return 'Choose products that still exist.';
  return '';
}

function mergeFormError(err: unknown): string {
  if (err instanceof ConversionConflictError) return 'Those products convert to ' + err.unitName + ' differently.';
  if (err instanceof SameProductError) return 'Choose a different product.';
  if (err instanceof NotFoundError) return 'Choose a product.';
  if (err instanceof UnitMismatchError) return 'Those products use different units.';
  return '';
}

function purchaseSaveError(err: unknown): string {
  if (err instanceof InvalidQuantityError) return 'Quantity must be greater than zero.';
  if (err instanceof InvalidKindError) return 'Choose purchase or price.';
  if (err instanceof InvalidStoreError) return 'Choose a store.';
  if (err instanceof NotFoundError) return 'Choose a store.';
  return 'Could not save the purchase.';
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

function aliasesPath(productID: number): string {
  return productID <= 0 ? '/admin/aliases' : '/admin/aliases?product=' + productID;
}

function aliasesQuerySuffix(productID: number): string {
  return productID <= 0 ? '' : '?product=' + productID;
}

function receiptReturnPath(s: string): string {
  s = s.trim();
  if (s === '') return '';
  try {
    const u = new URL(s, 'http://local');
    if (u.host !== 'local' || u.search || u.hash) return '';
    const path = u.pathname;
    if (!path.startsWith('/admin/receipts/')) return '';
    const id = path.slice('/admin/receipts/'.length);
    if (id === '' || /[/.]/.test(id) || !/^\d+$/.test(id)) return '';
    return '/admin/receipts/' + id;
  } catch {
    return '';
  }
}

function storeFromFields(f: StoreFields): Store {
  return {
    ...emptyStore(),
    name: f.name,
    streetName: f.street_name,
    buildingNumber: f.building_number,
    apartmentNumber: f.apartment_number,
    postalCode: f.postal_code,
    city: f.city,
    externalId: f.external_id,
    lat: parseCoordField(f.lat),
    lng: parseCoordField(f.lng),
  };
}

function parseCoordField(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function emptyStore(): Store {
  return {
    id: 0, name: '', streetName: '', buildingNumber: '', apartmentNumber: '', postalCode: '', city: '',
    externalId: '', lat: null, lng: null, retailChainId: null, retailChainName: '', purchaseCount: 0,
  };
}

function aliasFormFromPost(body: AliasFields): ProductAlias {
  let storeID = 0;
  let chainID = 0;
  try {
    const scope = parseAliasScope(body.scope);
    storeID = scope.storeID;
    chainID = scope.chainID;
  } catch {
    /* keep 0 */
  }
  return {
    ...emptyAlias(),
    productId: body.product_id,
    storeId: storeID || null,
    retailChainId: chainID || null,
    alias: body.alias,
  };
}

function emptyAlias(): ProductAlias {
  return { id: 0, productId: 0, productName: '', storeId: null, storeName: '', retailChainId: null, retailChainName: '', alias: '' };
}

function emptyProduct(): Product {
  return { id: 0, name: '', ean: '', unitId: 0, unitName: '', imagePath: null, createdAt: '', conversions: [] };
}

function parseExtraUnits(body: ProductFields, purchaseUnitID: number): { convs: ProductConversion[]; msg: string } {
  const ids = body.extra_unit_id;
  const factors = body.extra_factor;
  const n = Math.max(ids.length, factors.length);
  const out: ProductConversion[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const idStr = ids[i] ?? '';
    const facStr = factors[i] ?? '';
    if (idStr === '' && facStr === '') continue;
    if (idStr === '') return { convs: out, msg: 'Choose a unit for each extra unit.' };
    const extraUnitID = Number.parseInt(idStr, 10) || 0;
    if (extraUnitID === purchaseUnitID) return { convs: out, msg: 'An extra unit cannot be the same as the purchase unit.' };
    if (seen.has(extraUnitID)) return { convs: out, msg: 'Each extra unit can only be listed once.' };
    seen.add(extraUnitID);
    try {
      const factor = parseDecimal(facStr, 8, false);
      out.push({ unitId: extraUnitID, unitName: '', factor: factor });
    } catch (err) {
      return { convs: out, msg: 'Extra unit factor ' + (err as Error).message + '.' };
    }
  }
  return { convs: out, msg: '' };
}

function purchaseFromForm(body: PurchaseForm): Purchase {
  let amount = new Decimal(0);
  let quantity = new Decimal(0);
  try {
    amount = parseDecimal(body.amount, 2, true);
  } catch {
    /* keep 0 */
  }
  try {
    quantity = parseDecimal(body.quantity, 8, false);
  } catch {
    /* keep 0 */
  }
  return {
    id: 0,
    productId: 0,
    storeId: body.store_id || null,
    kind: body.kind as Purchase['kind'],
    receiptId: null,
    boughtOn: fromDatetimeLocal(body.bought_on),
    quantity: quantity,
    amount: amount,
    createdAt: '',
  };
}
