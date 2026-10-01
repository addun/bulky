import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../db/database.module.js';
import { DatabaseService } from '../../../db/database.service.js';
import { DATABASE, type Database } from './database.js';
import { AdminSettingsController } from './settings.controller.js';
import { AdminSettingsHandler } from './settings.handler.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminSettingsController],
  providers: [
    AdminSettingsHandler,
    {
      provide: DATABASE,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService): Database => db.drizzle,
    },
  ],
})
export class AdminSettingsModule {}
