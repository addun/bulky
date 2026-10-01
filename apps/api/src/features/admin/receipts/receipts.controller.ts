import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { z } from 'zod';
import { Id, ReceiptFormRequest, ReceiptVisitRequest } from './contract/request.js';
import {
  type AdminReceiptConfirmedResponse,
  type AdminReceiptDeletedResponse,
  type AdminReceiptDetailResponse,
  type AdminReceiptDuplicatesResponse,
  type AdminReceiptEditResponse,
  type AdminReceiptIdResponse,
  type AdminReceiptsResponse,
} from './contract/response.js';
import { AdminReceiptsHandler } from './receipts.handler.js';

@Controller()
export class AdminReceiptsController {
  constructor(private readonly handler: AdminReceiptsHandler) {}

  @Get('/api/admin/receipts')
  list(): AdminReceiptsResponse {
    return this.handler.list();
  }

  @Get('/api/admin/receipts/duplicates')
  duplicates(): AdminReceiptDuplicatesResponse {
    return this.handler.duplicates();
  }

  @Post('/api/admin/receipts')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'bill', maxCount: 1 },
        { name: 'bill_camera', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 12 << 20 } },
    ),
  )
  upload(
    @UploadedFiles() files: { bill?: Express.Multer.File[]; bill_camera?: Express.Multer.File[] },
  ): Promise<AdminReceiptIdResponse> {
    return this.handler.upload(files);
  }

  @Get('/admin/receipts/:id/preview')
  preview(@Param('id', { schema: Id }) receiptId: number, @Res() res: Response): void {
    const path = this.handler.previewPath(receiptId);
    if (!path) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path);
  }

  @Get('/api/admin/receipts/:id')
  show(@Param('id', { schema: Id }) receiptId: number): AdminReceiptDetailResponse {
    return this.handler.show(receiptId);
  }

  @Get('/api/admin/receipts/:id/edit')
  edit(@Param('id', { schema: Id }) receiptId: number): AdminReceiptEditResponse {
    return this.handler.edit(receiptId);
  }

  @Patch('/api/admin/receipts/:id')
  updateVisit(
    @Param('id', { schema: Id }) receiptId: number,
    @Body({ schema: ReceiptVisitRequest }) body: z.infer<typeof ReceiptVisitRequest>,
  ): AdminReceiptIdResponse {
    return this.handler.updateVisit(receiptId, body);
  }

  @Post('/api/admin/receipts/:id/retry')
  retry(@Param('id', { schema: Id }) receiptId: number): Promise<AdminReceiptIdResponse> {
    return this.handler.retry(receiptId);
  }

  @Post('/api/admin/receipts/:id/confirm')
  confirm(
    @Param('id', { schema: Id }) receiptId: number,
    @Body({ schema: ReceiptFormRequest }) body: Record<string, string>,
  ): AdminReceiptConfirmedResponse {
    return this.handler.confirm(receiptId, body);
  }

  @Delete('/api/admin/receipts/:id')
  remove(@Param('id', { schema: Id }) receiptId: number): Promise<AdminReceiptDeletedResponse> {
    return this.handler.remove(receiptId);
  }
}
