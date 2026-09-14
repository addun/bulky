import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module';
import { LocationsModule } from '@app/store/locations';
import { PurchasesRepository } from './purchases.repository';

@Module({
  imports: [DatabaseModule, LocationsModule],
  providers: [PurchasesRepository],
  exports: [PurchasesRepository],
})
export class PurchasesModule {}
