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
  SettingsModule,
  UnitsModule,
} from '#app/store';
import { McpMiddleware } from './mcp/mcp.middleware.js';
import { HealthController } from './health.controller.js';
import { LookupController } from './web/lookup.controller.js';
import { BiedronkaController } from './web/biedronka.controller.js';
import { WebModule } from './web/web.module.js';
import { AdminProductsModule } from './features/admin/products/products.module.js';
import { AdminSettingsModule } from './features/admin/settings/settings.module.js';
import { AdminUnitsModule } from './features/admin/units/units.module.js';
import { AdminLocationsModule } from './features/admin/locations/locations.module.js';
import { AdminAliasesModule } from './features/admin/aliases/aliases.module.js';
import { AdminGroupsModule } from './features/admin/groups/groups.module.js';
import { AdminCatalogModule } from './features/admin/catalog/catalog.module.js';
import { AdminReceiptsModule } from './features/admin/receipts/receipts.module.js';
import { AdminImportsModule } from './features/admin/imports/imports.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
    DatabaseModule,
    WebModule,
    UnitsModule,
    LocationsModule,
    AliasesModule,
    PurchasesModule,
    ComparisonGroupsModule,
    ProductsModule,
    ReceiptsModule,
    SettingsModule,
    AdminProductsModule,
    AdminSettingsModule,
    AdminUnitsModule,
    AdminLocationsModule,
    AdminAliasesModule,
    AdminGroupsModule,
    AdminCatalogModule,
    AdminReceiptsModule,
    AdminImportsModule,
  ],
  controllers: [HealthController, LookupController, BiedronkaController],
  providers: [McpMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(McpMiddleware).forRoutes({ path: 'mcp', method: RequestMethod.ALL });
  }
}
