import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningProcessor } from './provisioning.processor';
import { TelnyxModule } from '../telnyx/telnyx.module';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'provisioning-queue',
    }),
    BullModule.registerQueue({
      name: 'import-queue',
    }),
    TelnyxModule,
    InvitationsModule,
  ],
  controllers: [ProvisioningController],
  providers: [ProvisioningService, ProvisioningProcessor],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
