import { z } from 'zod';
import type { StepKind } from './records/step.js';
import type { TaskRequest } from './records/task-request.js';
import { isBannedModelId } from './tier-selection.js';

export const DIFFICULTIES = ['easy', 'standard', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type CandidateHarness = 'claude-code' | 'pi' | 'devin' | 'antigravity' | 'doubao';
export type CandidateRejection = 'harness-missing' | 'unavailable' | 'quota' | 'no-candidate';

export interface CapabilityCandidate {
  harness: CandidateHarness;
  provider: string;
  modelId: string;
  machineId: string;
  available: boolean;
  unavailableWhy?: 'harness-missing';
  weeklyUsedPercent: number | null;
}

export interface RouteWorkRequest {
  kind: StepKind;
  difficulty: Difficulty;
  inFlight?: { provider: string; modelId: string; machineId: string | null };
}

export const routeRejectionSchema = z.object({
  modelId: z.string(),
  machineId: z.string().nullable(),
  why: z.enum(['harness-missing', 'unavailable', 'quota', 'no-candidate']),
});
export type RouteRejection = z.infer<typeof routeRejectionSchema>;

export interface RouteChoice {
  harness: CandidateHarness;
  provider: string;
  modelId: string;
  machineId: string | null;
}

export interface RouteWorkDecision {
  chosen: RouteChoice | null;
  desired?: { provider: string; modelId: string } | null;
  fellBack?: boolean;
  difficulty: Difficulty;
  reason: string;
  rejected: RouteRejection[];
}

export const CODEX_MODEL = { provider: 'openai-codex', modelId: 'gpt-6.1-sol' } as const;
export const QUOTA_REJECT_PERCENT = 70;

const DIFFICULTY_MARKER = /difficulty:(easy|standard|hard)\b/i;
const HARD_SPEC_CHARS = 3000;
const EASY_SPEC_CHARS = 300;

export function classifyDifficulty(todo: {
  title: string;
  spec: string | null;
  request?: Pick<TaskRequest, 'difficulty'> | null;
}): Difficulty {
  if (todo.request?.difficulty != null) return todo.request.difficulty;
  const text = `${todo.title}\n${todo.spec ?? ''}`;
  const marked = DIFFICULTY_MARKER.exec(text)?.[1]?.toLowerCase();
  if (marked !== undefined) return marked as Difficulty;
  const length = (todo.spec ?? '').length;
  if (length >= HARD_SPEC_CHARS) return 'hard';
  if (length < EASY_SPEC_CHARS) return 'easy';
  return 'standard';
}

function rejectionOf(candidate: CapabilityCandidate): CandidateRejection | null {
  if (!candidate.available) return candidate.unavailableWhy ?? 'unavailable';
  if (candidate.weeklyUsedPercent !== null && candidate.weeklyUsedPercent >= QUOTA_REJECT_PERCENT) {
    return 'quota';
  }
  return null;
}

function choiceOf(candidate: CapabilityCandidate): RouteChoice {
  return {
    harness: candidate.harness,
    provider: candidate.provider,
    modelId: candidate.modelId,
    machineId: candidate.machineId,
  };
}

export function routeWork(
  request: RouteWorkRequest,
  candidates: readonly CapabilityCandidate[],
): RouteWorkDecision {
  const { difficulty } = request;
  if (request.inFlight !== undefined) {
    const { provider, modelId, machineId } = request.inFlight;
    const known = candidates.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.modelId === modelId &&
        candidate.machineId === machineId,
    );
    return {
      chosen: {
        harness: known?.harness ?? (provider === 'claude-code' ? 'claude-code' : 'pi'),
        provider,
        modelId,
        machineId,
      },
      desired: { provider, modelId },
      fellBack: false,
      difficulty,
      reason: 'in-flight: keeps recorded model',
      rejected: [],
    };
  }

  const groups: Array<{ provider: string; modelId: string; pool: CapabilityCandidate[] }> = [];
  const byKey = new Map<
    string,
    { provider: string; modelId: string; pool: CapabilityCandidate[] }
  >();
  for (const candidate of candidates) {
    const key = `${candidate.provider}\0${candidate.modelId}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { provider: candidate.provider, modelId: candidate.modelId, pool: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.pool.push(candidate);
  }

  const first = groups[0];
  const desired = first === undefined ? null : { provider: first.provider, modelId: first.modelId };
  const rejected: RouteRejection[] = [];

  for (const [groupIndex, group] of groups.entries()) {
    if (isBannedModelId(group.modelId)) continue;
    const usable = group.pool
      .filter((candidate) => {
        const why = rejectionOf(candidate);
        if (why !== null)
          rejected.push({ modelId: group.modelId, machineId: candidate.machineId, why });
        return why === null;
      })
      .sort((a, b) => (a.weeklyUsedPercent ?? 0) - (b.weeklyUsedPercent ?? 0));
    const best = usable[0];
    if (best !== undefined) {
      const fellBack = groupIndex > 0;
      return {
        chosen: choiceOf(best),
        desired,
        fellBack,
        difficulty,
        reason: fellBack
          ? `${difficulty}: ${best.provider}/${best.modelId} (tier fallback)`
          : `${difficulty}: ${best.provider}/${best.modelId} (tier ${difficulty})`,
        rejected,
      };
    }
  }

  return {
    chosen: null,
    desired,
    fellBack: false,
    difficulty,
    reason: `${difficulty}: no available candidate`,
    rejected,
  };
}
