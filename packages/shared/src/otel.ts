import { createHash } from 'node:crypto';
import type { Attributes } from './genai-conventions.js';

export class OtlpTargetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpTargetConfigError';
  }
}

export interface OtlpTarget {
  url: URL;
  headers: Record<string, string>;
}

export function otlpTraceIdOfBuild(buildId: string): string {
  return deriveOtelId(16, 'trace', buildId);
}

export function otlpRootSpanIdOfBuild(buildId: string): string {
  return deriveOtelId(8, 'span', buildId, 'root');
}

export function otlpStepSpanIdOfBuild(buildId: string, stepId: string): string {
  return deriveOtelId(8, 'span', buildId, 'step', stepId);
}

export function otlpTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

export function parseOtlpTarget(env: {
  CAIRN_OTEL_ENDPOINT?: string;
  CAIRN_OTEL_HEADERS?: string;
}): OtlpTarget | null {
  const endpoint = env.CAIRN_OTEL_ENDPOINT;
  if (!endpoint) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new OtlpTargetConfigError('CAIRN_OTEL_ENDPOINT is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new OtlpTargetConfigError('CAIRN_OTEL_ENDPOINT must be http or https');
  const base = url.pathname.replace(/\/+$/, '').replace(/\/v1\/traces$/, '');
  url.pathname = `${base}/v1/traces`;
  const headers: Record<string, string> = {};
  if (url.username !== '') {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  for (const pair of (env.CAIRN_OTEL_HEADERS ?? '').split(',').filter((p) => p.trim() !== '')) {
    const separator = pair.indexOf('=');
    if (separator <= 0)
      throw new OtlpTargetConfigError('CAIRN_OTEL_HEADERS must look like name=value,name=value');
    headers[pair.slice(0, separator).trim().toLowerCase()] = pair.slice(separator + 1).trim();
  }
  return { url, headers };
}

export interface StepOtelContext {
  traceId: string;
  stepSpanId: string;
  tracesUrl: string;
  headers: Record<string, string>;
  exporterEndpoint: string;
  exporterHeaders: string;
}

export function stepOtelContext(
  buildId: string,
  stepId: string,
  target: OtlpTarget,
): StepOtelContext {
  const basePath = target.url.pathname.replace(/\/v1\/traces$/, '');
  return {
    traceId: otlpTraceIdOfBuild(buildId),
    stepSpanId: otlpStepSpanIdOfBuild(buildId, stepId),
    tracesUrl: `${target.url.origin}${target.url.pathname}`,
    headers: target.headers,
    exporterEndpoint: `${target.url.origin}${basePath}`,
    exporterHeaders: Object.entries(target.headers)
      .map(([key, value]) => `${key}=${value}`)
      .join(','),
  };
}

export const OTLP_SPAN_KIND = { internal: 1, client: 3 } as const;
export const OTLP_STATUS_ERROR = 2;

export interface OtlpValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpValue[] };
}

export interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status?: { code: number; message?: string };
}

export interface OtlpTracesRequest {
  resourceSpans: {
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: { scope: { name: string }; spans: OtlpSpan[] }[];
  }[];
}

const NANOS_PER_MILLI = 1_000_000n;

function deriveOtelId(bytes: number, ...parts: (string | number)[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, bytes * 2);
}

export function otlpAttributes(attributes: Attributes): OtlpAttribute[] {
  return Object.entries(attributes).map(([key, value]): OtlpAttribute => {
    if (typeof value === 'string') return { key, value: { stringValue: value } };
    if (typeof value === 'boolean') return { key, value: { boolValue: value } };
    if (typeof value === 'number')
      return {
        key,
        value: Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value },
      };
    if ('double' in value) return { key, value: { doubleValue: value.double } };
    return { key, value: { arrayValue: { values: value.map((item) => ({ stringValue: item })) } } };
  });
}

export function otlpNanos(epochMs: number): string {
  return (BigInt(Math.trunc(epochMs)) * NANOS_PER_MILLI).toString();
}

export function otlpTracesRequest(
  resourceAttributes: Attributes,
  scopeName: string,
  spans: OtlpSpan[],
): OtlpTracesRequest {
  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttributes(resourceAttributes) },
        scopeSpans: [{ scope: { name: scopeName }, spans }],
      },
    ],
  };
}

export async function postOtlpTraces(
  target: OtlpTarget,
  request: OtlpTracesRequest,
): Promise<void> {
  const response = await fetch(target.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...target.headers },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`OTLP endpoint replied HTTP ${response.status}`);
}
