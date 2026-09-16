import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module.js';
import { LocationsModule } from '#app/store/locations';
import { PurchasesRepository } from './purchases.repository.js';

@Module({
  imports: [DatabaseModule, LocationsModule],
  providers: [PurchasesRepository],
  exports: [PurchasesRepository],
})
export class PurchasesModule {}
