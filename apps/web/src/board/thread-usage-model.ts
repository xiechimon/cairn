import type { StepJournalRow, TokenUsage } from '@cairn/shared';
import { formatUsd, mapTokenUsage } from '../api/mappers.js';
import type { NamedMachine } from '../components/machine-label.js';
import { engineRuntimeOf, resolveModelClientEntry } from '../components/model-identity.js';
import type {
  UsageEngineItem,
  UsageModelItem,
  UsageRunnerItem,
} from '../components/usage-breakdown.js';
import { formatWorkDuration } from '../detail/work-trace.js';
import type { ModelOption, TodoRecord } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

export interface ThreadUsageSummary {
  cost: string;
  tokens: string;
  cached: string;
  models: string[];
  machines: string[];
  duration: string;
  engines: string[];
  latestEngine?: UsageEngineItem | null;
  historyEngines?: UsageEngineItem[];
  latestModel?: UsageModelItem | null;
  historyModels?: UsageModelItem[];
  latestMachine?: UsageRunnerItem | null;
  historyMachines?: UsageRunnerItem[];
}

const HARNESS_NAMES = {
  'claude-code': 'Claude Code',
  pi: 'Cairn',
  devin: 'Devin',
  antigravity: 'Antigravity',
  doubao: '豆包',
  gemini: 'Gemini',
} as const;

export function threadRunSeconds(steps: readonly StepJournalRow[], now: number): number | null {
  const started = steps.filter((step) => step.startedAt !== undefined);
  if (started.length === 0) return null;
  return (
    started.reduce(
      (sum, step) => sum + Math.max(0, (step.finishedAt ?? now) - (step.startedAt ?? now)),
      0,
    ) / 1000
  );
}

export function threadEngines(steps: readonly StepJournalRow[]): string[] {
  return [
    ...new Set(
      steps.flatMap((step) =>
        step.route?.harness == null ? [] : [HARNESS_NAMES[step.route.harness]],
      ),
    ),
  ];
}

export function threadUsageBuildIds(
  todo: Pick<TodoRecord, 'latestBuildId' | 'buildHistory'>,
): string[] {
  const history = todo.buildHistory.map((entry) => entry.buildId);
  if (todo.latestBuildId !== null) history.push(todo.latestBuildId);
  return [...new Set(history)];
}

function sameModel(a: UsageModelItem, b: UsageModelItem): boolean {
  if (a.modelId !== b.modelId) return false;
  if (a.provider === b.provider) return true;
  return a.provider === null || b.provider === null;
}

function sameRunner(a: UsageRunnerItem, b: UsageRunnerItem): boolean {
  if (a.id !== null && b.id !== null) return a.id === b.id;
  return a.name === b.name;
}

export function threadUsageSummary(
  usage: readonly TokenUsage[] | null,
  machines: readonly string[],
  steps: readonly StepJournalRow[] | null = null,
  now = 0,
  options?: {
    machineDetails?: readonly NamedMachine[];
    modelOptions?: readonly ModelOption[];
  },
): ThreadUsageSummary {
  const knownUsage = usage !== null && usage.length > 0 ? [...usage] : null;
  const tokenUsage = knownUsage === null ? null : mapTokenUsage(knownUsage);
  const price = knownUsage?.every((row) => row.costTotal !== null)
    ? knownUsage.reduce((sum, row) => sum + (row.costTotal ?? 0), 0)
    : null;
  const engines = steps === null ? [] : threadEngines(steps);
  const orderedSteps =
    steps === null
      ? []
      : [...steps].sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt));
  const latestStep =
    orderedSteps.filter((s) => s.startedAt !== undefined).at(-1) ?? orderedSteps.at(-1) ?? null;

  const latestEngineRuntime = latestStep?.route?.harness ?? engineRuntimeOf(engines.at(-1) ?? null);
  const latestEngineLabel =
    latestStep?.route?.harness != null
      ? HARNESS_NAMES[latestStep.route.harness]
      : (engines.at(-1) ?? null);
  const latestEngine: UsageEngineItem | null =
    latestEngineLabel !== null ? { label: latestEngineLabel, runtime: latestEngineRuntime } : null;
  const historyEngines: UsageEngineItem[] = [];
  const seenEngines = new Set<string>(latestEngine !== null ? [latestEngine.label] : []);
  for (const label of [...engines].reverse()) {
    if (seenEngines.has(label)) continue;
    seenEngines.add(label);
    historyEngines.push({ label, runtime: engineRuntimeOf(label) });
  }

  const rawModels = [
    ...new Set(knownUsage?.map((row) => row.model).filter((model) => model !== '') ?? []),
  ];
  const stepProviderByModelId = new Map<string, string>();
  for (const s of orderedSteps) {
    if (s.route?.modelId != null && s.route.harness != null) {
      stepProviderByModelId.set(s.route.modelId, s.route.harness);
    }
  }
  const resolvedModels: UsageModelItem[] = [];
  for (const raw of rawModels) {
    const entry = resolveModelClientEntry(raw, {
      providerHint: stepProviderByModelId.get(raw) ?? null,
      options: options?.modelOptions,
    });
    if (!resolvedModels.some((m) => sameModel(m, entry))) {
      resolvedModels.push(entry);
    }
  }
  const latestModel: UsageModelItem | null = (() => {
    const stepModelId = latestStep?.route?.modelId;
    if (stepModelId != null) {
      const matched = resolvedModels.find((m) => m.modelId === stepModelId);
      if (matched !== undefined) return matched;
      return resolveModelClientEntry(stepModelId, {
        providerHint: latestStep?.route?.harness ?? null,
        options: options?.modelOptions,
      });
    }
    return resolvedModels.at(-1) ?? null;
  })();
  const historyModels: UsageModelItem[] = [];
  for (const model of [...resolvedModels].reverse()) {
    if (latestModel !== null && sameModel(model, latestModel)) continue;
    historyModels.push(model);
  }

  const toRunnerItem = (name: string, id: string | null = null): UsageRunnerItem => {
    const detail =
      (id !== null ? options?.machineDetails?.find((m) => m.id === id) : undefined) ??
      options?.machineDetails?.find((m) => m.name === name);
    return {
      id: detail?.id ?? id,
      name: detail?.name ?? name,
      osPlatform: detail?.capabilities?.osPlatform ?? null,
      osDistribution: detail?.capabilities?.osDistribution ?? null,
    };
  };
  const uniqueMachineNames = [...new Set(machines.filter((name) => name.trim() !== ''))];
  const latestMachineFromStep =
    latestStep?.machineId != null
      ? options?.machineDetails?.find((m) => m.id === latestStep.machineId)
      : undefined;
  const lastMachineName = uniqueMachineNames.at(-1);
  const latestMachine: UsageRunnerItem | null =
    latestMachineFromStep !== undefined
      ? toRunnerItem(latestMachineFromStep.name, latestMachineFromStep.id)
      : lastMachineName !== undefined
        ? toRunnerItem(lastMachineName)
        : null;
  const historyMachines: UsageRunnerItem[] = [];
  for (const name of [...uniqueMachineNames].reverse()) {
    const runner = toRunnerItem(name);
    if (latestMachine !== null && sameRunner(runner, latestMachine)) continue;
    if (historyMachines.some((seen) => sameRunner(seen, runner))) continue;
    historyMachines.push(runner);
  }

  return {
    cost: price === null ? '' : formatUsd(price),
    tokens: tokenUsage?.total ?? '',
    cached: tokenUsage !== null && tokenUsage.cacheHitRate !== '—' ? tokenUsage.cacheHitRate : '',
    models: rawModels,
    machines: uniqueMachineNames,
    duration: steps === null ? '' : formatWorkDuration(threadRunSeconds(steps, now)),
    engines,
    latestEngine,
    historyEngines,
    latestModel,
    historyModels,
    latestMachine,
    historyMachines,
  };
}

export function threadUsageCaption(summary: ThreadUsageSummary, t: TFunc): string {
  const parts = [
    summary.cost === '' || summary.cost === '—' ? null : summary.cost,
    summary.tokens === '' || summary.tokens === '—'
      ? null
      : t('Token 数：{tokens}', { tokens: summary.tokens }),
  ].filter((part) => part !== null);
  return parts.length === 0 ? t('用量暂不可用') : parts.join(' · ');
}
