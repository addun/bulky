import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.js';
import { DatabaseModule } from './db/database.module.js';
import {
  AliasesModule,
  ComparisonGroupsModule,
  LocationsModule,
  ProductsModule,
  PurchasesModule,
  ReceiptsModule,
  UnitsModule,
} from '#app/store';
import { OcrService } from './ocr/ocr.service.js';
import { McpService } from './mcp/mcp.service.js';
import { McpMiddleware } from './mcp/mcp.middleware.js';
import { ViewsService } from './web/views.service.js';
import { ImagesService } from './web/images.service.js';
import { ReceiptImagesService } from './web/receipt-images.js';
import { OcrQueueService } from './web/ocr-queue.service.js';
import { LookupController } from './web/lookup.controller.js';
import { CatalogController } from './web/catalog.controller.js';
import { ReceiptsController } from './web/receipts.controller.js';
import { BiedronkaController } from './web/biedronka.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
    DatabaseModule,
    UnitsModule,
    LocationsModule,
    AliasesModule,
    PurchasesModule,
    ComparisonGroupsModule,
    ProductsModule,
    ReceiptsModule,
  ],
  controllers: [LookupController, CatalogController, ReceiptsController, BiedronkaController],
  providers: [
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
