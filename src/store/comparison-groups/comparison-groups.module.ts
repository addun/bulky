import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module';
import { PurchasesModule } from '@app/store/purchases';
import { UnitsModule } from '@app/store/units';
import { ComparisonGroupsRepository } from './comparison-groups.repository';

@Module({
  imports: [DatabaseModule, UnitsModule, PurchasesModule],
  providers: [ComparisonGroupsRepository],
  exports: [ComparisonGroupsRepository],
})
export class ComparisonGroupsModule {}
