import { createHash } from 'node:crypto';
import { otelResourceAttributes, redactSecrets } from '@cairn/shared';
import {
  OTLP_SPAN_KIND,
  type OtlpTarget,
  otlpAttributes,
  otlpNanos,
  otlpTracesRequest,
  postOtlpTraces,
} from '@cairn/shared/otel';
import { z } from 'zod';

export class TrajectoryShadowError extends Error {}

export const STEP_DIGEST_NAME = 'step digest';
export const COST_Z_SCORE_NAME = 'cost_z';
export const STEP_ERROR_SCORE_NAME = 'step_error';
export const DIGEST_MAX_CHARS = 6000;
export const COST_BASELINE_DAYS = 7;
export const COST_BASELINE_MIN_UNITS = 5;
const LAST_TOOL_CALLS = 15;
const PHASES = 12;
const CALL_TEXT_CHARS = 160;
const QUESTION_CHARS = 400;
const ERROR_CHARS = 300;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'apply_patch']);
const QUESTION_TOOLS = new Set(['ask_user', 'askuserquestion']);

const observationSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  type: z.string(),
  name: z.string().nullish(),
  startTime: z.string(),
  endTime: z.string().nullish(),
  parentObservationId: z.string().nullish(),
  level: z.string().nullish(),
  statusMessage: z.string().nullish(),
  environment: z.string().nullish(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  totalCost: z.number().nullish(),
  model: z.string().nullish(),
  providedModelName: z.string().nullish(),
});

export type Observation = z.infer<typeof observationSchema>;

const pageSchema = z.object({
  data: z.array(observationSchema),
  meta: z.object({ cursor: z.string().nullish() }).passthrough(),
});

export interface LangfuseTarget {
  host: string;
  publicKey: string;
  secretKey: string;
}

export function parseLangfuseTarget(env: NodeJS.ProcessEnv): LangfuseTarget {
  const host = env.CAIRN_LANGFUSE_HOST?.replace(/\/+$/, '');
  const publicKey = env.CAIRN_LANGFUSE_PUBLIC_KEY;
  const secretKey = env.CAIRN_LANGFUSE_SECRET_KEY;
  if (!host || !publicKey || !secretKey)
    throw new TrajectoryShadowError(
      'Set CAIRN_LANGFUSE_HOST, CAIRN_LANGFUSE_PUBLIC_KEY and CAIRN_LANGFUSE_SECRET_KEY',
    );
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    throw new TrajectoryShadowError('CAIRN_LANGFUSE_HOST is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new TrajectoryShadowError('CAIRN_LANGFUSE_HOST must be http or https');
  return { host: url.origin, publicKey, secretKey };
}

export function isShadowUnit(observation: Observation): boolean {
  const name = observation.name ?? '';
  return (
    observation.endTime != null &&
    ((observation.type === 'SPAN' && name.startsWith('step ') && name !== STEP_DIGEST_NAME) ||
      (observation.type === 'AGENT' && name === 'coordinator turn'))
  );
}

function ms(iso: string | null | undefined): number {
  return iso == null ? Number.NaN : Date.parse(iso);
}

function minutes(value: number): number {
  return Math.round((value / MINUTE_MS) * 10) / 10;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function asText(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toolName(observation: Observation): string {
  return (observation.name ?? '').replace(/^(Tool: |execute_tool )/, '');
}

function isError(observation: Observation): boolean {
  return observation.level === 'ERROR';
}

function maxRepeats(keys: string[]): number {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

function questionsOf(tool: Observation): string[] {
  const input = parsed(tool.input);
  const list =
    typeof input === 'object' && input !== null && 'questions' in input
      ? (input as { questions: unknown }).questions
      : [input];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): string[] => {
    if (typeof entry === 'string') return [clip(entry, QUESTION_CHARS)];
    if (typeof entry === 'object' && entry !== null && 'question' in entry) {
      const text = asText((entry as { question: unknown }).question);
      return text === '' ? [] : [clip(text, QUESTION_CHARS)];
    }
    return [];
  });
}

function taskTitle(unit: Observation, trace: Observation[]): string {
  if (unit.name === 'coordinator turn') {
    const trigger = unit.metadata?.['attributes.cairn.chief_trigger'];
    return `coordinator turn (trigger: ${asText(trigger) || 'unknown'})`;
  }
  const root = trace.find((o) => o.name === 'invoke_agent');
  return asText(root?.metadata?.['attributes.gen_ai.agent.name']) || '(untitled task)';
}

export interface StepDigest {
  unit: string;
  task: string;
  outcome: { status: 'ok' | 'error'; error?: string; duration_min: number };
  phases: {
    name: string;
    status: 'ok' | 'error';
    start_min: number;
    duration_min: number;
    current?: true;
  }[];
  after: {
    next_unit_started_after_min: number | null;
    idle_min: number | null;
    build_finished: boolean;
  };
  facts: {
    tool_calls: number;
    tool_errors: number;
    edits_or_writes: number;
    generations: number;
    cost_usd: number | null;
    max_same_call_repeats: number;
    max_same_error_repeats: number;
  };
  last_tool_calls: { name: string; args: string; error?: true; result?: string }[];
  owner_questions: string[];
}

export interface UnitSpend {
  cost: number | null;
  models: string[];
}

export function unitSpend(generations: Observation[]): UnitSpend | null {
  if (generations.length === 0) return null;
  const priced = generations.every((g) => g.totalCost != null);
  return {
    cost: priced ? generations.reduce((sum, g) => sum + (g.totalCost ?? 0), 0) : null,
    models: [...new Set(generations.map((g) => g.providedModelName ?? g.model ?? 'unknown model'))],
  };
}

function childGenerations(unit: Observation, observations: Observation[]): Observation[] {
  return observations.filter((o) => o.type === 'GENERATION' && o.parentObservationId === unit.id);
}

export function buildStepDigest(unit: Observation, trace: Observation[], now: number): StepDigest {
  const start = ms(unit.startTime);
  const end = ms(unit.endTime);
  const units = trace.filter(isShadowUnit).sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const traceStart = Math.min(start, ...units.map((u) => ms(u.startTime)));
  const tools = trace
    .filter((o) => o.type === 'TOOL' && o.parentObservationId === unit.id)
    .sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const next = units.find((u) => u.id !== unit.id && ms(u.startTime) >= end);
  const root = trace.find((o) => o.name === 'invoke_agent' && o.parentObservationId == null);
  const errors = tools.filter(isError);
  const recentPhases = units.slice(-PHASES);
  const digest: StepDigest = {
    unit: unit.name ?? '',
    task: clip(taskTitle(unit, trace), 200),
    outcome: {
      status: isError(unit) ? 'error' : 'ok',
      ...(isError(unit) ? { error: clip(unit.statusMessage ?? '', ERROR_CHARS) } : {}),
      duration_min: minutes(end - start),
    },
    phases: recentPhases.map((u) => ({
      name: u.name ?? '',
      status: isError(u) ? 'error' : 'ok',
      start_min: minutes(ms(u.startTime) - traceStart),
      duration_min: minutes(ms(u.endTime) - ms(u.startTime)),
      ...(u.id === unit.id ? { current: true as const } : {}),
    })),
    after: {
      next_unit_started_after_min: next ? minutes(ms(next.startTime) - end) : null,
      idle_min: next ? null : minutes(now - end),
      build_finished: unit.name === 'coordinator turn' || root !== undefined,
    },
    facts: {
      tool_calls: tools.length,
      tool_errors: errors.length,
      edits_or_writes: tools.filter((t) => EDIT_TOOLS.has(toolName(t).toLowerCase())).length,
      generations: trace.filter((o) => o.type === 'GENERATION' && o.parentObservationId === unit.id)
        .length,
      cost_usd: unitSpend(childGenerations(unit, trace))?.cost ?? null,
      max_same_call_repeats: maxRepeats(tools.map((t) => `${toolName(t)} ${asText(t.input)}`)),
      max_same_error_repeats: maxRepeats(
        errors.map((t) => `${toolName(t)} ${clip(asText(t.output), 400)}`),
      ),
    },
    last_tool_calls: tools.slice(-LAST_TOOL_CALLS).map((t) => ({
      name: toolName(t),
      args: clip(asText(t.input), CALL_TEXT_CHARS),
      ...(isError(t)
        ? { error: true as const, result: clip(asText(t.output), CALL_TEXT_CHARS) }
        : {}),
    })),
    owner_questions: tools
      .filter((t) => QUESTION_TOOLS.has(toolName(t).toLowerCase()))
      .flatMap(questionsOf),
  };
  const redacted = redactSecrets(digest).value as StepDigest;
  while (JSON.stringify(redacted).length > DIGEST_MAX_CHARS && redacted.last_tool_calls.length > 0)
    redacted.last_tool_calls.shift();
  while (JSON.stringify(redacted).length > DIGEST_MAX_CHARS && redacted.phases.length > 1)
    redacted.phases.shift();
  while (JSON.stringify(redacted).length > DIGEST_MAX_CHARS && redacted.owner_questions.length > 1)
    redacted.owner_questions.pop();
  if (JSON.stringify(redacted).length > DIGEST_MAX_CHARS)
    redacted.owner_questions = redacted.owner_questions.map((q) => clip(q, 200));
  return redacted;
}

export interface CostSample {
  unitId: string;
  role: string;
  endedAt: number;
  cost: number;
}

export interface CostAnomaly {
  z: number;
  mean: number;
  sd: number;
  n: number;
}

export function costAnomaly(target: CostSample, samples: CostSample[]): CostAnomaly | null {
  const baseline = samples
    .filter(
      (s) =>
        s.unitId !== target.unitId &&
        s.role === target.role &&
        s.endedAt < target.endedAt &&
        s.endedAt >= target.endedAt - COST_BASELINE_DAYS * DAY_MS,
    )
    .map((s) => s.cost);
  const n = baseline.length;
  if (n < COST_BASELINE_MIN_UNITS) return null;
  const mean = baseline.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  if (sd === 0) return null;
  return { z: Math.round(((target.cost - mean) / sd) * 100) / 100, mean, sd, n };
}

function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

function authHeader(target: LangfuseTarget): string {
  return `Basic ${Buffer.from(`${target.publicKey}:${target.secretKey}`).toString('base64')}`;
}

async function langfuse(
  target: LangfuseTarget,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${target.host}${path}`, {
      ...init,
      headers: { authorization: authHeader(target), 'content-type': 'application/json' },
    });
  } catch {
    throw new TrajectoryShadowError(`Langfuse unreachable at ${path.split('?')[0]}`);
  }
  if (!response.ok)
    throw new TrajectoryShadowError(
      `Langfuse replied HTTP ${response.status} at ${path.split('?')[0]}`,
    );
  return response.json();
}

export async function listObservations(
  target: LangfuseTarget,
  query: Record<string, string>,
): Promise<Observation[]> {
  const out: Observation[] = [];
  let cursor: string | null | undefined;
  do {
    const params = new URLSearchParams({ limit: '1000', ...query, ...(cursor ? { cursor } : {}) });
    const page = pageSchema.parse(await langfuse(target, `/api/public/v2/observations?${params}`));
    out.push(...page.data);
    cursor = page.data.length > 0 ? page.meta.cursor : null;
  } while (cursor);
  return out;
}

export interface ShadowRunOptions {
  now: number;
  sinceMs: number;
  settleMs: number;
  dryRun: boolean;
}

export interface ShadowRunResult {
  units: number;
  digests: number;
  skippedAlreadyDigested: number;
  costScores: number;
  questionUnits: number;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function digestSpan(unit: Observation, digest: StepDigest) {
  const at = ms(unit.endTime);
  return {
    traceId: unit.traceId,
    spanId: stableId(unit.id, STEP_DIGEST_NAME).slice(0, 16),
    parentSpanId: unit.id,
    name: STEP_DIGEST_NAME,
    kind: OTLP_SPAN_KIND.internal,
    startTimeUnixNano: otlpNanos(at),
    endTimeUnixNano: otlpNanos(at),
    attributes: otlpAttributes({
      'langfuse.observation.input': JSON.stringify(digest),
      'langfuse.observation.metadata.unit': digest.unit,
      'langfuse.observation.metadata.has_owner_question': String(digest.owner_questions.length > 0),
      ...(unit.environment ? { 'langfuse.environment': unit.environment } : {}),
    }),
  };
}

export async function runShadow(
  langfuseTarget: LangfuseTarget,
  otlpTarget: OtlpTarget,
  options: ShadowRunOptions,
): Promise<ShadowRunResult> {
  const windowEnd = options.now - options.settleMs;
  const windowStart = windowEnd - options.sinceMs;
  const baselineStart = windowStart - COST_BASELINE_DAYS * DAY_MS;
  const candidates = (
    await Promise.all(
      ['SPAN', 'AGENT'].map((type) =>
        listObservations(langfuseTarget, {
          type,
          fields: 'core,basic,metadata',
          fromStartTime: iso(baselineStart),
          toStartTime: iso(windowEnd),
        }),
      ),
    )
  )
    .flat()
    .filter(isShadowUnit);
  const inWindow = candidates.filter(
    (u) => ms(u.endTime) >= windowStart && ms(u.endTime) < windowEnd,
  );
  const digested = new Set(
    (
      await listObservations(langfuseTarget, {
        name: STEP_DIGEST_NAME,
        fields: 'core',
        fromStartTime: iso(windowStart - DAY_MS),
      })
    ).map((o) => o.parentObservationId),
  );
  const generations = await listObservations(langfuseTarget, {
    type: 'GENERATION',
    fields: 'core,usage,model',
    fromStartTime: iso(baselineStart),
    toStartTime: iso(options.now),
  });
  const generationsByUnit = new Map<string, Observation[]>();
  for (const g of generations)
    if (g.parentObservationId)
      generationsByUnit.set(g.parentObservationId, [
        ...(generationsByUnit.get(g.parentObservationId) ?? []),
        g,
      ]);
  const samples: CostSample[] = candidates.flatMap((u) => {
    const spend = unitSpend(generationsByUnit.get(u.id) ?? []);
    const model = spend?.models.length === 1 ? spend.models[0] : undefined;
    return spend?.cost == null || spend.cost <= 0 || model === undefined
      ? []
      : [
          {
            unitId: u.id,
            role: `${u.name ?? ''} on ${model}`,
            endedAt: ms(u.endTime),
            cost: spend.cost,
          },
        ];
  });
  const result: ShadowRunResult = {
    units: inWindow.length,
    digests: 0,
    skippedAlreadyDigested: 0,
    costScores: 0,
    questionUnits: 0,
  };
  const traces = new Map<string, Observation[]>();
  for (const unit of inWindow) {
    const score = async (name: string, value: number, comment?: string) => {
      if (options.dryRun) return;
      await langfuse(langfuseTarget, '/api/public/scores', {
        method: 'POST',
        body: JSON.stringify({
          id: stableId(unit.id, name),
          traceId: unit.traceId,
          observationId: unit.id,
          name,
          dataType: 'NUMERIC',
          value,
          ...(unit.environment ? { environment: unit.environment } : {}),
          ...(comment ? { comment } : {}),
        }),
      });
    };
    await score(STEP_ERROR_SCORE_NAME, isError(unit) ? 1 : 0);
    const sample = samples.find((s) => s.unitId === unit.id);
    const anomaly = sample ? costAnomaly(sample, samples) : null;
    if (sample && anomaly) {
      await score(
        COST_Z_SCORE_NAME,
        anomaly.z,
        `cost $${sample.cost.toFixed(4)} vs ${COST_BASELINE_DAYS}d mean $${anomaly.mean.toFixed(4)} sd $${anomaly.sd.toFixed(4)} over ${anomaly.n} "${sample.role}" units`,
      );
      result.costScores++;
    }
    if (digested.has(unit.id)) {
      result.skippedAlreadyDigested++;
      continue;
    }
    let trace = traces.get(unit.traceId);
    if (trace === undefined) {
      const [core, tools] = await Promise.all([
        listObservations(langfuseTarget, {
          traceId: unit.traceId,
          fields: 'core,basic,metadata,usage',
        }),
        listObservations(langfuseTarget, {
          traceId: unit.traceId,
          type: 'TOOL',
          fields: 'core,basic,io',
        }),
      ]);
      const toolIo = new Map(tools.map((t) => [t.id, t]));
      trace = core.map((o) => ({ ...o, ...(toolIo.get(o.id) ?? {}) }));
      traces.set(unit.traceId, trace);
    }
    const digest = buildStepDigest(unit, trace, options.now);
    if (digest.owner_questions.length > 0) result.questionUnits++;
    if (!options.dryRun)
      try {
        await postOtlpTraces(
          otlpTarget,
          otlpTracesRequest(otelResourceAttributes(unit.environment), 'cairn.shadow', [
            digestSpan(unit, digest),
          ]),
        );
      } catch {
        throw new TrajectoryShadowError(
          `OTLP endpoint rejected the digest after ${result.digests}`,
        );
      }
    result.digests++;
  }
  return result;
}
