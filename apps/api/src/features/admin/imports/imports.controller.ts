import { Body, Controller, Get, Post } from '@nestjs/common';
import type { z } from 'zod';
import { BiedronkaShopsImportRequest } from './contract/request.js';
import {
  type AdminBiedronkaImportedResponse,
  type AdminBiedronkaImportResponse,
  type AdminImportsResponse,
} from './contract/response.js';
import { AdminImportsHandler } from './imports.handler.js';

@Controller()
export class AdminImportsController {
  constructor(private readonly handler: AdminImportsHandler) {}

  @Get('/api/admin/imports')
  list(): AdminImportsResponse {
    return this.handler.list();
  }

  @Get('/api/admin/imports/biedronka')
  biedronka(): AdminBiedronkaImportResponse {
    return this.handler.biedronka();
  }

  @Post('/api/admin/imports/biedronka')
  importBiedronka(
    @Body({ schema: BiedronkaShopsImportRequest }) body: z.infer<typeof BiedronkaShopsImportRequest>,
  ): Promise<AdminBiedronkaImportedResponse> {
    return this.handler.importBiedronka(body);
  }
}
