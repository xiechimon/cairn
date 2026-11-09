import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ProviderConfig } from '@cairn/shared';
import { openExperimentClient } from '@cairn/shared/langfuse';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { normalize, replayInput } from '../eval/coordinator-routing/contract.mts';
import { fingerprint, type Manifest, runExperiment } from '../eval/coordinator-routing/run.mts';
import { runSandboxedTurn } from '../eval/coordinator-routing/sandbox.mts';
import { startStubLlm } from './stub-llm.js';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
const input = {
  request: 'What is ready?',
  projects: [{ name: 'docs', description: 'Documentation' }],
};
function modelProvider(url: string): ProviderConfig {
  return {
    kind: 'http',
    providerId: 'openai-codex',
    api: 'openai-completions',
    baseUrl: url,
    models: [{ id: 'gpt-6.1-sol', name: 'test' }],
  };
}
const manifest: Manifest = {
  dataset: 'routing',
  version: '2026-11-09T00:00:00.000Z',
  candidateSha: 'a'.repeat(40),
  runnerSha: 'b'.repeat(40),
  promptSha: 'c'.repeat(64),
  evaluatorVersions: {},
  thinking: 'low',
  arm: 'candidate',
  repeat: 1,
};

describe('Langfuse Coordinator runner', () => {
  it('uses one observable decision and rejects mixed, failed and empty turns', () => {
    expect(normalize('done', [], false, 'answer')).toBe('answer');
    expect(normalize('done', ['docs'], false, '')).toBe('route');
    expect(normalize('claimed', [], true, '')).toBe('ask');
    for (const args of [
      ['done', ['docs'], true, ''],
      ['failed', [], false, 'answer'],
      ['done', [], false, ''],
    ] as const)
      expect(() => normalize(args[0], args[1], args[2], args[3])).toThrow();
    expect(() => replayInput.parse({ ...input, repository: 'current checkout' })).toThrow();
    expect(() =>
      replayInput.parse({ ...input, projects: [input.projects[0], input.projects[0]] }),
    ).toThrow();
  });

  it('fingerprints the immutable configuration and captured worlds', () => {
    const first = fingerprint({ ...manifest, inputs: [input] });
    expect(first).toBe(fingerprint({ inputs: [input], ...manifest }));
    expect(first).not.toBe(
      fingerprint({ ...manifest, candidateSha: 'd'.repeat(40), inputs: [input] }),
    );
    expect(first).not.toBe(
      fingerprint({ ...manifest, inputs: [{ ...input, request: 'changed' }] }),
    );
  });

  it('runs the real disposable Coordinator through SDK experiment.run and exports its item span', async () => {
    const model = await startStubLlm([{ content: 'all quiet' }]);
    closers.push(() => model.close());
    const exported: string[] = [];
    const http = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (req.url?.includes('/traces')) {
        const body = Buffer.concat(chunks);
        exported.push(
          (req.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body).toString(),
        );
        res.setHeader('content-type', 'application/json');
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          req.url?.includes('/projects')
            ? { data: [{ id: 'project', name: 'test' }] }
            : req.url?.includes('/dataset-items')
              ? {
                  data: [1, 2].map((n) => ({
                    id: String(n),
                    datasetId: 'dataset',
                    status: 'ACTIVE',
                    input,
                    expectedOutput: { hidden: 'ANSWER-SECRET' },
                    metadata: {},
                    sourceTraceId: 'real-source-fixture',
                  })),
                  meta: { totalPages: 1 },
                }
              : { id: 'dataset', name: 'routing' },
        ),
      );
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    closers.push(async () => {
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    });
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const sdk = openExperimentClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      publicKey: 'test-public',
      secretKey: 'LANGFUSE-SECRET',
    });
    closers.push(() => sdk.close());
    const outputs: unknown[] = [];
    const result = await runExperiment(sdk.client, manifest, async (world) => {
      expect(JSON.stringify(world)).not.toMatch(/ANSWER-SECRET|LANGFUSE-SECRET/);
      const out = await runSandboxedTurn(world, modelProvider(model.url), 'model-test-key', 30_000);
      outputs.push(out);
      return out;
    });
    let attempts = 0;
    await expect(
      runExperiment(sdk.client, manifest, async () => {
        attempts++;
        throw new Error('quota');
      }),
    ).rejects.toThrow('incomplete');
    expect(attempts).toBe(1);
    await sdk.close();
    expect(result.itemResults).toHaveLength(2);
    expect(outputs).toEqual([
      expect.objectContaining({ decision: 'answer' }),
      expect.objectContaining({ decision: 'answer' }),
    ]);
    expect(exported.join('')).toContain('experiment-item-run');
    expect(JSON.stringify(model.requests)).not.toMatch(/ANSWER-SECRET|LANGFUSE-SECRET/);
  }, 90_000);

  it('normalizes persisted routing and a pending user question in fresh isolated stacks', async () => {
    for (const test of [
      {
        decision: 'route',
        toolCall: {
          name: 'create_todo',
          arguments: {
            projectId: 'project-0',
            title: 'Update docs',
            spec: 'Owner request: update docs',
          },
        },
      },
      {
        decision: 'ask',
        toolCall: {
          name: 'ask_user',
          arguments: {
            questions: [
              { header: 'Project', question: 'Which project?', options: [{ label: 'docs' }] },
            ],
          },
        },
      },
    ]) {
      const model = await startStubLlm([test, { content: 'recorded' }]);
      closers.push(() => model.close());
      const output = await runSandboxedTurn(
        input,
        modelProvider(model.url),
        'model-test-key',
        30_000,
      );
      expect(output).toMatchObject({ decision: test.decision });
    }
  }, 90_000);

  it('exposes actual failed-process and CLI exit codes', async () => {
    const model = await startStubLlm([{ status: 400, errorMessage: 'rejected' }]);
    closers.push(() => model.close());
    await expect(
      runSandboxedTurn(input, modelProvider(model.url), 'model-test-key', 30_000),
    ).rejects.toThrow('worker exit 2');
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        new URL('../eval/coordinator-routing/run.mts', import.meta.url).pathname,
        '/missing-eval-manifest',
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('incomplete');
  }, 60_000);

  it('blocks host files, inherited credentials, direct network and non-model socket requests', async () => {
    const dir = makeTestTempDir('eval-langfuse-probe-');
    const outside = `${dir}-answer`;
    closers.push(async () => {
      releaseTestTempDir(dir);
      rmSync(outside, { force: true });
    });
    writeFileSync(outside, 'EXPECTED-ANSWER');
    const previous = process.env.LANGFUSE_SECRET_KEY;
    process.env.LANGFUSE_SECRET_KEY = 'PARENT-ONLY-KEY';
    closers.push(async () => {
      if (previous === undefined) delete process.env.LANGFUSE_SECRET_KEY;
      else process.env.LANGFUSE_SECRET_KEY = previous;
    });
    symlinkSync(
      realpathSync(new URL('../../node_modules', import.meta.url).pathname),
      join(dir, 'node_modules'),
    );
    const worker = join(dir, 'integration/eval/coordinator-routing');
    mkdirSync(worker, { recursive: true });
    writeFileSync(
      join(worker, 'worker.mts'),
      `
      import { readFileSync } from 'node:fs';
      import { request } from 'node:http';
      let body=''; for await (const chunk of process.stdin) body+=chunk;
      const {socket}=JSON.parse(body);
      if (process.env.LANGFUSE_SECRET_KEY || process.env.GH_TOKEN) process.exit(3);
      let read=false; try { readFileSync(${JSON.stringify(outside)}); read=true; } catch {}
      if (read) process.exit(4);
      let connected=false; try { await fetch('http://127.0.0.1:8787', { signal: AbortSignal.timeout(100) }); connected=true; } catch {}
      if (connected) process.exit(5);
      await new Promise((done, fail) => { const req=request({socketPath:socket,path:'/?target=https%3A%2F%2Flangfuse.invalid%2Fapi%2Fpublic%2Fdatasets'},res=>{res.resume();res.on('end',done)}); req.on('error',fail);req.end(); });
      process.stdout.write('{}');
    `,
    );
    await expect(
      runSandboxedTurn(
        input,
        modelProvider('https://chatgpt.com/backend-api'),
        'test-key',
        10_000,
        'low',
        dir,
      ),
    ).rejects.toThrow('uncaptured=true');
  });

  it('enforces a real worker deadline without leaving a successful result', async () => {
    await expect(
      runSandboxedTurn(
        input,
        {
          kind: 'http',
          providerId: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api',
          models: [],
        },
        'not-a-token',
        1,
      ),
    ).rejects.toThrow(/incomplete/);
  });
});
