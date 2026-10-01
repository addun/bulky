import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module.js';
import { SettingsRepository } from './settings.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [SettingsRepository],
  exports: [SettingsRepository],
})
export class SettingsModule {}
