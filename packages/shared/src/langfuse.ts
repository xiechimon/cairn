import { LangfuseClient } from '@langfuse/client';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';

const EXPORT_TIMEOUT_SECONDS = 30;
const OTLP_EXPORT_TIMEOUT_MS = EXPORT_TIMEOUT_SECONDS * 1_000;
const OTLP_BATCH_TIMEOUT_MS = OTLP_EXPORT_TIMEOUT_MS + 5_000;

export type ExperimentClient = Pick<LangfuseClient, 'dataset' | 'experiment'>;

export function openExperimentClient(config: {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}) {
  const exporter = new OTLPTraceExporter({
    url: `${config.baseUrl.replace(/\/$/, '')}/api/public/otel/v1/traces`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`,
      'x-langfuse-ingestion-version': '4',
    },
    timeoutMillis: OTLP_EXPORT_TIMEOUT_MS,
  });
  let failed = false;
  const send = exporter.export.bind(exporter);
  exporter.export = (spans, callback) =>
    send(spans, (result) => {
      failed ||= result.code !== 0;
      callback(result);
    });
  const manager = new AsyncLocalStorageContextManager().enable();
  const provider = new TracerProvider({
    spanProcessors: [
      new BatchSpanProcessor({ exporter, exportTimeoutMillis: OTLP_BATCH_TIMEOUT_MS }),
    ],
  });
  if (!trace.setGlobalTracerProvider(provider) || !context.setGlobalContextManager(manager))
    throw new Error('Experiment tracing requires an unused global provider and context manager');
  const client = new LangfuseClient({ ...config, timeout: EXPORT_TIMEOUT_SECONDS });
  let closed = false;
  return {
    client,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await client.shutdown();
        await provider.shutdown();
      } finally {
        trace.disable();
        context.disable();
        manager.disable();
      }
      if (failed) throw new Error('Experiment trace export failed');
    },
  };
}
