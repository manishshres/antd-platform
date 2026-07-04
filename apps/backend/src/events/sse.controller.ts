import { Controller, Sse, MessageEvent, UseGuards } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUserPayload,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

@Controller('events')
export class SseController {
  private static eventsSubject = new Subject<{
    orgId: string;
    event: string;
    data: unknown;
  }>();

  @Sse('stream')
  @UseGuards(JwtAuthGuard)
  streamEvents(
    @CurrentUser() user: CurrentUserPayload,
  ): Observable<MessageEvent> {
    const orgId = user.organizationId;
    return SseController.eventsSubject.asObservable().pipe(
      filter((e) => e.orgId === orgId),
      map((e) => ({
        data: { event: e.event, payload: e.data },
      })),
    );
  }

  static emitToOrganization(orgId: string, eventName: string, data: unknown) {
    this.eventsSubject.next({ orgId, event: eventName, data });
  }
}
