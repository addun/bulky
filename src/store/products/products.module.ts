import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module';
import { AliasesModule } from '@app/store/aliases';
import { ComparisonGroupsModule } from '@app/store/comparison-groups';
import { LocationsModule } from '@app/store/locations';
import { PurchasesModule } from '@app/store/purchases';
import { UnitsModule } from '@app/store/units';
import { ProductsRepository } from './products.repository';

@Module({
  imports: [DatabaseModule, UnitsModule, AliasesModule, PurchasesModule, ComparisonGroupsModule, LocationsModule],
  providers: [ProductsRepository],
  exports: [ProductsRepository],
})
export class ProductsModule {}
