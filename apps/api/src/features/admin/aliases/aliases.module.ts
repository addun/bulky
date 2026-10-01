import { Module } from '@nestjs/common';
import { AliasesModule } from '#app/store/aliases';
import { LocationsModule } from '#app/store/locations';
import { ProductsModule } from '#app/store/products';
import { AdminAliasesController } from './aliases.controller.js';
import { AdminAliasesHandler } from './aliases.handler.js';

@Module({
  imports: [AliasesModule, ProductsModule, LocationsModule],
  controllers: [AdminAliasesController],
  providers: [AdminAliasesHandler],
})
export class AdminAliasesModule {}
