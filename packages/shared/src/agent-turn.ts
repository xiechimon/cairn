import { COORDINATOR_COMPACT_AT } from './agent-backend.js';
import { isChiefConversationId } from './records/chief.js';
import type { StepKind } from './records/step.js';

export type AgentTurnKind = 'coordinator' | 'task';

export function agentTurnKindOf(stepKind: StepKind, conversationId: string): AgentTurnKind {
  return stepKind === 'chief' && isChiefConversationId(conversationId) ? 'coordinator' : 'task';
}

export interface TurnHeartbeatHandle {
  stop(): void;
}

export interface TurnHeartbeatOptions {
  readonly intervalMs: number;
  readonly beat: () => Promise<void> | void;
  readonly onError?: (error: unknown) => void;
  readonly unref?: boolean;
}

export function startTurnHeartbeat(opts: TurnHeartbeatOptions): TurnHeartbeatHandle {
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void Promise.resolve()
      .then(() => opts.beat())
      .catch((error: unknown) => {
        opts.onError?.(error);
      })
      .finally(() => {
        inFlight = false;
      });
  }, opts.intervalMs);
  if (opts.unref && typeof timer.unref === 'function') timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export interface AgentTurnPolicy {
  readonly kind: AgentTurnKind;
  readonly compactAt?: number;
  readonly readOnly: boolean;
  readonly lockedDown: boolean;
  readonly remoteToolsOnly: boolean;
  readonly allowSkillLists: boolean;
}

export function agentTurnPolicyFor(opts: {
  stepKind: StepKind;
  conversationId: string;
  isReview?: boolean;
  readOnly?: boolean;
  remoteToolsOnly?: boolean;
}): AgentTurnPolicy {
  const kind = agentTurnKindOf(opts.stepKind, opts.conversationId);
  const readOnly = Boolean(opts.isReview || opts.readOnly);
  const remoteToolsOnly = Boolean(opts.remoteToolsOnly);
  return {
    kind,
    ...(kind === 'coordinator' ? { compactAt: COORDINATOR_COMPACT_AT } : {}),
    readOnly,
    lockedDown: kind === 'coordinator' || Boolean(opts.isReview) || remoteToolsOnly,
    remoteToolsOnly,
    allowSkillLists: kind !== 'coordinator',
  };
}
