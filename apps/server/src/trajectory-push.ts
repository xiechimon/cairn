import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets, type TrajectoryPack, trajectoryPackSchema } from '@cairn/shared';
import {
  type CairnSpan,
  exportCairnSpans,
  type OtlpTarget,
  OtlpTargetConfigError,
  otlpTraceIdOfBuild,
  parseOtlpTarget,
} from '@cairn/shared/otel';
import { packToSpans, TRAJECTORY_PUSH_SCOPE } from './trajectory-otlp.js';

export class TrajectoryPushError extends Error {}

export function parsePacks(jsonl: string): TrajectoryPack[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => trajectoryPackSchema.parse(JSON.parse(line)));
}

export function resolveTarget(env: NodeJS.ProcessEnv): OtlpTarget {
  try {
    const target = parseOtlpTarget(env);
    if (target === null) throw new TrajectoryPushError('Set CAIRN_OTEL_ENDPOINT');
    return target;
  } catch (error) {
    if (error instanceof OtlpTargetConfigError) throw new TrajectoryPushError(error.message);
    throw error;
  }
}

export interface PushResult {
  pushed: number;
  spans: number;
  redacted: number;
  skippedAlreadyPushed: number;
}

export interface PushOptions {
  ledgerPath: string;
  force: boolean;
}

export async function pushPacks(
  packs: TrajectoryPack[],
  target: OtlpTarget,
  options: PushOptions,
): Promise<PushResult> {
  const result: PushResult = { pushed: 0, spans: 0, redacted: 0, skippedAlreadyPushed: 0 };
  const endpoint = `${target.url.origin}${target.url.pathname}`;
  const alreadyPushed = new Set<string>();
  let ledger = '';
  try {
    ledger = readFileSync(options.ledgerPath, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  for (const line of ledger.split('\n')) {
    try {
      const entry = JSON.parse(line) as { endpoint?: string; traceId?: string };
      if (entry.endpoint === endpoint && entry.traceId) alreadyPushed.add(entry.traceId);
    } catch {}
  }
  for (const pack of packs) {
    const cleaned = redactSecrets(packToSpans(pack));
    const spans = cleaned.value as CairnSpan[];
    const traceId = otlpTraceIdOfBuild(pack.buildId);
    if (!options.force && alreadyPushed.has(traceId)) {
      result.skippedAlreadyPushed++;
      continue;
    }
    try {
      await exportCairnSpans(target, { 'service.name': 'cairn' }, TRAJECTORY_PUSH_SCOPE, spans);
    } catch (error) {
      const status =
        error instanceof Error && 'code' in error && typeof error.code === 'number'
          ? `replied HTTP ${error.code}`
          : 'unreachable';
      throw new TrajectoryPushError(`Endpoint ${status} after ${result.pushed} pushed`);
    }
    mkdirSync(dirname(options.ledgerPath), { recursive: true });
    appendFileSync(
      options.ledgerPath,
      `${JSON.stringify({ endpoint, traceId, pushedAt: new Date().toISOString() })}\n`,
    );
    alreadyPushed.add(traceId);
    result.pushed++;
    result.redacted += cleaned.count;
    result.spans += spans.length;
  }
  return result;
}
