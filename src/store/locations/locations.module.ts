import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module';
import { LocationsRepository } from './locations.repository';

@Module({
  imports: [DatabaseModule],
  providers: [LocationsRepository],
  exports: [LocationsRepository],
})
export class LocationsModule {}
