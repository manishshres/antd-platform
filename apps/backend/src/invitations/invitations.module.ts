import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { UsersModule } from '../users/users.module';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';

import { AdminInvitationsController } from './admin-invitations.controller';

@Module({
  imports: [UsersModule, CommonModule, AuthModule],
  controllers: [InvitationsController, AdminInvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
