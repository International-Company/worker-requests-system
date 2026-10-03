import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';

export type LiveEventType =
  | 'request.created'
  | 'request.updated'
  | 'request.cancelled'
  | 'recipient.updated'
  | 'presence.updated'
  | 'worker.updated';

export interface LiveEvent {
  type: LiveEventType;
  /** Manager who owns the request (null = staff-wide event such as presence). */
  managerId: string | null;
  data: Record<string, unknown>;
}

/**
 * In-process event bus feeding the dashboard Server-Sent-Events stream.
 * Railway runs a single backend instance; if you scale horizontally, replace the
 * Subject with Postgres LISTEN/NOTIFY or Redis pub/sub (interface stays the same).
 */
@Injectable()
export class EventsService {
  private readonly bus = new Subject<LiveEvent>();

  emit(event: LiveEvent): void {
    this.bus.next(event);
  }

  /** Admins see all events; managers only their own requests + staff-wide events. */
  streamFor(user: { id: string; role: string }): Observable<{ type: string; data: Record<string, unknown> }> {
    return this.bus.pipe(
      filter((e) => user.role === 'SYSTEM_ADMIN' || e.managerId === null || e.managerId === user.id),
      map((e) => ({ type: e.type, data: e.data })),
    );
  }
}
