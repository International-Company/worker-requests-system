import { RecipientStatus } from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';

export type WorkerAction = 'acknowledge' | 'complete';

export type TransitionDecision =
  | { kind: 'apply'; to: RecipientStatus }
  | { kind: 'noop' } // already in (or past) the requested state → idempotent success
  | { kind: 'reject'; code: ErrorCode };

/**
 * Pure state machine for worker actions — the single source of truth for what a
 * worker may do, used for both online clicks and replayed offline actions.
 *
 *   NEW ──acknowledge──▶ ACKNOWLEDGED ──complete──▶ COMPLETED
 *    │                        ▲                         │
 *    └──── cancel (manager) ──┼──▶ CANCELLED            │
 *                             └──── reopen (manager) ◀──┘
 *
 * Conflict policy for offline actions: the client sends the `stateVersion` it saw.
 * If the manager changed the state since (cancel / reopen bump the version), the stale
 * action is rejected (STALE_STATE) instead of overwriting the newer server state.
 * Replays of an action that already succeeded are harmless no-ops.
 */
export function decideTransition(
  action: WorkerAction,
  current: { status: RecipientStatus; stateVersion: number },
  baseStateVersion?: number,
): TransitionDecision {
  if (current.status === RecipientStatus.CANCELLED) return { kind: 'reject', code: 'REQUEST_CANCELLED' };

  if (action === 'acknowledge') {
    if (current.status === RecipientStatus.NEW) {
      if (baseStateVersion !== undefined && baseStateVersion !== current.stateVersion) {
        return { kind: 'reject', code: 'STALE_STATE' };
      }
      return { kind: 'apply', to: RecipientStatus.ACKNOWLEDGED };
    }
    // Already acknowledged or completed: replay / double tap.
    return { kind: 'noop' };
  }

  // complete
  switch (current.status) {
    case RecipientStatus.NEW:
      return { kind: 'reject', code: 'MUST_ACKNOWLEDGE_FIRST' };
    case RecipientStatus.ACKNOWLEDGED:
      if (baseStateVersion !== undefined && baseStateVersion !== current.stateVersion) {
        // e.g. the manager reopened the request after this offline "complete" was recorded
        return { kind: 'reject', code: 'STALE_STATE' };
      }
      return { kind: 'apply', to: RecipientStatus.COMPLETED };
    case RecipientStatus.COMPLETED:
      return { kind: 'noop' };
    default:
      return { kind: 'reject', code: 'STALE_STATE' };
  }
}
