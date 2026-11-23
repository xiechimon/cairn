import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { openExperimentClient } from '../src/langfuse.js';

const scorePath = '/api/public/scores';
const tracePath = '/api/public/otel/v1/traces';
const slowResponseMs = 6_500;
let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  const listening = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    listening.close((error) => (error ? reject(error) : resolve()));
    listening.closeAllConnections();
  });
});

async function serve(status: number, delayMs = 0) {
  const acknowledged: string[] = [];
  const endpoint = createServer((req, res) => {
    if (req.url === '/api/public/projects') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[{"id":"project-test"}]}');
      return;
    }
    req.once('end', () => {
      const timer = setTimeout(() => {
        if (res.destroyed) return;
        if (req.url && status === 200) acknowledged.push(req.url);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end('{}');
      }, delayMs);
      res.once('close', () => clearTimeout(timer));
    });
    req.resume();
  });
  const traceRequest = new Promise<void>((resolve) => {
    endpoint.on('request', (req) => {
      if (req.url === tracePath) resolve();
    });
  });
  server = endpoint;
  endpoint.listen(0, '127.0.0.1');
  await once(endpoint, 'listening');
  const { port } = endpoint.address() as AddressInfo;
  return {
    acknowledged,
    traceRequest,
    experiment: openExperimentClient({
      baseUrl: `http://127.0.0.1:${port}`,
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    }),
  };
}

async function recordTrial(experiment: ReturnType<typeof openExperimentClient>) {
  await expect(
    experiment.client.experiment.run({
      name: 'export-test',
      data: [{ input: 'trial' }],
      task: async ({ input }) => input,
    }),
  ).resolves.toMatchObject({ itemResults: [{ output: 'trial' }] });
}

test('close waits for a slow score batch to be acknowledged', { timeout: 20_000 }, async () => {
  const { acknowledged, experiment } = await serve(200, slowResponseMs);
  experiment.client.score.create({ name: 'quality', value: 1, traceId: 'a'.repeat(32) });
  await experiment.close();
  expect(acknowledged).toEqual([scorePath]);
});

test('close waits for a slow buffered span to be acknowledged', { timeout: 20_000 }, async () => {
  const { acknowledged, experiment } = await serve(200, slowResponseMs);
  await recordTrial(experiment);
  await experiment.close();
  expect(acknowledged).toEqual([tracePath]);
});

test('close waits for a slow background span to be acknowledged', { timeout: 20_000 }, async () => {
  const { acknowledged, traceRequest, experiment } = await serve(200, slowResponseMs);
  await recordTrial(experiment);
  await traceRequest;
  await experiment.close();
  expect(acknowledged).toEqual([tracePath]);
});

test('close rejects when a buffered span is permanently refused', async () => {
  const { experiment } = await serve(400);
  await recordTrial(experiment);
  await expect(experiment.close()).rejects.toSatisfy((failure: unknown) => {
    const errors: unknown[] = Array.isArray(failure) ? failure : [failure];
    return errors.some((error) => error instanceof Error && error.message === 'Bad Request');
  });
});

test('close rejects when a background span export is permanently refused', {
  timeout: 15_000,
}, async () => {
  const { traceRequest, experiment } = await serve(400);
  await recordTrial(experiment);
  await traceRequest;
  await expect(experiment.close()).rejects.toThrow('Experiment trace export failed');
});
