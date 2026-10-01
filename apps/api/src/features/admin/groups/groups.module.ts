import { Module } from '@nestjs/common';
import { ComparisonGroupsModule } from '#app/store/comparison-groups';
import { ProductsModule } from '#app/store/products';
import { UnitsModule } from '#app/store/units';
import { AdminGroupsController } from './groups.controller.js';
import { AdminGroupsHandler } from './groups.handler.js';

@Module({
  imports: [ComparisonGroupsModule, UnitsModule, ProductsModule],
  controllers: [AdminGroupsController],
  providers: [AdminGroupsHandler],
})
export class AdminGroupsModule {}
