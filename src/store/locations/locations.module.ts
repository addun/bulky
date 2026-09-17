import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module.js';
import { LocationsRepository } from './locations.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [LocationsRepository],
  exports: [LocationsRepository],
})
export class LocationsModule {}
