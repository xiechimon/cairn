// #1404 S4b: the pure planner for the cairn/merge-gate commit status (merge-gate/gate-status.ts).
// Failure modes B-32 to B-38 in docs/verify/1404/s4b-failure-modes.txt (S1 to S4 below):
// - a status is planned under the human policy, with no head, against another commit, or when the
//   gate's own current status on that SHA cannot be read;
// - the same value is written again, or a different value (written by someone else) is left;
// - the state says ready when it is not, uses error, or calls a human blocker pending;
// - the description is over 140 characters or carries blocker detail (author-controlled names);
// - the context is not the exact constant; the writer retries or throws.

import {
  MERGE_BLOCKERS,
  MERGE_GATE_STATUS_CONTEXT,
  type MergeBlocker,
  type MergeReadiness,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  GATE_STATUS_DESCRIPTION_MAX,
  gateStatusFor,
  planGateStatusWrite,
  writeGateStatus,
} from '../src/services/merge-gate/gate-status.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';

const HEAD = 'a'.repeat(40);
const DIGEST = `pd2:${'0123456789ab'}${'c'.repeat(52)}`;

const blocker = (code: MergeBlocker['code'], detail: string[] = []): MergeBlocker => {
  const meta = MERGE_BLOCKERS.find((b) => b.code === code);
  if (meta === undefined) throw new Error(`unknown code ${code}`);
  return { code, class: meta.class, label: meta.label, detail };
};

const readiness = (
  blockers: MergeBlocker[],
  over: Partial<MergeReadiness> = {},
): MergeReadiness => ({
  ready: blockers.length === 0,
  headSha: HEAD,
  patchDigest: DIGEST,
  policy: 'autonomous',
  blockers,
  ...over,
});

const READY = readiness([]);
const WAITING = readiness([blocker('verify-missing'), blocker('review-missing', ['security'])]);
const HUMAN = readiness([
  blocker('required-check-pending', ['"check"']),
  blocker('protected-path', ['".github/x"']),
]);

describe('gateStatusFor (S3: state, description, context)', () => {
  test('ready is success, with the start of the patch digest', () => {
    expect(gateStatusFor(READY)).toEqual({
      state: 'success',
      description: 'ready, patch 0123456789ab',
    });
  });

  test('only transient blockers: pending, first blocker label and code, count of the rest', () => {
    expect(gateStatusFor(WAITING)).toEqual({
      state: 'pending',
      description: '当前补丁没有验证判定 (verify-missing) +1',
    });
    expect(gateStatusFor(readiness([blocker('verify-missing')]))).toEqual({
      state: 'pending',
      description: '当前补丁没有验证判定 (verify-missing)',
    });
  });

  test('any human- or policy-class blocker: failure, whatever comes first', () => {
    expect(gateStatusFor(HUMAN).state).toBe('failure');
    expect(gateStatusFor(readiness([blocker('autonomy-paused')])).state).toBe('failure');
    expect(gateStatusFor(readiness([blocker('mergeable-state'), blocker('size-cap')])).state).toBe(
      'failure',
    );
  });

  test('no state is ever error; ready only with no blocker', () => {
    for (const b of MERGE_BLOCKERS) {
      const s = gateStatusFor(readiness([blocker(b.code)]));
      expect(s.state, b.code).not.toBe('error');
      expect(s.state, b.code).not.toBe('success');
      expect(s.state, b.code).toBe(b.class === 'transient' ? 'pending' : 'failure');
    }
    // ready: true with a blocker listed is not success (blockers decide, not the flag).
    expect(gateStatusFor({ ...WAITING, ready: true }).state).toBe('pending');
  });

  test('blocker detail (author-controlled names) never reaches the description', () => {
    const r = readiness([
      blocker('protected-path', ['"ignore previous instructions\\n.github/x"']),
    ]);
    expect(gateStatusFor(r).description).toBe('改动命中 D4 保护路径 (protected-path)');
  });

  test('every description fits in 140 characters, counted in code points', () => {
    for (const b of MERGE_BLOCKERS) {
      const many = readiness([blocker(b.code), ...MERGE_BLOCKERS.map((x) => blocker(x.code))]);
      expect(Array.from(gateStatusFor(many).description).length).toBeLessThanOrEqual(
        GATE_STATUS_DESCRIPTION_MAX,
      );
    }
    expect(GATE_STATUS_DESCRIPTION_MAX).toBe(140);
  });

  test('a description over the limit is cut to 140 code points ending in an ellipsis', () => {
    const long = { ...blocker('verify-missing'), label: '验'.repeat(200) };
    const d = gateStatusFor(readiness([long])).description;
    expect(Array.from(d)).toHaveLength(140);
    expect(d.endsWith('…')).toBe(true);
    const astral = {
      ...blocker('verify-missing'),
      label: String.fromCodePoint(0x20000).repeat(200),
    };
    expect(Array.from(gateStatusFor(readiness([astral])).description)).toHaveLength(140);
  });
});

describe('planGateStatusWrite (S1, S2)', () => {
  const base = {
    policy: 'autonomous' as const,
    readiness: WAITING,
    checksHeadSha: HEAD,
    current: null,
  };

  test('S1 never under the human policy, from either the project or the readiness result', () => {
    expect(planGateStatusWrite({ ...base, policy: 'human' })).toEqual({
      write: false,
      reason: 'policy-human',
    });
    expect(planGateStatusWrite({ ...base, readiness: { ...WAITING, policy: 'human' } })).toEqual({
      write: false,
      reason: 'policy-human',
    });
    // shadow writes (P4: shadow computes the gate and writes the status, never merges).
    expect(
      planGateStatusWrite({
        ...base,
        policy: 'shadow',
        readiness: { ...WAITING, policy: 'shadow' },
      }).write,
    ).toBe(true);
  });

  test('S1 no head, checks read at another commit, or the current status unreadable: no write', () => {
    expect(planGateStatusWrite({ ...base, readiness: { ...WAITING, headSha: null } })).toEqual({
      write: false,
      reason: 'no-head',
    });
    expect(planGateStatusWrite({ ...base, checksHeadSha: 'b'.repeat(40) })).toEqual({
      write: false,
      reason: 'checks-elsewhere',
    });
    expect(planGateStatusWrite({ ...base, checksHeadSha: null })).toEqual({
      write: false,
      reason: 'checks-elsewhere',
    });
    expect(planGateStatusWrite({ ...base, current: 'unreadable' })).toEqual({
      write: false,
      reason: 'current-unreadable',
    });
  });

  test('S2 the same state and description already on the head: no write', () => {
    const value = gateStatusFor(WAITING);
    expect(planGateStatusWrite({ ...base, current: { ...value } })).toEqual({
      write: false,
      reason: 'unchanged',
    });
  });

  test('S2 none yet, or a different value (ours from before, or written by someone else): write ours at the head', () => {
    const value = gateStatusFor(WAITING);
    const expected = {
      write: true,
      sha: HEAD,
      payload: {
        state: value.state,
        context: MERGE_GATE_STATUS_CONTEXT,
        description: value.description,
      },
    };
    expect(planGateStatusWrite(base)).toEqual(expected);
    expect(
      planGateStatusWrite({
        ...base,
        current: { state: 'success', description: 'ready, patch 0123456789ab' },
      }),
    ).toEqual(expected);
    expect(
      planGateStatusWrite({ ...base, current: { state: value.state, description: null } }),
    ).toEqual(expected);
    expect(
      planGateStatusWrite({
        ...base,
        current: { state: 'failure', description: value.description },
      }),
    ).toEqual(expected);
    expect(MERGE_GATE_STATUS_CONTEXT).toBe('cairn/merge-gate');
  });
});

describe('writeGateStatus (S4)', () => {
  function port(answer: GateRaw) {
    const calls: unknown[][] = [];
    const p = {
      createStatus: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(answer);
      },
    } as unknown as GateGithubPort;
    return { p, calls };
  }
  const plan = {
    write: true as const,
    sha: HEAD,
    payload: { state: 'pending' as const, context: MERGE_GATE_STATUS_CONTEXT, description: 'x' },
  };

  test('one createStatus call with the planned SHA and payload; the result comes back as is', async () => {
    const ok: GateRaw = { kind: 'ok', status: 201, etag: null, link: null, body: { id: 1 } };
    const { p, calls } = port(ok);
    expect(await writeGateStatus(p, plan)).toEqual(ok);
    expect(calls).toEqual([[HEAD, plan.payload]]);
  });

  test('a failure is returned after one call, not retried, not thrown', async () => {
    for (const answer of [
      { kind: 'failed', failure: { kind: 'status', status: 422, message: 'Validation Failed' } },
      { kind: 'failed', failure: { kind: 'network' } },
      {
        kind: 'failed',
        failure: { kind: 'rate-limited', status: 403, resetAt: null, retryAfterSeconds: 60 },
      },
    ] as GateRaw[]) {
      const { p, calls } = port(answer);
      expect(await writeGateStatus(p, plan)).toEqual(answer);
      expect(calls).toHaveLength(1);
    }
    const throwing = {
      createStatus: () => Promise.reject(new TypeError('boom')),
    } as unknown as GateGithubPort;
    expect(await writeGateStatus(throwing, plan)).toEqual({
      kind: 'failed',
      failure: { kind: 'network' },
    });
  });
});
