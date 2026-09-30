import { Controller, Get, Query } from '@nestjs/common';
import type { z } from 'zod';
import { GetAdminProductsRequest } from './contract/request.js';
import { type AdminProductsResponse } from './contract/response.js';
import { AdminProductsHandler } from './products.handler.js';

@Controller()
export class AdminProductsController {
  constructor(private readonly handler: AdminProductsHandler) {}

  @Get('/api/admin/products.json')
  list(
    @Query({ schema: GetAdminProductsRequest }) query: z.infer<typeof GetAdminProductsRequest>,
  ): AdminProductsResponse {
    return this.handler.list(query);
  }
}
