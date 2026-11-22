import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, expect, test } from 'vitest';
import { step as stepTable } from '../src/db/schema.js';
import {
  emitRuntimeStepSpan,
  flushRuntimeOtel,
  sealRuntimeOtel,
  shutdownRuntimeOtel,
  spansDroppedBySeal,
} from '../src/runtime-otel.js';
import { bootServer } from './helpers.js';

const received: { name: string }[] = [];
let collector: Server | undefined;
let endpoint = '';

async function startCollector(): Promise<void> {
  collector = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
      };
      for (const resource of body.resourceSpans)
        for (const scope of resource.scopeSpans) received.push(...scope.spans);
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => collector?.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}/v1/traces`;
}

afterAll(async () => {
  await shutdownRuntimeOtel();
  collector?.closeAllConnections();
  const open = collector;
  collector = undefined;
  if (open !== undefined) await new Promise<void>((resolve) => open.close(() => resolve()));
});

test('the final tracing shutdown cannot be followed by a new provider', async () => {
  await startCollector();
  const s = bootServer();
  const stepId = 'step-sealed';
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: 'chief-thread-sealed',
      kind: 'chief',
      status: 'done',
      claimedAt: 1000,
      finishedAt: 2000,
      createdAt: 900,
    })
    .run();
  const env = { CAIRN_OTEL_ENDPOINT: endpoint };
  emitRuntimeStepSpan(s.db, stepId, env);
  await sealRuntimeOtel();
  expect(received.map((span) => span.name)).toEqual(['coordinator turn']);

  emitRuntimeStepSpan(s.db, stepId, env);
  await flushRuntimeOtel();

  expect(received.map((span) => span.name)).toEqual(['coordinator turn']);
  expect(spansDroppedBySeal()).toBe(1);
  s.dispose();
});
