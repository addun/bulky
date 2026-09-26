import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module.js';
import { AliasesModule } from '#app/store/aliases';
import { LocationsModule } from '#app/store/locations';
import { ProductsModule } from '#app/store/products';
import { PurchasesModule } from '#app/store/purchases';
import { ReceiptsRepository } from './receipts.repository.js';

@Module({
  imports: [DatabaseModule, ProductsModule, AliasesModule, PurchasesModule, LocationsModule],
  providers: [ReceiptsRepository],
  exports: [ReceiptsRepository],
})
export class ReceiptsModule {}
