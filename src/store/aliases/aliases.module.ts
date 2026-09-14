import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../db/database.module';
import { LocationsModule } from '@app/store/locations';
import { AliasesRepository } from './aliases.repository';

@Module({
  imports: [DatabaseModule, LocationsModule],
  providers: [AliasesRepository],
  exports: [AliasesRepository],
})
export class AliasesModule {}
