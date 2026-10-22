// pacman/merge-gate commit status 的纯规划（#1404 S4b，计划 docs/verify/1404/s4-plan.md §4.6）：
// 由 readiness 的结果定 state 与描述，再决定这一次写不写。写的时机、按团队限速与调度归 S7；
// 这里只保证：human 策略下永远不写；只写在 readiness 的 head 上，且检查（含 combined status）
// 就是在那个 head 上读的；head 上自家 status 读不到时不盲写；值没变不写（对照的是 GitHub 上
// 那个 SHA 的当前值，别人写的不同的值下次求值时改回来）。描述不带 blocker 的 detail（文件名、
// 检查名由 PR 作者或第三方起），至多 140 个字符（GitHub 文档没写上限，第三方实测 140）。

import { MERGE_GATE_STATUS_CONTEXT, type MergePolicy, type MergeReadiness } from '@pacman/shared';
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

/** 按码位截到上限，截了的末尾记 …。 */
function capped(text: string): string {
  const chars = Array.from(text);
  return chars.length <= GATE_STATUS_DESCRIPTION_MAX
    ? text
    : `${chars.slice(0, GATE_STATUS_DESCRIPTION_MAX - 1).join('')}…`;
}

/** ready（没有 blocker）= success；有 human 或 policy 类 blocker = failure；只有 transient 的 =
 * pending。从不写 error。描述 = 首个 blocker 的文案与码，再加其余几个；ready 时带摘要开头。 */
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
  /** 这次检查（check runs 与 combined status）是在哪个 SHA 上读的；没读到 = null。 */
  checksHeadSha: string | null;
  /** 那个 SHA 上自家 status 的当前值（GateGithubFacts.ownStatus）。 */
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

/** 按计划写一次；失败原样交回，不重试；端口抛错按网络错。 */
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
