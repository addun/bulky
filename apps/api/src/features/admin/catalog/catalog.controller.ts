import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { z } from 'zod';
import { AdminCatalogHandler } from './catalog.handler.js';
import { Id, MergeRequest, ProductRequest, PurchaseRequest, UnitIdRequest } from './contract/request.js';
import {
  type AdminCatalogBlankResponse,
  type AdminCatalogChangeUnitResponse,
  type AdminCatalogIdResponse,
  type AdminCatalogMergeOptionsResponse,
  type AdminCatalogMergePlanResponse,
  type AdminCatalogOkResponse,
  type AdminCatalogPurchaseDeletedResponse,
  type AdminCatalogPurchaseFormResponse,
  type AdminCatalogPurchaseResponse,
  type AdminCatalogPurchaseUpdatedResponse,
  type AdminCatalogShowResponse,
} from './contract/response.js';

@Controller()
export class AdminCatalogController {
  constructor(private readonly handler: AdminCatalogHandler) {}

  @Get('/api/admin/products/new')
  blank(): AdminCatalogBlankResponse {
    return this.handler.blank();
  }

  @Get('/api/admin/products/:id')
  show(@Param('id', { schema: Id }) productId: number): AdminCatalogShowResponse {
    return this.handler.show(productId);
  }

  @Get('/api/admin/products/:id/edit')
  edit(@Param('id', { schema: Id }) productId: number): AdminCatalogBlankResponse {
    return this.handler.edit(productId);
  }

  @Post('/api/admin/products')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 6 << 20 } }))
  create(
    @Body({ schema: ProductRequest }) body: z.infer<typeof ProductRequest>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AdminCatalogIdResponse> {
    return this.handler.create(body, file);
  }

  @Patch('/api/admin/products/:id')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 6 << 20 } }))
  update(
    @Param('id', { schema: Id }) productId: number,
    @Body({ schema: ProductRequest }) body: z.infer<typeof ProductRequest>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AdminCatalogIdResponse> {
    return this.handler.update(productId, body, file);
  }

  @Delete('/api/admin/products/:id')
  remove(@Param('id', { schema: Id }) productId: number): AdminCatalogOkResponse {
    return this.handler.remove(productId);
  }

  @Get('/api/admin/products/:id/change-unit')
  changeUnitForm(@Param('id', { schema: Id }) productId: number): AdminCatalogChangeUnitResponse {
    return this.handler.changeUnitForm(productId);
  }

  @Post('/api/admin/products/:id/change-unit')
  changeUnit(
    @Param('id', { schema: Id }) productId: number,
    @Body({ schema: UnitIdRequest }) body: z.infer<typeof UnitIdRequest>,
  ): AdminCatalogIdResponse {
    return this.handler.changeUnit(productId, body);
  }

  @Get('/api/admin/products/:id/merge')
  mergeOptions(@Param('id', { schema: Id }) productId: number): AdminCatalogMergeOptionsResponse {
    return this.handler.mergeOptions(productId);
  }

  @Get('/api/admin/products/:id/merge/:into')
  mergePlan(
    @Param('id', { schema: Id }) productId: number,
    @Param('into', { schema: Id }) intoId: number,
  ): AdminCatalogMergePlanResponse {
    return this.handler.mergePlan(productId, intoId);
  }

  @Post('/api/admin/products/:id/merge')
  merge(
    @Param('id', { schema: Id }) productId: number,
    @Body({ schema: MergeRequest }) body: z.infer<typeof MergeRequest>,
  ): AdminCatalogIdResponse {
    return this.handler.merge(productId, body);
  }

  @Get('/api/admin/products/:id/purchases/new')
  newPurchase(@Param('id', { schema: Id }) productId: number): AdminCatalogPurchaseFormResponse {
    return this.handler.newPurchase(productId);
  }

  @Post('/api/admin/products/:id/purchases')
  createPurchase(
    @Param('id', { schema: Id }) productId: number,
    @Body({ schema: PurchaseRequest }) body: z.infer<typeof PurchaseRequest>,
  ): AdminCatalogPurchaseResponse {
    return this.handler.createPurchase(productId, body);
  }

  @Get('/api/admin/purchases/:id')
  purchase(@Param('id', { schema: Id }) purchaseId: number): AdminCatalogPurchaseFormResponse {
    return this.handler.purchase(purchaseId);
  }

  @Patch('/api/admin/purchases/:id')
  updatePurchase(
    @Param('id', { schema: Id }) purchaseId: number,
    @Body({ schema: PurchaseRequest }) body: z.infer<typeof PurchaseRequest>,
  ): AdminCatalogPurchaseUpdatedResponse {
    return this.handler.updatePurchase(purchaseId, body);
  }

  @Delete('/api/admin/purchases/:id')
  removePurchase(@Param('id', { schema: Id }) purchaseId: number): AdminCatalogPurchaseDeletedResponse {
    return this.handler.removePurchase(purchaseId);
  }
}
