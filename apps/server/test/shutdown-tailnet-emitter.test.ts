import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { step as stepTable } from '../src/db/schema.js';
import { listenOnTailnetSocket } from '../src/lib/tailnet-listener.js';
import { emitRuntimeStepSpan, shutdownRuntimeOtel } from '../src/runtime-otel.js';
import { bootServer } from './helpers.js';

interface Captured {
  spans: { name: string }[];
}

const received: Captured[] = [];
let collector: Server | undefined;
let endpoint = '';
const dirs: string[] = [];
const closers: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  await startCollector();
});

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await shutdownRuntimeOtel();
  received.splice(0);
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

afterAll(async () => {
  await shutdownRuntimeOtel();
  collector?.closeAllConnections();
  const open = collector;
  collector = undefined;
  if (open !== undefined) await new Promise<void>((resolve) => open.close(() => resolve()));
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCollector(): Promise<void> {
  collector = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
      };
      received.push({
        spans: body.resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ),
      });
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => collector?.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}/v1/traces`;
}

function tempDir(): string {
  const dir = makeTestTempDir('shutdown-tailnet-');
  dirs.push(dir);
  return dir;
}

async function lateTurn() {
  const s = bootServer();
  closers.push(() => s.dispose());
  const stepId = 'step-late-tailnet';
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId: 'chief-thread-late',
      kind: 'chief',
      status: 'done',
      claimedAt: 1000,
      finishedAt: 2000,
      createdAt: 900,
    })
    .run();
  const env = { CAIRN_OTEL_ENDPOINT: endpoint };
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const requestEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  s.app.get('/api/late', async (c) => {
    entered?.();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    emitRuntimeStepSpan(s.db, stepId, env);
    return c.json({ late: true });
  });
  const socketPath = join(tempDir(), 'tailnet.sock');
  const listener = await listenOnTailnetSocket(s.app, socketPath);
  closers.push(() => listener.close());
  const finished = new Promise<void>((resolve) => {
    const req = request(
      { socketPath, path: '/api/late', headers: { host: 'cairn.tail.ts.net' } },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', () => resolve());
    req.end();
  });
  await requestEntered;
  return {
    listener,
    finished,
    release: () => release?.(),
  };
}

describe('tailnet listener shutdown', () => {
  test('the listener closes only after its active request emitted its terminal span', async () => {
    const late = await lateTurn();
    let closed = false;
    const closing = late.listener.close().then(() => {
      closed = true;
    });
    await delay(50);
    expect(closed).toBe(false);
    late.release();
    await closing;
    expect(closed).toBe(true);
  });

  test('the final tracing shutdown delivers the span of a request the listener drained', async () => {
    const late = await lateTurn();
    const closing = late.listener.close();
    setTimeout(() => late.release(), 50);
    await closing;
    await shutdownRuntimeOtel();
    await late.finished;
    const spans = received.flatMap((entry) => entry.spans);
    expect(spans.map((span) => span.name)).toEqual(['coordinator turn']);
  });
});
