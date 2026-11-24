import type { ProviderRecord, ProviderTestResult } from '@cairn/shared';

type Fingerprint = ProviderRecord['configurationFingerprint'];
type CheckResult = ProviderTestResult & { configurationFingerprint?: string };

export interface ProviderRefreshState {
  generation: number;
  pending: ReadonlyMap<string, number>;
}

export const initialProviderRefresh: ProviderRefreshState = { generation: 0, pending: new Map() };

export function issueCheckGeneration(
  state: ProviderRefreshState,
  id: string,
  checked: Fingerprint,
  list?: { fingerprint: Fingerprint; fetching: boolean },
): ProviderRefreshState {
  const generation = state.generation + 1;
  const needsList =
    list !== undefined && checked !== undefined && (list.fetching || checked !== list.fingerprint);
  return {
    generation,
    pending: needsList ? new Map(state.pending).set(id, generation) : state.pending,
  };
}

export function applyListResponse(
  state: ProviderRefreshState,
  startedAfter: number,
  providers: readonly Pick<ProviderRecord, 'id' | 'configurationFingerprint'>[],
): ProviderRefreshState {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const pending = new Map(
    [...state.pending].filter(([id, generation]) => {
      const returned = byId.get(id);
      return (
        generation > startedAfter ||
        (returned !== undefined && returned.configurationFingerprint === undefined)
      );
    }),
  );
  return { ...state, pending };
}

export function needsProviderList(
  state: ProviderRefreshState,
  after: number | null = null,
): boolean {
  return [...state.pending.values()].some((generation) => after === null || generation > after);
}

export type TeamProviderChecks = Record<string, Record<string, ProviderTestResult>>;
export type ProviderRowChecks = Record<string, TeamProviderChecks>;

export function recordProviderResult(
  checks: ProviderRowChecks,
  id: string,
  model: string,
  result: CheckResult,
): ProviderRowChecks {
  const fingerprint = result.configurationFingerprint;
  if (fingerprint === undefined) return checks;
  return {
    ...checks,
    [id]: {
      ...checks[id],
      [fingerprint]: { ...checks[id]?.[fingerprint], [model]: result },
    },
  };
}

export function selectRowChecks(checks: TeamProviderChecks | undefined, fingerprint: Fingerprint) {
  return fingerprint === undefined ? undefined : checks?.[fingerprint];
}

export type ModelCheck =
  | { phase: 'running' }
  | { phase: 'done'; result: CheckResult; at: number }
  | { phase: 'unavailable'; at: number };

type ChecksByModel = Record<string, ModelCheck>;
export type ModelChecks = ReadonlyMap<Fingerprint, ChecksByModel>;
const NO_MODEL_CHECKS: ChecksByModel = {};

export function startModelChecks(
  checks: ModelChecks,
  fingerprint: Fingerprint,
  pending: ChecksByModel,
): ModelChecks {
  return new Map(checks).set(fingerprint, { ...checks.get(fingerprint), ...pending });
}

export function recordModelResult(
  checks: ModelChecks,
  startedWith: Fingerprint,
  model: string,
  pending: Extract<ModelCheck, { phase: 'running' }>,
  outcome: Exclude<ModelCheck, { phase: 'running' }>,
  trackConfiguration: boolean,
): ModelChecks {
  const fingerprint =
    trackConfiguration && outcome.phase === 'done'
      ? outcome.result.configurationFingerprint
      : startedWith;
  const next = new Map(checks);
  const original = checks.get(startedWith);
  if (fingerprint !== startedWith && original?.[model] === pending) {
    next.set(
      startedWith,
      Object.fromEntries(Object.entries(original).filter(([id]) => id !== model)),
    );
  }
  const current = next.get(fingerprint)?.[model];
  if (current !== undefined && current !== pending) return next;
  return next.set(fingerprint, { ...next.get(fingerprint), [model]: outcome });
}

export function retireModelChecks(checks: ModelChecks, fingerprint: Fingerprint): ModelChecks {
  const previous = Object.entries(checks.get(fingerprint) ?? NO_MODEL_CHECKS);
  const running = previous.filter(([, check]) => check.phase === 'running');
  return running.length === previous.length
    ? checks
    : new Map(checks).set(fingerprint, Object.fromEntries(running));
}

export function dropModelCheck(checks: ModelChecks, model: string): ModelChecks {
  return new Map(
    [...checks].map(([fingerprint, models]) => [
      fingerprint,
      Object.fromEntries(Object.entries(models).filter(([id]) => id !== model)),
    ]),
  );
}

export function selectVisibleChecks(checks: ModelChecks, fingerprint: Fingerprint): ChecksByModel {
  return checks.get(fingerprint) ?? NO_MODEL_CHECKS;
}
