import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module';
import { AliasesModule } from '@app/store/aliases';
import { LocationsModule } from '@app/store/locations';
import { ProductsModule } from '@app/store/products';
import { PurchasesModule } from '@app/store/purchases';
import { ReceiptsRepository } from './receipts.repository';

@Module({
  imports: [DatabaseModule, ProductsModule, AliasesModule, PurchasesModule, LocationsModule],
  providers: [ReceiptsRepository],
  exports: [ReceiptsRepository],
})
export class ReceiptsModule {}
