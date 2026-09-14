import { Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import Decimal from 'decimal.js';
import {
  AliasScopeError,
  ConversionConflictError,
  DuplicateError,
  InvalidConversionError,
  InvalidKindError,
  InvalidQuantityError,
  InvalidRetailChainError,
  InvalidStoryError,
  InvalidUnitError,
  NotFoundError,
  RetailChainInUseError,
  SameProductError,
  StoryInUseError,
  UnitInUseError,
  UnitMismatchError,
} from '../domain/errors';
import { parseDecimal } from '../domain/format';
import { joinBoughtOn, normalizeBoughtOn } from '../domain/bought-on';
import { AliasesRepository, type ProductAlias } from '@app/store/aliases';
import { ComparisonGroupsRepository } from '@app/store/comparison-groups';
import { LocationsRepository, type Story } from '@app/store/locations';
import { ProductsRepository, type Product, type ProductConversion } from '@app/store/products';
import { KIND_PURCHASE, PurchasesRepository, type Purchase } from '@app/store/purchases';
import { UnitsRepository } from '@app/store/units';
import { ImagesService } from './images.service';
import {
  presentAlias,
  presentChain,
  presentListItem,
  presentProduct,
  presentPurchase,
  presentStory,
  storiesByID,
} from './present';
import { ViewsService } from './views.service';
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
  newStoryQuery,
  productFields,
  productForm,
  productRefQuery,
  purchaseForm,
  retailChainFields,
  retailChainForm,
  settingsForm,
  storyFields,
  storyForm,
  unitIdForm,
  type AliasFields,
  type AliasForm,
  type NewStoryQuery,
  type ProductFields,
  type PurchaseForm,
  type StoryFields,
} from './schema';

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
        Page: this.views.adminPage('Products', q, query.error),
        Products: items.map(presentListItem),
        Imported: query.imported,
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
        PieceID: body.piece_unit_id,
        WeightID: body.weight_unit_id,
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
        Page: this.views.adminPage('Settings', '', errMsg),
        OCRModel: this.unitsStore.ocrModel(),
        Units: this.unitsStore.listUnits(),
        Defaults: this.unitsStore.unitDefaults(),
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
        Page: this.views.adminPage('Units', '', query.error),
        Units: this.unitsStore.listUnits(),
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
      this.views.html(res, 'unit_form', 200, { Page: this.views.adminPage('Rename unit', '', ''), Unit: u });
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
        Page: this.views.adminPage('Rename unit', '', formIssue(parsed.error)),
        Unit: { ID: unitId, Name: name, ProductCount: 0 },
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
          Page: this.views.adminPage('Rename unit', '', 'That unit already exists.'),
          Unit: { ID: unitId, Name: name, ProductCount: 0 },
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
      if (u.ProductCount > 0) {
        this.views.redirect(
          res,
          '/admin/units?error=' + encodeURIComponent(`Cannot delete “${u.Name}” while a product still uses it.`),
        );
        return;
      }
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete unit', '', ''),
        Title: `Delete unit “${u.Name}”?`,
        Body: 'This only removes the unit from the list. No products use it.',
        Action: `/admin/units/${unitId}/delete`,
        Cancel: '/admin/units',
        Confirm: 'Delete unit',
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
        Page: this.views.adminPage('Retail chains', '', query.error),
        RetailChains: this.locations.listRetailChains().map(presentChain),
      });
    } catch {
      this.views.text(res, 500, 'could not load retail chains');
    }
  }

  @Get('/admin/retail-chains/new')
  newRetailChain(@Res() res: Response): void {
    this.renderRetailChainForm(res, 200, { ID: 0, Name: '', LegalName: '', TaxID: '', StoryCount: 0 }, true, '');
  }

  @Post('/admin/retail-chains')
  createRetailChain(@Body() raw: unknown, @Res() res: Response): void {
    const fields = retailChainFields.parse(raw);
    const form = { ID: 0, Name: fields.name, LegalName: fields.legal_name, TaxID: fields.tax_id, StoryCount: 0 };
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
        { ID: chainId, Name: fields.name, LegalName: fields.legal_name, TaxID: fields.tax_id, StoryCount: 0 },
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
      this.renderRetailChainForm(res, 422, { ID: chainId, Name: fields.name, LegalName: fields.legal_name, TaxID: fields.tax_id, StoryCount: 0 }, false, msg);
    }
  }

  @Get('/admin/retail-chains/:id/delete')
  confirmDeleteRetailChain(@Param('id', { schema: id }) chainId: number, @Res() res: Response): void {
    try {
      const c = this.locations.getRetailChain(chainId);
      if (c.StoryCount > 0) {
        this.views.redirect(
          res,
          '/admin/retail-chains?error=' + encodeURIComponent(`Cannot delete “${c.Name}” while a store still uses it.`),
        );
        return;
      }
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete retail chain', '', ''),
        Title: `Delete retail chain “${c.Name}”?`,
        Body: 'This only removes the chain from the list. No stores use it.',
        Action: `/admin/retail-chains/${chainId}/delete`,
        Cancel: '/admin/retail-chains',
        Confirm: 'Delete chain',
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
    chain: { ID: number; Name: string; LegalName: string; TaxID: string; StoryCount: number },
    isNew: boolean,
    errMsg: string,
  ): void {
    this.views.html(res, 'retail_chain_form', status, {
      Page: this.views.adminPage(isNew ? 'Add retail chain' : 'Edit retail chain', '', errMsg),
      Chain: presentChain(chain),
      New: isNew,
    });
  }

  // --- stories ---

  @Get('/admin/stories')
  stories(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    try {
      this.views.html(res, 'stories', 200, {
        Page: this.views.adminPage('Stores', '', query.error),
        Stories: this.locations.listStories().map(presentStory),
      });
    } catch {
      this.views.text(res, 500, 'could not load stores');
    }
  }

  @Get('/admin/stories/new')
  newStory(@Query({ schema: newStoryQuery }) query: NewStoryQuery, @Res() res: Response): void {
    const next = receiptReturnPath(query.next);
    const form = emptyStory();
    form.Name = query.name;
    form.StreetName = query.street_name;
    form.BuildingNumber = query.building_number;
    form.ApartmentNumber = query.apartment_number;
    form.PostalCode = query.postal_code;
    form.City = query.city;
    form.ExternalID = query.external_id;
    this.renderStoryForm(res, 200, form, true, '', next);
  }

  @Post('/admin/stories')
  createStory(@Body() raw: unknown, @Res() res: Response): void {
    const fields = storyFields.parse(raw);
    const next = receiptReturnPath(fields.next);
    const parsed = storyForm.safeParse(raw);
    if (!parsed.success) {
      const form = { ...emptyStory(), ...storyFromFields(fields), RetailChainID: fields.retail_chain_id };
      this.renderStoryForm(res, 422, form, true, formIssue(parsed.error), next);
      return;
    }
    try {
      this.locations.createStory(
        parsed.data.name,
        parsed.data.street_name,
        parsed.data.building_number,
        parsed.data.apartment_number,
        parsed.data.postal_code,
        parsed.data.city,
        parsed.data.external_id,
        parsed.data.retail_chain_id,
      );
      this.views.redirect(res, next || '/admin/stories');
    } catch (err) {
      const form = { ...emptyStory(), ...storyFromFields(fields), RetailChainID: fields.retail_chain_id };
      const msg = storyFormError(err) || 'Could not save the store.';
      this.renderStoryForm(res, 422, form, true, msg, next);
    }
  }

  @Get('/admin/stories/:id/edit')
  editStory(@Param('id', { schema: id }) storyId: number, @Res() res: Response): void {
    try {
      this.renderStoryForm(res, 200, this.locations.getStory(storyId), false, '', '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load store');
    }
  }

  @Post('/admin/stories/:id')
  updateStory(@Param('id', { schema: id }) storyId: number, @Body() raw: unknown, @Res() res: Response): void {
    const fields = storyFields.parse(raw);
    const parsed = storyForm.safeParse(raw);
    if (!parsed.success) {
      const form = { ...storyFromFields(fields), ID: storyId, RetailChainID: fields.retail_chain_id };
      this.renderStoryForm(res, 422, form, false, formIssue(parsed.error), '');
      return;
    }
    try {
      this.locations.updateStory(
        storyId,
        parsed.data.name,
        parsed.data.street_name,
        parsed.data.building_number,
        parsed.data.apartment_number,
        parsed.data.postal_code,
        parsed.data.city,
        parsed.data.external_id,
        parsed.data.retail_chain_id,
      );
      this.views.redirect(res, '/admin/stories');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const form = { ...storyFromFields(fields), ID: storyId, RetailChainID: fields.retail_chain_id };
      const msg = storyFormError(err) || 'Could not save the store.';
      this.renderStoryForm(res, 422, form, false, msg, '');
    }
  }

  @Get('/admin/stories/:id/delete')
  confirmDeleteStory(@Param('id', { schema: id }) storyId: number, @Res() res: Response): void {
    try {
      const co = this.locations.getStory(storyId);
      if (co.PurchaseCount > 0) {
        this.views.redirect(
          res,
          '/admin/stories?error=' + encodeURIComponent(`Cannot delete “${co.Name}” while a purchase still uses it.`),
        );
        return;
      }
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete store', '', ''),
        Title: `Delete store “${co.Name}”?`,
        Body: 'This only removes the store from the list. No purchases use it.',
        Action: `/admin/stories/${storyId}/delete`,
        Cancel: '/admin/stories',
        Confirm: 'Delete store',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load store');
    }
  }

  @Post('/admin/stories/:id/delete')
  deleteStory(@Param('id', { schema: id }) storyId: number, @Res() res: Response): void {
    try {
      this.locations.deleteStory(storyId);
      this.views.redirect(res, '/admin/stories');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      if (err instanceof StoryInUseError) {
        this.views.redirect(res, '/admin/stories?error=' + encodeURIComponent('Cannot delete a store while a purchase still uses it.'));
        return;
      }
      this.views.text(res, 500, 'could not delete store');
    }
  }

  private renderStoryForm(res: Response, status: number, co: Story, isNew: boolean, errMsg: string, next: string): void {
    try {
      this.views.html(res, 'story_form', status, {
        Page: this.views.adminPage(isNew ? 'Add store' : 'Edit store', '', errMsg),
        Story: presentStory(co),
        RetailChains: this.locations.listRetailChains().map(presentChain),
        New: isNew,
        Next: next,
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
      const list = filter ? this.aliasesStore.listAliasesByProduct(filter.ID) : this.aliasesStore.listAliases();
      this.views.html(res, 'aliases', 200, {
        Page: this.views.adminPage('Aliases', '', query.error),
        Aliases: list.map(presentAlias),
        Filter: filter,
        ProductQuery: aliasesQuerySuffix(filter?.ID ?? 0),
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
        form.ProductID = locked.ID;
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
      form.ID = aliasId;
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
        form.ID = aliasId;
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
        Page: this.views.adminPage(`Delete alias “${a.Alias}”?`, '', ''),
        Title: `Delete alias “${a.Alias}”?`,
        Body: 'This only removes the alternate name. The product stays.',
        Action: action,
        Cancel: aliasesPath(from),
        Confirm: 'Delete alias',
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
      stories: this.locations.listStories(),
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
      Page: this.views.adminPage(isNew ? 'Add alias' : 'Edit alias', '', errMsg),
      Alias: presentAlias(a),
      Products: lookups.products,
      Stories: lookups.stories.map(presentStory),
      Chains: lookups.chains.map(presentChain),
      FromProduct: from,
      LockedProduct: locked,
      Cancel: aliasesPath(from),
      New: isNew,
    });
  }

  private saveAliasFromForm(body: AliasForm, aliasId: number): void {
    const { storyID, chainID } = parseAliasScope(body.scope);
    if (aliasId === 0) this.aliasesStore.createAlias(body.product_id, storyID, chainID, body.alias);
    else this.aliasesStore.updateAlias(aliasId, body.product_id, storyID, chainID, body.alias);
  }

  // --- comparison groups ---

  @Get('/admin/comparison-groups')
  comparisonGroups(@Query({ schema: flashQuery }) query: { error: string }, @Res() res: Response): void {
    try {
      this.views.html(res, 'comparison_groups', 200, {
        Page: this.views.adminPage('Comparison groups', '', query.error),
        Groups: this.groups.listComparisonGroups(),
      });
    } catch {
      this.views.text(res, 500, 'could not load comparison groups');
    }
  }

  @Get('/admin/comparison-groups/new')
  newComparisonGroup(@Res() res: Response): void {
    this.renderComparisonGroupForm(res, 200, { ID: 0, Name: '', UnitID: 0, UnitName: '', CreatedAt: '', ProductCount: 0 }, [], true, '');
  }

  @Post('/admin/comparison-groups')
  createComparisonGroup(@Body() raw: unknown, @Res() res: Response): void {
    const fields = comparisonGroupFields.parse(raw);
    const parsed = comparisonGroupForm.safeParse(raw);
    if (!parsed.success) {
      this.renderComparisonGroupForm(
        res,
        422,
        { ID: 0, Name: fields.name, UnitID: fields.unit_id, UnitName: '', CreatedAt: '', ProductCount: 0 },
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
      this.renderComparisonGroupForm(res, 422, { ID: 0, Name: fields.name, UnitID: fields.unit_id, UnitName: '', CreatedAt: '', ProductCount: 0 }, fields.product_id, true, msg);
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
        { ID: groupId, Name: fields.name, UnitID: fields.unit_id, UnitName: '', CreatedAt: '', ProductCount: 0 },
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
        this.renderComparisonGroupForm(res, 422, { ID: groupId, Name: fields.name, UnitID: fields.unit_id, UnitName: '', CreatedAt: '', ProductCount: 0 }, fields.product_id, false, msg);
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
        Page: this.views.adminPage('Delete comparison group', '', ''),
        Title: `Delete comparison group “${g.Name}”?`,
        Body: 'Products stay in the catalog. They just leave this group.',
        Action: `/admin/comparison-groups/${groupId}/delete`,
        Cancel: '/admin/comparison-groups',
        Confirm: 'Delete group',
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
    g: { ID: number; Name: string; UnitID: number; UnitName: string; CreatedAt: string; ProductCount: number },
    selected: number[],
    isNew: boolean,
    errMsg: string,
  ): void {
    try {
      const selectedSet = new Set(selected);
      this.views.html(res, 'comparison_group_form', status, {
        Page: this.views.adminPage(isNew ? 'Add comparison group' : 'Edit comparison group', '', errMsg),
        Group: g,
        Units: this.unitsStore.listUnits(),
        Products: this.products.listProducts('').map((p) => ({ ...p, Selected: selectedSet.has(p.ID) })),
        New: isNew,
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
        Page: this.views.adminPage('Add product', '', ''),
        Units: this.unitsStore.listUnits(),
        Groups: this.comparisonGroupOptions([]),
        Product: presentProduct(emptyProduct()),
        New: true,
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
      const stories = this.locations.listStories();
      const groups = this.groups.listComparisonGroupsForProduct(productId);
      this.views.html(res, 'product_show', 200, {
        Page: this.views.adminPage(p.Name, '', query.error),
        Product: presentProduct(p),
        Purchases: purchases.map(presentPurchase),
        StoryByID: storiesByID(stories),
        Groups: groups,
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
      const selected = this.groups.listComparisonGroupsForProduct(productId).map((g) => g.ID);
      this.views.html(res, 'product_form', 200, {
        Page: this.views.adminPage('Edit ' + p.Name, '', ''),
        Units: this.unitsStore.listUnits(),
        Groups: this.comparisonGroupOptions(selected),
        Product: presentProduct(p),
        New: false,
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
    const draft: Product = { ...emptyProduct(), ID: productId, Name: name, UnitID: unitID, Conversions: convs };
    try {
      const u = this.unitsStore.getUnit(unitID);
      draft.UnitName = u.Name;
    } catch {
      /* ignore */
    }
    const renderErr = (msg: string, p: Product) => {
      this.views.html(res, 'product_form', 422, {
        Page: this.views.adminPage(productId === 0 ? 'Add product' : 'Edit product', '', msg),
        Units: this.unitsStore.listUnits(),
        Groups: this.comparisonGroupOptions(groupIDs),
        Product: presentProduct(p),
        New: productId === 0,
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
        const p = this.products.createProduct(parsed.data.name, parsed.data.unit_id, imgName || null, convs);
        this.groups.setProductComparisonGroups(p.ID, groupIDs);
        this.views.redirect(res, '/admin/products/' + p.ID);
        return;
      }
      const cur = this.products.getProduct(productId);
      this.products.updateProduct(productId, parsed.data.name, cur.UnitID, imgName || null, clearImage && imgName === '', convs);
      this.groups.setProductComparisonGroups(productId, groupIDs);
      if (imgName && cur.ImagePath.Valid) this.images.deleteImage(cur.ImagePath.String);
      if (clearImage && imgName === '' && cur.ImagePath.Valid) this.images.deleteImage(cur.ImagePath.String);
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
      if (!p.Conversions.some((c) => c.UnitID === unitID)) {
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
      const buys = this.purchases.listPurchases(p.ID);
      this.views.html(res, 'product_change_unit', status, {
        Page: this.views.adminPage('Change unit for ' + p.Name, '', errMsg),
        Product: presentProduct(p),
        NewUnitID: newUnitID,
        History: buys.length,
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
        Page: this.views.adminPage('Merge ' + plan.From.Name, '', ''),
        Plan: { ...plan, Into: presentProduct(plan.Into), From: presentProduct(plan.From) },
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
      this.views.redirect(res, '/admin/products/' + keeper.ID);
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
    const items = this.products.listProducts('').filter((it) => it.ID !== p.ID);
    this.views.html(res, 'product_merge', status, {
      Page: this.views.adminPage('Merge ' + p.Name, '', errMsg),
      Product: presentProduct(p),
      Targets: items,
      IntoID: intoID,
    });
  }

  @Get('/admin/products/:id/delete')
  confirmDeleteProduct(@Param('id', { schema: id }) productId: number, @Res() res: Response): void {
    try {
      const p = this.products.getProduct(productId);
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete ' + p.Name, '', ''),
        Title: `Delete ${p.Name}?`,
        Body: 'This removes the product and every purchase and price recorded for it. The unit stays.',
        Action: `/admin/products/${productId}/delete`,
        Cancel: `/admin/products/${productId}`,
        Confirm: 'Delete product',
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
      ID: 0,
      ProductID: ctx.prod.ID,
      StoryID: 0,
      Kind: KIND_PURCHASE,
      ReceiptID: 0,
      BoughtOn: nowBoughtOn(),
      Quantity: new Decimal(0),
      Amount: new Decimal(0),
      CreatedAt: '',
    };
    this.renderPurchaseForm(res, 200, ctx.prod, draft, ctx.stories, true, query.error);
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
      this.renderPurchaseForm(res, 422, ctx.prod, form, ctx.stories, true, parsed.err);
      return;
    }
    try {
      const kind = this.purchases.parsePurchaseKind(body.kind);
      const storyID = this.resolveStoryForm(body.story_id);
      this.purchases.createPurchase(ctx.prod.ID, storyID, parsed.boughtOn, parsed.qty, parsed.amount, kind);
      this.views.redirect(res, '/admin/products/' + ctx.prod.ID);
    } catch (err) {
      this.renderPurchaseForm(res, 422, ctx.prod, form, ctx.stories, true, purchaseSaveError(err));
    }
  }

  @Get('/admin/purchases/:id/edit')
  editPurchase(@Param('id', { schema: id }) purchaseId: number, @Res() res: Response): void {
    try {
      const p = this.purchases.getPurchase(purchaseId);
      const prod = this.products.getProduct(p.ProductID);
      const stories = this.locations.listStories();
      this.renderPurchaseForm(res, 200, prod, p, stories, false, '');
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
      const prod = this.products.getProduct(p.ProductID);
      const stories = this.locations.listStories();
      const body = purchaseForm.parse(raw);
      const form = purchaseFromForm(body);
      form.ID = p.ID;
      form.ReceiptID = p.ReceiptID;
      const parsed = this.parsePurchase(body);
      if (parsed.err) {
        this.renderPurchaseForm(res, 422, prod, form, stories, false, parsed.err);
        return;
      }
      const kind = this.purchases.parsePurchaseKind(body.kind);
      const storyID = this.resolveStoryForm(body.story_id);
      this.purchases.updatePurchase(purchaseId, storyID, parsed.boughtOn, parsed.qty, parsed.amount, kind);
      this.views.redirect(res, '/admin/products/' + p.ProductID);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load purchase');
    }
  }

  @Get('/admin/purchases/:id/delete')
  confirmDeletePurchase(@Param('id', { schema: id }) purchaseId: number, @Res() res: Response): void {
    try {
      const p = this.purchases.getPurchase(purchaseId);
      const prod = this.products.getProduct(p.ProductID);
      const noun = p.Kind === 'price' ? 'price' : 'purchase';
      const body =
        p.Kind === 'price'
          ? 'The product stays. Only this price is removed from the history.'
          : 'The product stays. Only this buy is removed from the history.';
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete ' + noun, '', ''),
        Title: `Delete this ${noun} of ${prod.Name}?`,
        Body: body,
        Action: `/admin/purchases/${purchaseId}/delete`,
        Cancel: `/admin/products/${p.ProductID}`,
        Confirm: 'Delete ' + noun,
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
      this.views.redirect(res, '/admin/products/' + p.ProductID);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete');
    }
  }

  private purchaseProduct(productId: number, res: Response): { prod: Product; stories: Story[] } | null {
    try {
      return { prod: this.products.getProduct(productId), stories: this.locations.listStories() };
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
    stories: Story[],
    isNew: boolean,
    errMsg: string,
  ): void {
    let title = 'Add new purchase';
    if (!isNew) title = p.Kind === 'price' ? 'Edit price' : 'Edit purchase';
    this.views.html(res, 'purchase_form', status, {
      Page: this.views.adminPage(title, '', errMsg),
      Product: presentProduct(prod),
      Purchase: presentPurchase(p),
      Stories: stories.map(presentStory),
      New: isNew,
    });
  }

  private parsePurchase(body: PurchaseForm): { boughtOn: string; qty: Decimal; amount: Decimal; err: string } {
    try {
      const when = normalizeBoughtOn(joinBoughtOn(body.bought_on, body.bought_at));
      const amount = parseDecimal(body.amount, 2, true);
      const qty = parseDecimal(body.quantity, 8, false);
      return { boughtOn: when, qty, amount, err: '' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'required' || msg.includes('invalid date') || msg.includes('invalid time')) {
        return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Date must be a valid day.' };
      }
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

  private resolveStoryForm(storyId: number): number {
    if (storyId <= 0) return 0;
    this.locations.getStory(storyId);
    return storyId;
  }

  private comparisonGroupOptions(selected: number[]) {
    const set = new Set(selected);
    return this.groups.listComparisonGroups().map((g) => ({ ...g, Selected: set.has(g.ID) }));
  }
}

function retailChainFormError(err: unknown): string {
  if (err instanceof DuplicateError) return 'A chain with that name or tax ID already exists.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  return '';
}

function storyFormError(err: unknown): string {
  if (err instanceof InvalidStoryError) return 'Choose a store.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  if (err instanceof DuplicateError) return 'That store code is already used.';
  return '';
}

function aliasFormError(err: unknown): string {
  if (err instanceof NotFoundError) return 'Choose a product.';
  if (err instanceof InvalidStoryError) return 'Choose a store.';
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
  if (err instanceof InvalidStoryError) return 'Choose a store.';
  if (err instanceof NotFoundError) return 'Choose a store.';
  return 'Could not save the purchase.';
}

function parseAliasScope(raw: string): { storyID: number; chainID: number } {
  raw = raw.trim();
  if (raw === '') return { storyID: 0, chainID: 0 };
  const i = raw.indexOf(':');
  if (i < 0) throw new InvalidStoryError();
  const kind = raw.slice(0, i);
  const n = Number.parseInt(raw.slice(i + 1), 10);
  if (!Number.isFinite(n) || n <= 0) {
    if (kind === 'chain') throw new InvalidRetailChainError();
    throw new InvalidStoryError();
  }
  if (kind === 'story') return { storyID: n, chainID: 0 };
  if (kind === 'chain') return { storyID: 0, chainID: n };
  throw new InvalidStoryError();
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

function storyFromFields(f: StoryFields): Story {
  return { ...emptyStory(), Name: f.name, StreetName: f.street_name, BuildingNumber: f.building_number, ApartmentNumber: f.apartment_number, PostalCode: f.postal_code, City: f.city, ExternalID: f.external_id };
}

function emptyStory(): Story {
  return {
    ID: 0, Name: '', StreetName: '', BuildingNumber: '', ApartmentNumber: '', PostalCode: '', City: '',
    ExternalID: '', RetailChainID: 0, RetailChainName: '', PurchaseCount: 0,
  };
}

function aliasFormFromPost(body: AliasFields): ProductAlias {
  let storyID = 0;
  let chainID = 0;
  try {
    const scope = parseAliasScope(body.scope);
    storyID = scope.storyID;
    chainID = scope.chainID;
  } catch {
    /* keep 0 */
  }
  return {
    ...emptyAlias(),
    ProductID: body.product_id,
    StoryID: storyID,
    RetailChainID: chainID,
    Alias: body.alias,
  };
}

function emptyAlias(): ProductAlias {
  return { ID: 0, ProductID: 0, ProductName: '', StoryID: 0, StoryName: '', RetailChainID: 0, RetailChainName: '', Alias: '' };
}

function emptyProduct(): Product {
  return { ID: 0, Name: '', UnitID: 0, UnitName: '', ImagePath: { Valid: false, String: '' }, CreatedAt: '', Conversions: [] };
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
      out.push({ UnitID: extraUnitID, UnitName: '', Factor: factor });
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
    ID: 0,
    ProductID: 0,
    StoryID: body.story_id,
    Kind: body.kind as Purchase['Kind'],
    ReceiptID: 0,
    BoughtOn: joinBoughtOn(body.bought_on, body.bought_at),
    Quantity: quantity,
    Amount: amount,
    CreatedAt: '',
  };
}

function nowBoughtOn(): string {
  const n = new Date();
  const d = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  const t = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  return `${d} ${t}`;
}
