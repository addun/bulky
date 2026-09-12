import { Controller, Get, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import Decimal from 'decimal.js';
import {
  AliasScopeError,
  ComparisonGroupNameError,
  ConversionConflictError,
  DuplicateError,
  InvalidAliasError,
  InvalidConversionError,
  InvalidKindError,
  InvalidQuantityError,
  InvalidRetailChainError,
  InvalidStoryError,
  InvalidUnitError,
  NotFoundError,
  RetailChainInUseError,
  RetailChainLegalNameError,
  RetailChainNameError,
  RetailChainTaxIDError,
  SameProductError,
  StoryBuildingError,
  StoryCityError,
  StoryInUseError,
  StoryNameError,
  StoryPostalError,
  StoryStreetError,
  UnitInUseError,
  UnitMismatchError,
} from '../domain/errors';
import { parseDecimal } from '../domain/format';
import { joinBoughtOn, normalizeBoughtOn } from '../domain/bought-on';
import { KIND_PURCHASE, type Product, type ProductAlias, type ProductConversion, type Purchase, type Story } from '../domain/types';
import { StoreService } from '../store/store.service';
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

@Controller()
export class CatalogController {
  constructor(
    private readonly store: StoreService,
    private readonly views: ViewsService,
    private readonly images: ImagesService,
  ) {}

  @Get('/admin')
  index(@Req() req: Request, @Res() res: Response): void {
    const q = String(req.query.q ?? '').trim();
    try {
      const items = this.store.listProducts(q);
      this.views.html(res, 'index', 200, {
        Page: this.views.adminPage('Products', q, String(req.query.error ?? '')),
        Products: items.map(presentListItem),
        Imported: Number.parseInt(String(req.query.imported ?? '0'), 10) || 0,
      });
    } catch {
      this.views.text(res, 500, 'could not load products');
    }
  }

  @Get('/admin/settings')
  admin(@Req() req: Request, @Res() res: Response): void {
    this.renderAdmin(res, 200, '');
  }

  @Post('/admin/settings')
  updateAdmin(@Req() req: Request, @Res() res: Response): void {
    const model = this.views.field(req, 'ocr_model').trim();
    if (model === '') {
      this.renderAdmin(res, 422, 'AI model is required.');
      return;
    }
    try {
      this.store.setUnitDefaults({
        PieceID: this.views.formInt(req, 'piece_unit_id'),
        WeightID: this.views.formInt(req, 'weight_unit_id'),
      });
      this.store.setSetting('ocr_model', model);
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
        OCRModel: this.store.ocrModel(),
        Units: this.store.listUnits(),
        Defaults: this.store.unitDefaults(),
      });
    } catch {
      this.views.text(res, 500, 'could not load settings');
    }
  }

  // --- units ---

  @Get('/admin/units')
  units(@Req() req: Request, @Res() res: Response): void {
    try {
      this.views.html(res, 'units', 200, {
        Page: this.views.adminPage('Units', '', String(req.query.error ?? '')),
        Units: this.store.listUnits(),
      });
    } catch {
      this.views.text(res, 500, 'could not load units');
    }
  }

  @Post('/admin/units')
  createUnit(@Req() req: Request, @Res() res: Response): void {
    try {
      this.store.createUnit(this.views.field(req, 'name'));
      this.views.redirect(res, '/admin/units');
    } catch (err) {
      if (err instanceof InvalidUnitError) {
        this.views.redirect(res, '/admin/units?error=' + encodeURIComponent('Name is required.'));
        return;
      }
      if (err instanceof DuplicateError) {
        this.views.redirect(res, '/admin/units?error=' + encodeURIComponent('That unit already exists.'));
        return;
      }
      this.views.redirect(res, '/admin/units?error=' + encodeURIComponent('Could not save the unit.'));
    }
  }

  @Get('/admin/units/:id/edit')
  editUnit(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const u = this.store.getUnit(id);
      this.views.html(res, 'unit_form', 200, { Page: this.views.adminPage('Rename unit', '', ''), Unit: u });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load unit');
    }
  }

  @Post('/admin/units/:id')
  updateUnit(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    const name = this.views.field(req, 'name').trim();
    try {
      this.store.updateUnit(id, name);
      this.views.redirect(res, '/admin/units');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      if (err instanceof InvalidUnitError) {
        this.views.html(res, 'unit_form', 422, {
          Page: this.views.adminPage('Rename unit', '', 'Name is required.'),
          Unit: { ID: id, Name: name, ProductCount: 0 },
        });
        return;
      }
      if (err instanceof DuplicateError) {
        this.views.html(res, 'unit_form', 422, {
          Page: this.views.adminPage('Rename unit', '', 'That unit already exists.'),
          Unit: { ID: id, Name: name, ProductCount: 0 },
        });
        return;
      }
      this.views.text(res, 500, 'could not save unit');
    }
  }

  @Get('/admin/units/:id/delete')
  confirmDeleteUnit(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const u = this.store.getUnit(id);
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
        Action: `/admin/units/${id}/delete`,
        Cancel: '/admin/units',
        Confirm: 'Delete unit',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load unit');
    }
  }

  @Post('/admin/units/:id/delete')
  deleteUnit(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.store.deleteUnit(id);
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
  retailChains(@Req() req: Request, @Res() res: Response): void {
    try {
      this.views.html(res, 'retail_chains', 200, {
        Page: this.views.adminPage('Retail chains', '', String(req.query.error ?? '')),
        RetailChains: this.store.listRetailChains().map(presentChain),
      });
    } catch {
      this.views.text(res, 500, 'could not load retail chains');
    }
  }

  @Get('/admin/retail-chains/new')
  newRetailChain(@Req() _req: Request, @Res() res: Response): void {
    this.renderRetailChainForm(res, 200, { ID: 0, Name: '', LegalName: '', TaxID: '', StoryCount: 0 }, true, '');
  }

  @Post('/admin/retail-chains')
  createRetailChain(@Req() req: Request, @Res() res: Response): void {
    const name = this.views.field(req, 'name').trim();
    const legal = this.views.field(req, 'legal_name').trim();
    const tax = this.views.field(req, 'tax_id').trim();
    const form = { ID: 0, Name: name, LegalName: legal, TaxID: tax, StoryCount: 0 };
    try {
      this.store.createRetailChain(name, legal, tax);
      this.views.redirect(res, '/admin/retail-chains');
    } catch (err) {
      const msg = retailChainFormError(err) || 'Could not save the retail chain.';
      this.renderRetailChainForm(res, 422, form, true, msg);
    }
  }

  @Get('/admin/retail-chains/:id/edit')
  editRetailChain(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.renderRetailChainForm(res, 200, this.store.getRetailChain(id), false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load retail chain');
    }
  }

  @Post('/admin/retail-chains/:id')
  updateRetailChain(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    const name = this.views.field(req, 'name').trim();
    const legal = this.views.field(req, 'legal_name').trim();
    const tax = this.views.field(req, 'tax_id').trim();
    try {
      this.store.updateRetailChain(id, name, legal, tax);
      this.views.redirect(res, '/admin/retail-chains');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = retailChainFormError(err) || 'Could not save the retail chain.';
      this.renderRetailChainForm(res, 422, { ID: id, Name: name, LegalName: legal, TaxID: tax, StoryCount: 0 }, false, msg);
    }
  }

  @Get('/admin/retail-chains/:id/delete')
  confirmDeleteRetailChain(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const c = this.store.getRetailChain(id);
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
        Action: `/admin/retail-chains/${id}/delete`,
        Cancel: '/admin/retail-chains',
        Confirm: 'Delete chain',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load retail chain');
    }
  }

  @Post('/admin/retail-chains/:id/delete')
  deleteRetailChain(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.store.deleteRetailChain(id);
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
  stories(@Req() req: Request, @Res() res: Response): void {
    try {
      this.views.html(res, 'stories', 200, {
        Page: this.views.adminPage('Stores', '', String(req.query.error ?? '')),
        Stories: this.store.listStories().map(presentStory),
      });
    } catch {
      this.views.text(res, 500, 'could not load stores');
    }
  }

  @Get('/admin/stories/new')
  newStory(@Req() req: Request, @Res() res: Response): void {
    const next = receiptReturnPath(String(req.query.next ?? ''));
    const form = emptyStory();
    form.Name = String(req.query['prefill[name]'] ?? '').trim();
    form.StreetName = String(req.query['prefill[street_name]'] ?? '').trim();
    form.BuildingNumber = String(req.query['prefill[building_number]'] ?? '').trim();
    form.ApartmentNumber = String(req.query['prefill[apartment_number]'] ?? '').trim();
    form.PostalCode = String(req.query['prefill[postal_code]'] ?? '').trim();
    form.City = String(req.query['prefill[city]'] ?? '').trim();
    form.ExternalID = String(req.query['prefill[external_id]'] ?? '').trim();
    this.renderStoryForm(res, 200, form, true, '', next);
  }

  @Post('/admin/stories')
  createStory(@Req() req: Request, @Res() res: Response): void {
    const next = receiptReturnPath(this.views.field(req, 'next'));
    const fields = storyFields(this.views, req);
    const chainID = this.views.formInt(req, 'retail_chain_id');
    try {
      this.store.createStory(
        fields.name,
        fields.street,
        fields.building,
        fields.apartment,
        fields.postal,
        fields.city,
        fields.externalID,
        chainID,
      );
      this.views.redirect(res, next || '/admin/stories');
    } catch (err) {
      const form = { ...emptyStory(), ...storyFromFields(fields), RetailChainID: chainID };
      const msg = storyFormError(err) || 'Could not save the store.';
      this.renderStoryForm(res, 422, form, true, msg, next);
    }
  }

  @Get('/admin/stories/:id/edit')
  editStory(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.renderStoryForm(res, 200, this.store.getStory(id), false, '', '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load store');
    }
  }

  @Post('/admin/stories/:id')
  updateStory(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    const fields = storyFields(this.views, req);
    const chainID = this.views.formInt(req, 'retail_chain_id');
    try {
      this.store.updateStory(
        id,
        fields.name,
        fields.street,
        fields.building,
        fields.apartment,
        fields.postal,
        fields.city,
        fields.externalID,
        chainID,
      );
      this.views.redirect(res, '/admin/stories');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const form = { ...storyFromFields(fields), ID: id, RetailChainID: chainID };
      const msg = storyFormError(err) || 'Could not save the store.';
      this.renderStoryForm(res, 422, form, false, msg, '');
    }
  }

  @Get('/admin/stories/:id/delete')
  confirmDeleteStory(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const co = this.store.getStory(id);
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
        Action: `/admin/stories/${id}/delete`,
        Cancel: '/admin/stories',
        Confirm: 'Delete store',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load store');
    }
  }

  @Post('/admin/stories/:id/delete')
  deleteStory(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.store.deleteStory(id);
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
        RetailChains: this.store.listRetailChains().map(presentChain),
        New: isNew,
        Next: next,
      });
    } catch {
      this.views.text(res, 500, 'could not load retail chains');
    }
  }

  // --- aliases ---

  @Get('/admin/aliases')
  aliases(@Req() req: Request, @Res() res: Response): void {
    const productID = this.views.queryInt(req, 'product');
    try {
      let filter: Product | null = null;
      if (productID > 0) filter = this.store.getProduct(productID);
      const list = filter ? this.store.listAliasesByProduct(filter.ID) : this.store.listAliases();
      this.views.html(res, 'aliases', 200, {
        Page: this.views.adminPage('Aliases', '', String(req.query.error ?? '')),
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
  newAlias(@Req() req: Request, @Res() res: Response): void {
    const from = this.views.queryInt(req, 'product');
    try {
      const lookups = this.aliasLookups();
      let locked: Product | null = null;
      const form = emptyAlias();
      if (from > 0) {
        locked = this.store.getProduct(from);
        form.ProductID = locked.ID;
      }
      this.renderAliasForm(res, 200, form, lookups, from, locked, true, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load the catalog');
    }
  }

  @Post('/admin/aliases')
  createAlias(@Req() req: Request, @Res() res: Response): void {
    const from = this.views.formInt(req, 'from_product');
    try {
      this.saveAliasFromForm(req, 0);
      this.views.redirect(res, aliasesPath(from));
    } catch (err) {
      try {
        const lookups = this.aliasLookups();
        let locked: Product | null = null;
        if (from > 0) {
          try {
            locked = this.store.getProduct(from);
          } catch {
            locked = null;
          }
        }
        this.renderAliasForm(res, 422, aliasFormFromPost(this.views, req), lookups, from, locked, true, aliasFormError(err) || 'Could not save the alias.');
      } catch {
        this.views.text(res, 500, 'could not load the catalog');
      }
    }
  }

  @Get('/admin/aliases/:id/edit')
  editAlias(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const a = this.store.getAlias(id);
      this.renderAliasForm(res, 200, a, this.aliasLookups(), this.views.queryInt(req, 'product'), null, false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load alias');
    }
  }

  @Post('/admin/aliases/:id')
  updateAlias(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    const from = this.views.formInt(req, 'from_product');
    try {
      this.store.getAlias(id);
      this.saveAliasFromForm(req, id);
      this.views.redirect(res, aliasesPath(from));
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = aliasFormError(err);
      if (msg) {
        const form = aliasFormFromPost(this.views, req);
        form.ID = id;
        this.renderAliasForm(res, 422, form, this.aliasLookups(), from, null, false, msg);
        return;
      }
      this.views.text(res, 500, 'could not save alias');
    }
  }

  @Get('/admin/aliases/:id/delete')
  confirmDeleteAlias(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    const from = this.views.queryInt(req, 'product');
    try {
      const a = this.store.getAlias(id);
      let action = `/admin/aliases/${id}/delete`;
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
  deleteAlias(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.store.deleteAlias(id);
      this.views.redirect(res, aliasesPath(this.views.queryInt(req, 'product')));
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete alias');
    }
  }

  private aliasLookups() {
    return {
      products: this.store.listProducts(''),
      stories: this.store.listStories(),
      chains: this.store.listRetailChains(),
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

  private saveAliasFromForm(req: Request, id: number): void {
    const productID = this.views.formInt(req, 'product_id');
    const { storyID, chainID } = parseAliasScope(this.views.field(req, 'scope'));
    const alias = this.views.field(req, 'alias').trim();
    if (id === 0) this.store.createAlias(productID, storyID, chainID, alias);
    else this.store.updateAlias(id, productID, storyID, chainID, alias);
  }

  // --- comparison groups ---

  @Get('/admin/comparison-groups')
  comparisonGroups(@Req() req: Request, @Res() res: Response): void {
    try {
      this.views.html(res, 'comparison_groups', 200, {
        Page: this.views.adminPage('Comparison groups', '', String(req.query.error ?? '')),
        Groups: this.store.listComparisonGroups(),
      });
    } catch {
      this.views.text(res, 500, 'could not load comparison groups');
    }
  }

  @Get('/admin/comparison-groups/new')
  newComparisonGroup(@Req() _req: Request, @Res() res: Response): void {
    this.renderComparisonGroupForm(res, 200, { ID: 0, Name: '', UnitID: 0, UnitName: '', CreatedAt: '', ProductCount: 0 }, [], true, '');
  }

  @Post('/admin/comparison-groups')
  createComparisonGroup(@Req() req: Request, @Res() res: Response): void {
    const name = this.views.field(req, 'name').trim();
    const unitID = this.views.formInt(req, 'unit_id');
    const productIDs = this.views.formInts(req, 'product_id');
    try {
      this.store.createComparisonGroup(name, unitID, productIDs);
      this.views.redirect(res, '/admin/comparison-groups');
    } catch (err) {
      const msg = comparisonGroupFormError(err) || 'Could not save the comparison group.';
      this.renderComparisonGroupForm(res, 422, { ID: 0, Name: name, UnitID: unitID, UnitName: '', CreatedAt: '', ProductCount: 0 }, productIDs, true, msg);
    }
  }

  @Get('/admin/comparison-groups/:id/edit')
  editComparisonGroup(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const g = this.store.getComparisonGroup(id);
      const ids = this.store.listComparisonGroupProductIDs(id);
      this.renderComparisonGroupForm(res, 200, g, ids, false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load comparison group');
    }
  }

  @Post('/admin/comparison-groups/:id')
  updateComparisonGroup(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    const name = this.views.field(req, 'name').trim();
    const unitID = this.views.formInt(req, 'unit_id');
    const productIDs = this.views.formInts(req, 'product_id');
    try {
      this.store.getComparisonGroup(id);
      this.store.updateComparisonGroup(id, name, unitID, productIDs);
      this.views.redirect(res, '/admin/comparison-groups');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = comparisonGroupFormError(err);
      if (msg) {
        this.renderComparisonGroupForm(res, 422, { ID: id, Name: name, UnitID: unitID, UnitName: '', CreatedAt: '', ProductCount: 0 }, productIDs, false, msg);
        return;
      }
      this.views.text(res, 500, 'could not save comparison group');
    }
  }

  @Get('/admin/comparison-groups/:id/delete')
  confirmDeleteComparisonGroup(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const g = this.store.getComparisonGroup(id);
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete comparison group', '', ''),
        Title: `Delete comparison group “${g.Name}”?`,
        Body: 'Products stay in the catalog. They just leave this group.',
        Action: `/admin/comparison-groups/${id}/delete`,
        Cancel: '/admin/comparison-groups',
        Confirm: 'Delete group',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load comparison group');
    }
  }

  @Post('/admin/comparison-groups/:id/delete')
  deleteComparisonGroup(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.store.deleteComparisonGroup(id);
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
        Units: this.store.listUnits(),
        Products: this.store.listProducts('').map((p) => ({ ...p, Selected: selectedSet.has(p.ID) })),
        New: isNew,
      });
    } catch {
      this.views.text(res, 500, 'could not load products');
    }
  }

  // --- products ---

  @Get('/admin/products/new')
  newProduct(@Req() _req: Request, @Res() res: Response): void {
    try {
      this.views.html(res, 'product_form', 200, {
        Page: this.views.adminPage('Add product', '', ''),
        Units: this.store.listUnits(),
        Groups: this.comparisonGroupOptions([]),
        Product: presentProduct(emptyProduct()),
        New: true,
      });
    } catch {
      this.views.text(res, 500, 'could not load units');
    }
  }

  @Get('/admin/products/:id')
  showProduct(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getProduct(id);
      const purchases = this.store.listPurchases(id);
      const stories = this.store.listStories();
      const groups = this.store.listComparisonGroupsForProduct(id);
      this.views.html(res, 'product_show', 200, {
        Page: this.views.adminPage(p.Name, '', String(req.query.error ?? '')),
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
  editProduct(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getProduct(id);
      const selected = this.store.listComparisonGroupsForProduct(id).map((g) => g.ID);
      this.views.html(res, 'product_form', 200, {
        Page: this.views.adminPage('Edit ' + p.Name, '', ''),
        Units: this.store.listUnits(),
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
    @Req() req: Request,
    @Res() res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<void> {
    await this.saveProduct(req, res, 0, file);
  }

  @Post('/admin/products/:id')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 6 << 20 } }))
  async updateProduct(
    @Req() req: Request,
    @Res() res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<void> {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    await this.saveProduct(req, res, id, file);
  }

  private async saveProduct(req: Request, res: Response, id: number, file?: Express.Multer.File): Promise<void> {
    const name = this.views.field(req, 'name').trim();
    const unitID = this.views.formInt(req, 'unit_id');
    const groupIDs = this.views.formInts(req, 'group_id');
    const { convs, msg: convMsg } = parseExtraUnits(this.views, req, unitID);
    const draft: Product = { ...emptyProduct(), ID: id, Name: name, UnitID: unitID, Conversions: convs };
    try {
      const u = this.store.getUnit(unitID);
      draft.UnitName = u.Name;
    } catch {
      /* ignore */
    }
    const renderErr = (msg: string, p: Product) => {
      this.views.html(res, 'product_form', 422, {
        Page: this.views.adminPage(id === 0 ? 'Add product' : 'Edit product', '', msg),
        Units: this.store.listUnits(),
        Groups: this.comparisonGroupOptions(groupIDs),
        Product: presentProduct(p),
        New: id === 0,
      });
    };
    if (name === '') {
      renderErr('Name is required.', draft);
      return;
    }
    try {
      this.store.getUnit(unitID);
    } catch {
      renderErr('Choose a unit.', draft);
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
    const clearImage = this.views.field(req, 'clear_image') === '1';
    try {
      if (id === 0) {
        const p = this.store.createProduct(name, unitID, imgName || null, convs);
        this.store.setProductComparisonGroups(p.ID, groupIDs);
        this.views.redirect(res, '/admin/products/' + p.ID);
        return;
      }
      const cur = this.store.getProduct(id);
      this.store.updateProduct(id, name, cur.UnitID, imgName || null, clearImage && imgName === '', convs);
      this.store.setProductComparisonGroups(id, groupIDs);
      if (imgName && cur.ImagePath.Valid) this.images.deleteImage(cur.ImagePath.String);
      if (clearImage && imgName === '' && cur.ImagePath.Valid) this.images.deleteImage(cur.ImagePath.String);
      this.views.redirect(res, '/admin/products/' + id);
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
  changeProductUnitForm(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.renderChangeUnit(res, 200, this.store.getProduct(id), 0, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Post('/admin/products/:id/change-unit')
  changeProductUnit(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getProduct(id);
      const unitID = this.views.formInt(req, 'unit_id');
      if (!p.Conversions.some((c) => c.UnitID === unitID)) {
        this.renderChangeUnit(res, 422, p, unitID, 'Choose one of the extra units on this product.');
        return;
      }
      this.store.changePurchaseUnit(id, unitID);
      this.views.redirect(res, '/admin/products/' + id);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      let msg = 'Could not change the unit.';
      if (err instanceof InvalidUnitError) msg = 'Choose a different unit from the current purchase unit.';
      if (err instanceof InvalidConversionError) msg = 'Choose one of the extra units on this product.';
      try {
        this.renderChangeUnit(res, 422, this.store.getProduct(id), this.views.formInt(req, 'unit_id'), msg);
      } catch {
        this.views.text(res, 500, 'could not load product');
      }
    }
  }

  private renderChangeUnit(res: Response, status: number, p: Product, newUnitID: number, errMsg: string): void {
    try {
      const buys = this.store.listPurchases(p.ID);
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
  mergeProductForm(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      this.renderMergeForm(res, 200, this.store.getProduct(id), this.views.queryInt(req, 'into_id'), '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Post('/admin/products/:id/merge-with')
  mergeProductRedirect(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    const intoID = this.views.formInt(req, 'into_id');
    if (intoID <= 0) {
      try {
        this.renderMergeForm(res, 422, this.store.getProduct(id), 0, 'Choose a product.');
      } catch (err) {
        if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
        this.views.text(res, 500, 'could not load product');
      }
      return;
    }
    this.views.redirect(res, `/admin/products/${id}/merge-with/${intoID}/`);
  }

  @Get(['/admin/products/:id/merge-with/:into', '/admin/products/:id/merge-with/:into/'])
  mergeProductConfirm(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    const intoID = this.views.paramID(req, 'into');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getProduct(id);
      if (!intoID) {
        this.renderMergeForm(res, 422, p, 0, 'Choose a product.');
        return;
      }
      const plan = this.store.mergePlan(intoID, id);
      this.views.html(res, 'product_merge_confirm', 200, {
        Page: this.views.adminPage('Merge ' + plan.From.Name, '', ''),
        Plan: { ...plan, Into: presentProduct(plan.Into), From: presentProduct(plan.From) },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        try {
          this.renderMergeForm(res, 422, this.store.getProduct(id), intoID ?? 0, mergeFormError(err));
        } catch {
          this.views.text(res, 404, 'not found');
        }
        return;
      }
      const msg = mergeFormError(err);
      if (msg) {
        try {
          this.renderMergeForm(res, 422, this.store.getProduct(id), intoID ?? 0, msg);
          return;
        } catch {
          /* fallthrough */
        }
      }
      this.views.text(res, 500, 'could not load merge');
    }
  }

  @Post(['/admin/products/:id/merge-with/:into', '/admin/products/:id/merge-with/:into/'])
  mergeProduct(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    const intoID = this.views.paramID(req, 'into');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getProduct(id);
      if (!intoID) {
        this.renderMergeForm(res, 422, p, 0, 'Choose a product.');
        return;
      }
      const { keeper, dropImage } = this.store.mergeProducts(intoID, id);
      this.images.deleteImage(dropImage);
      this.views.redirect(res, '/admin/products/' + keeper.ID);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      const msg = mergeFormError(err);
      if (msg) {
        try {
          this.renderMergeForm(res, 422, this.store.getProduct(id), intoID ?? 0, msg);
          return;
        } catch {
          /* fallthrough */
        }
      }
      this.views.text(res, 500, 'could not merge');
    }
  }

  private renderMergeForm(res: Response, status: number, p: Product, intoID: number, errMsg: string): void {
    const items = this.store.listProducts('').filter((it) => it.ID !== p.ID);
    this.views.html(res, 'product_merge', status, {
      Page: this.views.adminPage('Merge ' + p.Name, '', errMsg),
      Product: presentProduct(p),
      Targets: items,
      IntoID: intoID,
    });
  }

  @Get('/admin/products/:id/delete')
  confirmDeleteProduct(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getProduct(id);
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete ' + p.Name, '', ''),
        Title: `Delete ${p.Name}?`,
        Body: 'This removes the product and every purchase and price recorded for it. The unit stays.',
        Action: `/admin/products/${id}/delete`,
        Cancel: `/admin/products/${id}`,
        Confirm: 'Delete product',
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load product');
    }
  }

  @Post('/admin/products/:id/delete')
  deleteProduct(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const img = this.store.deleteProduct(id);
      this.images.deleteImage(img);
      this.views.redirect(res, '/admin');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete');
    }
  }

  // --- purchases ---

  @Get('/admin/products/:id/purchases/new')
  newPurchase(@Req() req: Request, @Res() res: Response): void {
    const ctx = this.purchaseProduct(req, res);
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
    this.renderPurchaseForm(res, 200, ctx.prod, draft, ctx.stories, true, String(req.query.error ?? ''));
  }

  @Post('/admin/products/:id/purchases')
  createPurchase(@Req() req: Request, @Res() res: Response): void {
    const ctx = this.purchaseProduct(req, res);
    if (!ctx) return;
    const form = purchaseFromForm(this.views, req);
    const parsed = this.parsePurchase(req);
    if (parsed.err) {
      this.renderPurchaseForm(res, 422, ctx.prod, form, ctx.stories, true, parsed.err);
      return;
    }
    try {
      const kind = this.store.parsePurchaseKind(this.views.field(req, 'kind'));
      const storyID = this.resolveStoryForm(req);
      this.store.createPurchase(ctx.prod.ID, storyID, parsed.boughtOn, parsed.qty, parsed.amount, kind);
      this.views.redirect(res, '/admin/products/' + ctx.prod.ID);
    } catch (err) {
      this.renderPurchaseForm(res, 422, ctx.prod, form, ctx.stories, true, purchaseSaveError(err));
    }
  }

  @Get('/admin/purchases/:id/edit')
  editPurchase(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getPurchase(id);
      const prod = this.store.getProduct(p.ProductID);
      const stories = this.store.listStories();
      this.renderPurchaseForm(res, 200, prod, p, stories, false, '');
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load purchase');
    }
  }

  @Post('/admin/purchases/:id')
  updatePurchase(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getPurchase(id);
      const prod = this.store.getProduct(p.ProductID);
      const stories = this.store.listStories();
      const form = purchaseFromForm(this.views, req);
      form.ID = p.ID;
      form.ReceiptID = p.ReceiptID;
      const parsed = this.parsePurchase(req);
      if (parsed.err) {
        this.renderPurchaseForm(res, 422, prod, form, stories, false, parsed.err);
        return;
      }
      const kind = this.store.parsePurchaseKind(this.views.field(req, 'kind'));
      const storyID = this.resolveStoryForm(req);
      this.store.updatePurchase(id, storyID, parsed.boughtOn, parsed.qty, parsed.amount, kind);
      this.views.redirect(res, '/admin/products/' + p.ProductID);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load purchase');
    }
  }

  @Get('/admin/purchases/:id/delete')
  confirmDeletePurchase(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getPurchase(id);
      const prod = this.store.getProduct(p.ProductID);
      const noun = p.Kind === 'price' ? 'price' : 'purchase';
      const body =
        p.Kind === 'price'
          ? 'The product stays. Only this price is removed from the history.'
          : 'The product stays. Only this buy is removed from the history.';
      this.views.html(res, 'confirm', 200, {
        Page: this.views.adminPage('Delete ' + noun, '', ''),
        Title: `Delete this ${noun} of ${prod.Name}?`,
        Body: body,
        Action: `/admin/purchases/${id}/delete`,
        Cancel: `/admin/products/${p.ProductID}`,
        Confirm: 'Delete ' + noun,
      });
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not load purchase');
    }
  }

  @Post('/admin/purchases/:id/delete')
  deletePurchase(@Req() req: Request, @Res() res: Response): void {
    const id = this.views.paramID(req, 'id');
    if (!id) return this.views.text(res, 404, 'not found');
    try {
      const p = this.store.getPurchase(id);
      this.store.deletePurchase(id);
      this.views.redirect(res, '/admin/products/' + p.ProductID);
    } catch (err) {
      if (err instanceof NotFoundError) return this.views.text(res, 404, 'not found');
      this.views.text(res, 500, 'could not delete');
    }
  }

  private purchaseProduct(req: Request, res: Response): { prod: Product; stories: Story[] } | null {
    const id = this.views.paramID(req, 'id');
    if (!id) {
      this.views.text(res, 404, 'not found');
      return null;
    }
    try {
      return { prod: this.store.getProduct(id), stories: this.store.listStories() };
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

  private parsePurchase(req: Request): { boughtOn: string; qty: Decimal; amount: Decimal; err: string } {
    try {
      const when = normalizeBoughtOn(joinBoughtOn(this.views.field(req, 'bought_on'), this.views.field(req, 'bought_at')));
      const amount = parseDecimal(this.views.field(req, 'amount'), 2, true);
      const qty = parseDecimal(this.views.field(req, 'quantity'), 8, false);
      return { boughtOn: when, qty, amount, err: '' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'required' || msg.includes('invalid date') || msg.includes('invalid time')) {
        return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Date must be a valid day.' };
      }
      if (this.views.field(req, 'amount') !== undefined) {
        try {
          parseDecimal(this.views.field(req, 'amount'), 2, true);
        } catch (e) {
          return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Amount ' + (e as Error).message + '.' };
        }
      }
      return { boughtOn: '', qty: new Decimal(0), amount: new Decimal(0), err: 'Quantity ' + msg + '.' };
    }
  }

  private resolveStoryForm(req: Request): number {
    const id = this.views.formInt(req, 'story_id');
    if (id <= 0) return 0;
    this.store.getStory(id);
    return id;
  }

  private comparisonGroupOptions(selected: number[]) {
    const set = new Set(selected);
    return this.store.listComparisonGroups().map((g) => ({ ...g, Selected: set.has(g.ID) }));
  }
}

function retailChainFormError(err: unknown): string {
  if (err instanceof RetailChainNameError) return 'Name is required.';
  if (err instanceof RetailChainLegalNameError) return 'Legal name is required.';
  if (err instanceof RetailChainTaxIDError) return 'Tax ID is required.';
  if (err instanceof DuplicateError) return 'A chain with that name or tax ID already exists.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  return '';
}

function storyFormError(err: unknown): string {
  if (err instanceof StoryNameError) return 'Name is required.';
  if (err instanceof StoryStreetError) return 'Street name is required.';
  if (err instanceof StoryBuildingError) return 'Building number is required.';
  if (err instanceof StoryPostalError) return 'Postal code is required.';
  if (err instanceof StoryCityError) return 'City is required.';
  if (err instanceof InvalidStoryError) return 'Choose a store.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  if (err instanceof DuplicateError) return 'That store code is already used.';
  return '';
}

function aliasFormError(err: unknown): string {
  if (err instanceof InvalidAliasError) return 'Alias is required.';
  if (err instanceof NotFoundError) return 'Choose a product.';
  if (err instanceof InvalidStoryError) return 'Choose a store.';
  if (err instanceof InvalidRetailChainError) return 'Choose a retail chain.';
  if (err instanceof AliasScopeError) return 'Choose either a chain or a store, not both.';
  if (err instanceof DuplicateError) return 'That alias already exists for this scope, or matches another product\'s name.';
  return '';
}

function comparisonGroupFormError(err: unknown): string {
  if (err instanceof ComparisonGroupNameError) return 'Name is required.';
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

function storyFields(views: ViewsService, req: Request) {
  return {
    name: views.field(req, 'name').trim(),
    street: views.field(req, 'street_name').trim(),
    building: views.field(req, 'building_number').trim(),
    apartment: views.field(req, 'apartment_number').trim(),
    postal: views.field(req, 'postal_code').trim(),
    city: views.field(req, 'city').trim(),
    externalID: views.field(req, 'external_id').trim(),
  };
}

function storyFromFields(f: ReturnType<typeof storyFields>): Story {
  return { ...emptyStory(), Name: f.name, StreetName: f.street, BuildingNumber: f.building, ApartmentNumber: f.apartment, PostalCode: f.postal, City: f.city, ExternalID: f.externalID };
}

function emptyStory(): Story {
  return {
    ID: 0, Name: '', StreetName: '', BuildingNumber: '', ApartmentNumber: '', PostalCode: '', City: '',
    ExternalID: '', RetailChainID: 0, RetailChainName: '', PurchaseCount: 0,
  };
}

function aliasFormFromPost(views: ViewsService, req: Request): ProductAlias {
  let storyID = 0;
  let chainID = 0;
  try {
    const scope = parseAliasScope(views.field(req, 'scope'));
    storyID = scope.storyID;
    chainID = scope.chainID;
  } catch {
    /* keep 0 */
  }
  return {
    ...emptyAlias(),
    ProductID: views.formInt(req, 'product_id'),
    StoryID: storyID,
    RetailChainID: chainID,
    Alias: views.field(req, 'alias').trim(),
  };
}

function emptyAlias(): ProductAlias {
  return { ID: 0, ProductID: 0, ProductName: '', StoryID: 0, StoryName: '', RetailChainID: 0, RetailChainName: '', Alias: '' };
}

function emptyProduct(): Product {
  return { ID: 0, Name: '', UnitID: 0, UnitName: '', ImagePath: { Valid: false, String: '' }, CreatedAt: '', Conversions: [] };
}

function parseExtraUnits(views: ViewsService, req: Request, purchaseUnitID: number): { convs: ProductConversion[]; msg: string } {
  const ids = views.fields(req, 'extra_unit_id');
  const factors = views.fields(req, 'extra_factor');
  const n = Math.max(ids.length, factors.length);
  const out: ProductConversion[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const idStr = (ids[i] ?? '').trim();
    const facStr = (factors[i] ?? '').trim();
    if (idStr === '' && facStr === '') continue;
    if (idStr === '') return { convs: out, msg: 'Choose a unit for each extra unit.' };
    const unitID = Number.parseInt(idStr, 10) || 0;
    if (unitID === purchaseUnitID) return { convs: out, msg: 'An extra unit cannot be the same as the purchase unit.' };
    if (seen.has(unitID)) return { convs: out, msg: 'Each extra unit can only be listed once.' };
    seen.add(unitID);
    try {
      const factor = parseDecimal(facStr, 8, false);
      out.push({ UnitID: unitID, UnitName: '', Factor: factor });
    } catch (err) {
      return { convs: out, msg: 'Extra unit factor ' + (err as Error).message + '.' };
    }
  }
  return { convs: out, msg: '' };
}

function purchaseFromForm(views: ViewsService, req: Request): Purchase {
  let amount = new Decimal(0);
  let quantity = new Decimal(0);
  try {
    amount = parseDecimal(views.field(req, 'amount'), 2, true);
  } catch {
    /* keep 0 */
  }
  try {
    quantity = parseDecimal(views.field(req, 'quantity'), 8, false);
  } catch {
    /* keep 0 */
  }
  return {
    ID: 0,
    ProductID: 0,
    StoryID: views.formInt(req, 'story_id'),
    Kind: views.field(req, 'kind') as Purchase['Kind'],
    ReceiptID: 0,
    BoughtOn: joinBoughtOn(views.field(req, 'bought_on'), views.field(req, 'bought_at')),
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
