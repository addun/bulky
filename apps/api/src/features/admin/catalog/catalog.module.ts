import { Module } from '@nestjs/common';
import { ComparisonGroupsModule } from '#app/store/comparison-groups';
import { LocationsModule } from '#app/store/locations';
import { ProductsModule } from '#app/store/products';
import { PurchasesModule } from '#app/store/purchases';
import { UnitsModule } from '#app/store/units';
import { AdminCatalogController } from './catalog.controller.js';
import { AdminCatalogHandler } from './catalog.handler.js';

@Module({
  imports: [ProductsModule, UnitsModule, ComparisonGroupsModule, PurchasesModule, LocationsModule],
  controllers: [AdminCatalogController],
  providers: [AdminCatalogHandler],
})
export class AdminCatalogModule {}
