import { Module, Global } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { SseController } from './sse.controller';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [JwtModule, UsersModule],
  providers: [EventsGateway],
  controllers: [SseController],
  exports: [EventsGateway],
})
export class EventsModule {}
