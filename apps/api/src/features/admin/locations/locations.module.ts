import { Module } from '@nestjs/common';
import { LocationsModule } from '#app/store/locations';
import { AdminLocationsController } from './locations.controller.js';
import { AdminLocationsHandler } from './locations.handler.js';

@Module({
  imports: [LocationsModule],
  controllers: [AdminLocationsController],
  providers: [AdminLocationsHandler],
})
export class AdminLocationsModule {}
