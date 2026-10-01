import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module.js';
import { SettingsModule } from '#app/store/settings';
import { UnitsRepository } from './units.repository.js';

@Module({
  imports: [DatabaseModule, SettingsModule],
  providers: [UnitsRepository],
  exports: [UnitsRepository],
})
export class UnitsModule {}
