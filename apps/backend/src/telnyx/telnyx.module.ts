import { Module, Global } from '@nestjs/common';
import { TelnyxService } from './telnyx.service';
import { TelnyxController } from './telnyx.controller';

@Global()
@Module({
  controllers: [TelnyxController],
  providers: [TelnyxService],
  exports: [TelnyxService],
})
export class TelnyxModule {}
