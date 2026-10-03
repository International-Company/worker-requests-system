import { RecipientStatus } from '@prisma/client';
import { decideTransition } from './recipient-transitions';

const s = (status: RecipientStatus, stateVersion = 1) => ({ status, stateVersion });

describe('decideTransition (worker state machine)', () => {
  it('NEW → acknowledge applies', () => {
    expect(decideTransition('acknowledge', s('NEW'))).toEqual({ kind: 'apply', to: 'ACKNOWLEDGED' });
    expect(decideTransition('acknowledge', s('NEW', 1), 1)).toEqual({ kind: 'apply', to: 'ACKNOWLEDGED' });
  });

  it('complete before acknowledge is rejected', () => {
    expect(decideTransition('complete', s('NEW'))).toEqual({ kind: 'reject', code: 'MUST_ACKNOWLEDGE_FIRST' });
  });

  it('ACKNOWLEDGED → complete applies', () => {
    expect(decideTransition('complete', s('ACKNOWLEDGED', 2), 2)).toEqual({ kind: 'apply', to: 'COMPLETED' });
  });

  it('replays are idempotent no-ops', () => {
    expect(decideTransition('acknowledge', s('ACKNOWLEDGED', 2), 1)).toEqual({ kind: 'noop' });
    expect(decideTransition('acknowledge', s('COMPLETED', 3), 1)).toEqual({ kind: 'noop' });
    expect(decideTransition('complete', s('COMPLETED', 3), 2)).toEqual({ kind: 'noop' });
  });

  it('nothing is allowed on a cancelled request', () => {
    expect(decideTransition('acknowledge', s('CANCELLED'))).toEqual({ kind: 'reject', code: 'REQUEST_CANCELLED' });
    expect(decideTransition('complete', s('CANCELLED'))).toEqual({ kind: 'reject', code: 'REQUEST_CANCELLED' });
  });

  it('a stale offline complete (manager reopened since) is rejected', () => {
    // completed at v3, reopened → ACKNOWLEDGED v4; an old queued complete based on v2 arrives
    expect(decideTransition('complete', s('ACKNOWLEDGED', 4), 2)).toEqual({ kind: 'reject', code: 'STALE_STATE' });
  });

  it('without a base version (online click) the current state decides', () => {
    expect(decideTransition('complete', s('ACKNOWLEDGED', 4))).toEqual({ kind: 'apply', to: 'COMPLETED' });
  });
});
