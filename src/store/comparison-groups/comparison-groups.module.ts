import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module.js';
import { PurchasesModule } from '#app/store/purchases';
import { UnitsModule } from '#app/store/units';
import { ComparisonGroupsRepository } from './comparison-groups.repository.js';

@Module({
  imports: [DatabaseModule, UnitsModule, PurchasesModule],
  providers: [ComparisonGroupsRepository],
  exports: [ComparisonGroupsRepository],
})
export class ComparisonGroupsModule {}
