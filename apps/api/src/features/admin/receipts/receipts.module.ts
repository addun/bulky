import { Module } from '@nestjs/common';
import { AliasesModule } from '#app/store/aliases';
import { LocationsModule } from '#app/store/locations';
import { ProductsModule } from '#app/store/products';
import { PurchasesModule } from '#app/store/purchases';
import { ReceiptsModule } from '#app/store/receipts';
import { SettingsModule } from '#app/store/settings';
import { UnitsModule } from '#app/store/units';
import { AdminReceiptsController } from './receipts.controller.js';
import { AdminReceiptsHandler } from './receipts.handler.js';

@Module({
  imports: [
    ReceiptsModule,
    UnitsModule,
    SettingsModule,
    LocationsModule,
    ProductsModule,
    AliasesModule,
    PurchasesModule,
  ],
  controllers: [AdminReceiptsController],
  providers: [AdminReceiptsHandler],
})
export class AdminReceiptsModule {}
