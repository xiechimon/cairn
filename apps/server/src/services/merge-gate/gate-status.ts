import {
  MERGE_GATE_STATUS_CONTEXT,
  type MergePolicy,
  type MergeReadiness,
} from '@cairn/shared/merge-gate';
import type { GateGithubPort, GateRaw, GateStatusState } from './github-port.js';

export const GATE_STATUS_DESCRIPTION_MAX = 140;

export interface GateStatusValue {
  state: GateStatusState;
  description: string;
}

export type GateStatusPlan =
  | {
      write: false;
      reason: 'policy-human' | 'no-head' | 'checks-elsewhere' | 'current-unreadable' | 'unchanged';
    }
  | { write: true; sha: string; payload: GateStatusValue & { context: string } };

function capped(text: string): string {
  const chars = Array.from(text);
  return chars.length <= GATE_STATUS_DESCRIPTION_MAX
    ? text
    : `${chars.slice(0, GATE_STATUS_DESCRIPTION_MAX - 1).join('')}…`;
}

export function gateStatusFor(r: MergeReadiness): GateStatusValue {
  const [first, ...rest] = r.blockers;
  if (first === undefined) {
    const hex = r.patchDigest?.split(':')[1]?.slice(0, 12);
    return { state: 'success', description: hex ? `ready, patch ${hex}` : 'ready' };
  }
  return {
    state: r.blockers.some((b) => b.class !== 'transient') ? 'failure' : 'pending',
    description: capped(
      `${first.label} (${first.code})${rest.length > 0 ? ` +${rest.length}` : ''}`,
    ),
  };
}

export function planGateStatusWrite(input: {
  policy: MergePolicy;
  readiness: MergeReadiness;
  checksHeadSha: string | null;
  current: { state: string; description: string | null } | null | 'unreadable';
}): GateStatusPlan {
  const { readiness } = input;
  if (input.policy === 'human' || readiness.policy === 'human') {
    return { write: false, reason: 'policy-human' };
  }
  if (readiness.headSha === null) return { write: false, reason: 'no-head' };
  if (input.checksHeadSha !== readiness.headSha)
    return { write: false, reason: 'checks-elsewhere' };
  if (input.current === 'unreadable') return { write: false, reason: 'current-unreadable' };
  const value = gateStatusFor(readiness);
  if (input.current?.state === value.state && input.current.description === value.description) {
    return { write: false, reason: 'unchanged' };
  }
  return {
    write: true,
    sha: readiness.headSha,
    payload: {
      state: value.state,
      context: MERGE_GATE_STATUS_CONTEXT,
      description: value.description,
    },
  };
}

export async function writeGateStatus(
  port: GateGithubPort,
  plan: Extract<GateStatusPlan, { write: true }>,
): Promise<GateRaw> {
  try {
    return await port.createStatus(plan.sha, plan.payload);
  } catch {
    return { kind: 'failed', failure: { kind: 'network' } };
  }
}
