import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { interval, map, merge, Observable } from 'rxjs';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { EventsService } from './events.service';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Live updates for the dashboard (fetch-based SSE client sends the Bearer token).
   * A comment-like ping every 25s keeps proxies from closing the idle connection.
   */
  @Sse('stream')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const ping = interval(25_000).pipe(map(() => ({ type: 'ping', data: {} }) as MessageEvent));
    const events = this.events.streamFor(user).pipe(map((e) => ({ type: e.type, data: e.data }) as MessageEvent));
    return merge(events, ping);
  }
}
