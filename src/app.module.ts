import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env';
import { DatabaseService } from './db/database.service';
import { StoreService } from './store/store.service';
import { OcrService } from './ocr/ocr.service';
import { McpService } from './mcp/mcp.service';
import { McpMiddleware } from './mcp/mcp.middleware';
import { ViewsService } from './web/views.service';
import { ImagesService } from './web/images.service';
import { ReceiptImagesService } from './web/receipt-images';
import { OcrQueueService } from './web/ocr-queue.service';
import { LookupController } from './web/lookup.controller';
import { CatalogController } from './web/catalog.controller';
import { ReceiptsController } from './web/receipts.controller';
import { BiedronkaController } from './web/biedronka.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
  ],
  controllers: [LookupController, CatalogController, ReceiptsController, BiedronkaController],
  providers: [
    DatabaseService,
    StoreService,
    OcrService,
    McpService,
    ViewsService,
    ImagesService,
    ReceiptImagesService,
    OcrQueueService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(McpMiddleware).forRoutes({ path: 'mcp', method: RequestMethod.ALL });
  }
}
