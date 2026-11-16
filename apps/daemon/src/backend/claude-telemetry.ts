import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LANGFUSE_ATTR, observationAttributes, redactSecrets } from '@cairn/shared';
import { z } from 'zod';
import type { PiStepSpanSink } from './otel.js';

const MAX_BODY = 8 * 1024 * 1024;
const MAX_PENDING = 128;
const attributes = z.array(
  z.object({
    key: z.string(),
    value: z.object({
      stringValue: z.string().optional(),
      intValue: z.union([z.number(), z.string()]).optional(),
      doubleValue: z.number().optional(),
      boolValue: z.boolean().optional(),
    }),
  }),
);
const record = z.object({ attributes });
const nativeSpan = record.extend({
  name: z.string(),
  spanId: z.string(),
  startTimeUnixNano: z.string(),
  endTimeUnixNano: z.string(),
});
const envelope = z.object({
  resourceLogs: z
    .array(z.object({ scopeLogs: z.array(z.object({ logRecords: z.array(record) })) }))
    .optional(),
  resourceSpans: z
    .array(z.object({ scopeSpans: z.array(z.object({ spans: z.array(nativeSpan) })) }))
    .optional(),
});

function fields(entries: z.infer<typeof attributes>): Map<string, string | number | boolean> {
  const values = new Map<string, string | number | boolean>();
  for (const entry of entries) {
    const value =
      entry.value.stringValue ??
      entry.value.intValue ??
      entry.value.doubleValue ??
      entry.value.boolValue;
    if (value !== undefined) values.set(entry.key, value);
  }
  return values;
}

function numberOf(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined;
}

export interface ClaudeTelemetryCapture {
  env: Record<string, string>;
  close(): Promise<void>;
}

export async function captureClaudeTelemetry(
  sink: PiStepSpanSink,
  redact: <T>(value: T) => T,
): Promise<ClaudeTelemetryCapture | undefined> {
  const requests = new Map<string, { input?: string; summary: boolean }>();
  const responses = new Map<
    string,
    { bodyId: string; output?: string; model?: string; summary: boolean }
  >();
  const spans = new Map<string, z.infer<typeof nativeSpan>>();
  const emitted = new Set<string>();
  const bodyRecord = z.looseObject({});
  const retain = <T>(map: Map<string, T>, key: string, value: T) => {
    if (map.size >= MAX_PENDING) map.delete(map.keys().next().value ?? '');
    map.set(key, value);
  };
  const emit = (span: z.infer<typeof nativeSpan>, final: boolean) => {
    if (emitted.has(span.spanId)) return;
    const attrs = fields(span.attributes);
    const response = responses.get(String(attrs.get('request_id')));
    const request = response === undefined ? undefined : requests.get(response.bodyId);
    if ((response === undefined || request === undefined) && !final) return;
    const model = response?.model ?? attrs.get('model');
    const at = Number(span.startTimeUnixNano) / 1e6;
    const endAt = Number(span.endTimeUnixNano) / 1e6;
    if (typeof model !== 'string' || !Number.isFinite(at) || !Number.isFinite(endAt)) return;
    const firstContent = numberOf(attrs.get('first_content_ms'));
    sink.chat(at, {
      provider: 'anthropic',
      model,
      responseModel: response?.model,
      endAt,
      ...(firstContent === undefined ? {} : { firstTokenAt: Math.min(endAt, at + firstContent) }),
      finishReason:
        attrs.get('success') === false ? 'error' : String(attrs.get('stop_reason') ?? ''),
      rawFinishReason: String(attrs.get('stop_reason') ?? ''),
      usage: {
        input: numberOf(attrs.get('input_tokens')),
        output: numberOf(attrs.get('output_tokens')),
        cacheRead: numberOf(attrs.get('cache_read_tokens')),
        cacheWrite: numberOf(attrs.get('cache_creation_tokens')),
      },
      input: response?.summary || request?.summary ? undefined : request?.input,
      output: response?.summary || request?.summary ? undefined : response?.output,
    });
    if (response !== undefined) requests.delete(response.bodyId);
    responses.delete(String(attrs.get('request_id')));
    emitted.add(span.spanId);
    if (emitted.size > 4096) emitted.delete(emitted.values().next().value ?? '');
    spans.delete(span.spanId);
    void sink.flush(false);
  };
  const path = `/${randomUUID()}`;
  const server = createServer(async (request, response) => {
    if (
      request.method !== 'POST' ||
      ![`${path}/v1/logs`, `${path}/v1/traces`].includes(request.url ?? '')
    ) {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const payload = envelope.parse(JSON.parse(Buffer.concat(chunks).toString()));
      for (const resource of payload.resourceLogs ?? []) {
        for (const scope of resource.scopeLogs) {
          for (const log of scope.logRecords) {
            const attrs = fields(log.attributes);
            const name = attrs.get('event.name');
            if (name !== 'api_request_body' && name !== 'api_response_body') continue;
            const id = attrs.get('request_body_id');
            if (typeof id !== 'string') continue;
            const summary = /compact|summary|summariz|memory/i.test(
              String(attrs.get('query_source') ?? ''),
            );
            const body = attrs.get('body');
            let parsed: Record<string, unknown> | undefined;
            if (
              typeof body === 'string' &&
              attrs.get('body_truncated') !== 'true' &&
              attrs.get('body_truncated') !== true
            ) {
              try {
                parsed = bodyRecord.parse(JSON.parse(body));
              } catch {}
            }
            const content =
              summary || parsed === undefined
                ? undefined
                : redactSecrets(
                    redact(
                      name === 'api_request_body'
                        ? { system: parsed.system, messages: parsed.messages, tools: parsed.tools }
                        : { role: parsed.role, content: parsed.content },
                    ),
                  ).value;
            const observation = observationAttributes(
              name === 'api_request_body' ? { input: content } : { output: content },
            );
            if (name === 'api_request_body') {
              retain(requests, id, {
                input: observation[LANGFUSE_ATTR.input] as string | undefined,
                summary,
              });
            } else {
              const requestId = attrs.get('request_id');
              if (typeof requestId !== 'string') continue;
              retain(responses, requestId, {
                bodyId: id,
                summary,
                output: observation[LANGFUSE_ATTR.output] as string | undefined,
                model: typeof parsed?.model === 'string' ? parsed.model : undefined,
              });
            }
          }
        }
      }
      for (const resource of payload.resourceSpans ?? []) {
        for (const scope of resource.scopeSpans) {
          for (const span of scope.spans) {
            if (span.name === 'claude_code.llm_request') retain(spans, span.spanId, span);
          }
        }
      }
      for (const span of spans.values()) emit(span, false);
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    } catch {
      response.writeHead(400).end();
    }
  });
  server.requestTimeout = 2000;
  server.headersTimeout = 2000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch {
    server.close();
    return undefined;
  }
  const address = server.address();
  if (address === null || typeof address === 'string') return undefined;
  const endpoint = `http://127.0.0.1:${address.port}${path}`;
  return {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH: '2097152',
      OTEL_SDK_DISABLED: 'false',
      OTEL_LOG_RAW_API_BODIES: '1',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_HEADERS: '',
      OTEL_EXPORTER_OTLP_COMPRESSION: 'none',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${endpoint}/v1/logs`,
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: '',
      OTEL_EXPORTER_OTLP_LOGS_COMPRESSION: 'none',
      OTEL_EXPORTER_OTLP_LOGS_TIMEOUT: '1000',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',
      OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: 'none',
      OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '1000',
      OTEL_LOGS_EXPORT_INTERVAL: '200',
      OTEL_TRACES_EXPORT_INTERVAL: '200',
      OTEL_BSP_SCHEDULE_DELAY: '200',
      OTEL_EXPORTER_OTLP_TIMEOUT: '1000',
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const span of spans.values()) emit(span, true);
      requests.clear();
      responses.clear();
      spans.clear();
      emitted.clear();
    },
  };
}
