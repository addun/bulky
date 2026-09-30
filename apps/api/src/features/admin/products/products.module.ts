import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../db/database.module.js';
import { DatabaseService } from '../../../db/database.service.js';
import { DATABASE, type Database } from './database.js';
import { AdminProductsController } from './products.controller.js';
import { AdminProductsHandler } from './products.handler.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminProductsController],
  providers: [
    AdminProductsHandler,
    {
      provide: DATABASE,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService): Database => db.drizzle,
    },
  ],
})
export class AdminProductsModule {}
