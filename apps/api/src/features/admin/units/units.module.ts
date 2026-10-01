import { Module } from '@nestjs/common';
import { UnitsModule } from '#app/store/units';
import { AdminUnitsController } from './units.controller.js';
import { AdminUnitsHandler } from './units.handler.js';

@Module({
  imports: [UnitsModule],
  controllers: [AdminUnitsController],
  providers: [AdminUnitsHandler],
})
export class AdminUnitsModule {}
