import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { AdminAliasesHandler } from './aliases.handler.js';
import { AliasRequest, Id, ProductRefRequest } from './contract/request.js';
import {
  type AdminAliasDeletedResponse,
  type AdminAliasFormResponse,
  type AdminAliasResponse,
  type AdminAliasesResponse,
} from './contract/response.js';

@Controller()
export class AdminAliasesController {
  constructor(private readonly handler: AdminAliasesHandler) {}

  @Get('/api/admin/aliases')
  list(@Query({ schema: ProductRefRequest }) query: z.infer<typeof ProductRefRequest>): AdminAliasesResponse {
    return this.handler.list(query);
  }

  @Get('/api/admin/aliases/new')
  blank(@Query({ schema: ProductRefRequest }) query: z.infer<typeof ProductRefRequest>): AdminAliasFormResponse {
    return this.handler.blank(query);
  }

  @Get('/api/admin/aliases/:id')
  get(@Param('id', { schema: Id }) aliasId: number): AdminAliasFormResponse {
    return this.handler.get(aliasId);
  }

  @Post('/api/admin/aliases')
  create(@Body({ schema: AliasRequest }) body: z.infer<typeof AliasRequest>): AdminAliasResponse {
    return this.handler.create(body);
  }

  @Patch('/api/admin/aliases/:id')
  update(
    @Param('id', { schema: Id }) aliasId: number,
    @Body({ schema: AliasRequest }) body: z.infer<typeof AliasRequest>,
  ): AdminAliasResponse {
    return this.handler.update(aliasId, body);
  }

  @Delete('/api/admin/aliases/:id')
  remove(@Param('id', { schema: Id }) aliasId: number): AdminAliasDeletedResponse {
    return this.handler.remove(aliasId);
  }
}
