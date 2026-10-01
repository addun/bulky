import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { McpService } from '../mcp/mcp.service.js';
import { OcrService } from '../ocr/ocr.service.js';
import { ProductsModule } from '#app/store/products';
import { ReceiptsModule } from '#app/store/receipts';
import { SettingsModule } from '#app/store/settings';
import { ImagesService } from './images.service.js';
import { OcrQueueService } from './ocr-queue.service.js';
import { ReceiptImagesService } from './receipt-images.js';

@Global()
@Module({
  imports: [DatabaseModule, ProductsModule, ReceiptsModule, SettingsModule],
  providers: [OcrService, McpService, ImagesService, ReceiptImagesService, OcrQueueService],
  exports: [OcrService, McpService, ImagesService, ReceiptImagesService, OcrQueueService],
})
export class WebModule {}
