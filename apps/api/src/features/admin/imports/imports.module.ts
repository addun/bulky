import { Module } from '@nestjs/common';
import { LocationsModule } from '#app/store/locations';
import { AdminImportsController } from './imports.controller.js';
import { AdminImportsHandler } from './imports.handler.js';

@Module({
  imports: [LocationsModule],
  controllers: [AdminImportsController],
  providers: [AdminImportsHandler],
})
export class AdminImportsModule {}
