import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets, type TrajectoryPack, trajectoryPackSchema } from '@cairn/shared';
import { OtlpTargetConfigError, type OtlpTracesRequest, parseOtlpTarget } from '@cairn/shared/otel';
import { packToOtlp } from './trajectory-otlp.js';

export class TrajectoryPushError extends Error {}

export interface OtlpTarget {
  url: URL;
  headers: Record<string, string>;
}

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
    const cleaned = redactSecrets(packToOtlp(pack));
    const request = cleaned.value as OtlpTracesRequest;
    const spans = request.resourceSpans.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans),
    );
    const traceId = spans[0]?.traceId ?? '';
    if (!options.force && alreadyPushed.has(traceId)) {
      result.skippedAlreadyPushed++;
      continue;
    }
    let response: Response;
    try {
      response = await fetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...target.headers },
        body: JSON.stringify(request),
      });
    } catch {
      throw new TrajectoryPushError(`Endpoint unreachable after ${result.pushed} pushed`);
    }
    if (!response.ok)
      throw new TrajectoryPushError(
        `Endpoint replied HTTP ${response.status} after ${result.pushed} pushed`,
      );
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
