import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module';
import { UnitsRepository } from './units.repository';

@Module({
  imports: [DatabaseModule],
  providers: [UnitsRepository],
  exports: [UnitsRepository],
})
export class UnitsModule {}
