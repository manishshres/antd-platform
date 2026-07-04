import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [InvitationsModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
