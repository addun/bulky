import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module.js';
import { UnitsRepository } from './units.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [UnitsRepository],
  exports: [UnitsRepository],
})
export class UnitsModule {}
