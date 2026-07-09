import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';

/**
 * Owns the OnApplicationBootstrap seeding hook. Kept separate from DatabaseModule
 * so DatabaseModule never imports SeedService — SeedService imports the DRIZZLE
 * token from DatabaseModule, and registering it there created a value-level
 * circular import (DRIZZLE resolved to undefined at DI time). DRIZZLE and
 * ConfigService are both global, so SeedService resolves them without extra imports.
 */
@Module({
  providers: [SeedService],
})
export class SeedModule {}
