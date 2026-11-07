import { z } from 'zod';
import type { StepKind } from './records/step.js';

export const DIFFICULTIES = ['easy', 'standard', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const difficultySchema = z.enum(DIFFICULTIES);

export type CandidateHarness = 'claude-code' | 'pi';
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
  difficulty: Difficulty;
  reason: string;
  rejected: RouteRejection[];
}

export const CODEX_MODEL = { provider: 'openai-codex', modelId: 'gpt-6.1-sol' } as const;
export const QUOTA_REJECT_PERCENT = 70;

const RANKING: Record<Difficulty, readonly string[]> = {
  hard: ['gpt-6.1-sol', 'claude-opus-5-5', 'claude-sonnet-5-5'],
  standard: ['claude-sonnet-5-5', 'gpt-6.1-sol'],
  easy: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-6.1-sol'],
};

const BANNED_PREFIXES = ['gpt-5.6', 'gpt-6-astra', 'minimax-m3', 'deepseek-v4-flash'];

const DIFFICULTY_MARKER = /difficulty:(easy|standard|hard)\b/i;
const HARD_SPEC_CHARS = 3000;
const EASY_SPEC_CHARS = 300;

export function classifyDifficulty(todo: { title: string; spec: string | null }): Difficulty {
  const text = `${todo.title}\n${todo.spec ?? ''}`;
  const marked = DIFFICULTY_MARKER.exec(text)?.[1]?.toLowerCase();
  if (marked !== undefined) return marked as Difficulty;
  const length = (todo.spec ?? '').length;
  if (length >= HARD_SPEC_CHARS) return 'hard';
  if (length < EASY_SPEC_CHARS) return 'easy';
  return 'standard';
}

function banned(modelId: string): boolean {
  return BANNED_PREFIXES.some((prefix) => modelId.startsWith(prefix));
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
      difficulty,
      reason: 'in-flight: keeps recorded model',
      rejected: [],
    };
  }
  const ranking = RANKING[difficulty];
  const rejected: RouteRejection[] = [];
  for (const modelId of ranking) {
    const pool = candidates.filter(
      (candidate) => candidate.modelId === modelId && !banned(candidate.modelId),
    );
    if (pool.length === 0) {
      rejected.push({ modelId, machineId: null, why: 'no-candidate' });
      continue;
    }
    const usable = pool
      .filter((candidate) => {
        const why = rejectionOf(candidate);
        if (why !== null) rejected.push({ modelId, machineId: candidate.machineId, why });
        return why === null;
      })
      .sort((a, b) => (a.weeklyUsedPercent ?? 0) - (b.weeklyUsedPercent ?? 0));
    const best = usable[0];
    if (best !== undefined) {
      const rank = ranking.indexOf(modelId);
      return {
        chosen: choiceOf(best),
        difficulty,
        reason:
          rank === 0
            ? `${difficulty}: ${modelId} ranked first`
            : `${difficulty}: ${modelId} ranked ${rank + 1}, higher ranks unavailable`,
        rejected,
      };
    }
  }
  return {
    chosen: null,
    difficulty,
    reason: `${difficulty}: no available candidate`,
    rejected,
  };
}
