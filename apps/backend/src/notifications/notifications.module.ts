import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { TelnyxModule } from '../telnyx/telnyx.module';

@Global()
@Module({
  imports: [TelnyxModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
