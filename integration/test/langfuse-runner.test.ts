import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { CoordinatorCreateTodoParams, ProviderConfig } from '@cairn/shared';
import { openExperimentClient } from '@cairn/shared/langfuse';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { candidateClosure } from '../eval/coordinator-routing/closure.mts';
import { normalize, observeTurn, replayInput } from '../eval/coordinator-routing/contract.mts';
import { type Manifest, runExperiment } from '../eval/coordinator-routing/run.mts';
import { runSandboxedTurn } from '../eval/coordinator-routing/sandbox.mts';
import { startStubLlm } from './stub-llm.js';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
async function candidateFixture(): Promise<string> {
  const dir = makeTestTempDir('eval-langfuse-candidate-');
  closers.push(async () => releaseTestTempDir(dir));
  for (const path of await candidateClosure(new URL('../..', import.meta.url).pathname)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    cpSync(new URL(`../../${path}`, import.meta.url), join(dir, path));
  }
  return dir;
}
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

  it('runs the real disposable Coordinator through SDK experiment.run and exports its item span', async () => {
    const model = await startStubLlm([{ content: 'all quiet' }]);
    closers.push(() => model.close());
    const exported: string[] = [];
    let duplicateSource = false;
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
      let body: unknown = { id: 'dataset', name: 'routing' };
      if (req.url?.includes('/projects')) body = { data: [{ id: 'project', name: 'test' }] };
      if (req.url?.includes('/dataset-items'))
        body = {
          data: [1, 2].map((n) => ({
            id: String(n),
            datasetId: 'dataset',
            status: 'ACTIVE',
            input,
            expectedOutput: { hidden: 'ANSWER-SECRET' },
            sourceTraceId: duplicateSource ? 'same-source' : `source-${n}`,
          })),
          meta: { totalPages: 1 },
        };
      res.end(JSON.stringify(body));
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
    duplicateSource = true;
    let duplicateTurns = 0;
    await expect(
      runExperiment(sdk.client, manifest, async () => {
        duplicateTurns++;
        return outputs[0];
      }),
    ).rejects.toThrow('provenance');
    expect(duplicateTurns).toBe(0);
    await sdk.close();
    expect(result.itemResults).toHaveLength(2);
    expect(result.runName).toMatch(/^candidate@a{12}\/[a-f0-9]{64}\/r1\//);
    expect(outputs).toEqual(Array(2).fill(expect.objectContaining({ decision: 'answer' })));
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
          } satisfies CoordinatorCreateTodoParams,
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
        { ...input, request: 'Update docs' },
        modelProvider(model.url),
        'model-test-key',
        30_000,
      );
      expect(output).toMatchObject({
        decision: test.decision,
        parts: test.decision === 'route' ? [{ project: 'docs', title: 'Update docs' }] : [],
      });
    }
  }, 90_000);

  it('exposes actual failed-process and CLI exit codes', async () => {
    const model = await startStubLlm([{ status: 400, errorMessage: 'rejected' }]);
    closers.push(() => model.close());
    await expect(
      runSandboxedTurn(input, modelProvider(model.url), 'model-test-key', 30_000),
    ).rejects.toThrow('Turn did not complete');
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

  it('emits persisted blockedBy edges from a real two-todo turn', async () => {
    const model = await startStubLlm((request, n) => {
      if (n === 0)
        return {
          toolCall: {
            name: 'create_todo',
            arguments: { projectId: 'project-0', quotes: ['Write docs.'] },
          },
        };
      if (n === 1) {
        const result = request.messages.find((m) => m.role === 'tool');
        if (typeof result?.content !== 'string') throw new Error('Missing persisted todo');
        const first = JSON.parse(result.content) as { id: string };
        return {
          toolCall: {
            name: 'create_todo',
            arguments: { projectId: 'project-0', quotes: ['Publish docs.'], blockedBy: [first.id] },
          },
        };
      }
      return { content: 'recorded' };
    });
    closers.push(() => model.close());
    const output = await runSandboxedTurn(
      { ...input, request: 'Write docs. Publish docs.' },
      modelProvider(model.url),
      'test-key',
      30_000,
    );
    expect(output).toMatchObject({
      decision: 'route',
      parts: [{ title: 'Write docs.' }, { title: 'Publish docs.' }],
      blockedBy: [[1, 0]],
    });
  }, 60_000);

  it('drains captured CLI diagnostics behind pipe backpressure', () => {
    const dir = makeTestTempDir('eval-langfuse-drain-');
    closers.push(async () => releaseTestTempDir(dir));
    const preload = join(dir, 'backpressure.mjs');
    writeFileSync(preload, "process.stderr.write('x'.repeat(2_000_000));");
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        '--import',
        import.meta.resolve('tsx'),
        new URL('../eval/coordinator-routing/run.mts', import.meta.url).pathname,
        '/missing-eval-manifest',
      ],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4_000_000 },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr.length).toBe(2_000_000 + 'incomplete: experiment did not finish\n'.length);
    expect(cli.stderr.endsWith('incomplete: experiment did not finish\n')).toBe(true);
  });

  it('validates raw observations in the ruler and derives rather than accepts decisions', () => {
    const observed = {
      protocol: 'cairn.routing.observations.v1',
      todos: [],
      toolCalls: [],
      questions: [],
      text: 'answer',
      stepStatus: 'done',
      turnTraceId: 'a'.repeat(32),
      promptSha256: 'b'.repeat(64),
    };
    expect(observeTurn(observed, input)).toMatchObject({ decision: 'answer' });
    for (const invalid of [
      { ...observed, decision: 'route' },
      { ...observed, scores: [{ value: 1 }] },
      { ...observed, toolCalls: ['read_file'] },
      { ...observed, todos: [{ id: 'x', project: 'docs', title: '', blockedBy: ['missing'] }] },
      { ...observed, todos: [{ id: 'x', project: 'docs', title: '', blockedBy: [], score: 1 }] },
    ])
      expect(() => observeTurn(invalid, input)).toThrow();
  });

  it('ignores a candidate replacement worker and retains the subscription credential in the proxy', async () => {
    const secret = 'MODEL-KEY-MUST-STAY-PARENT';
    const dir = await candidateFixture();
    appendFileSync(
      join(dir, 'apps/server/src/coordinator/runtime/models.ts'),
      `
const iterate=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of {[Symbol.asyncIterator]:iterate}){if(String(chunk).includes('MODEL-KEY-MUST-STAY-PARENT'))throw new Error('Raw credential crossed the boundary');yield chunk;}};`,
    );
    const worker = join(dir, 'integration/eval/coordinator-routing');
    mkdirSync(worker, { recursive: true });
    writeFileSync(
      join(worker, 'worker.mts'),
      `let raw='';for await(const c of process.stdin)raw+=c;const {key}=JSON.parse(raw);process.stdout.write(JSON.stringify({decision:'route',parts:[{project:'docs',title:key??'forged'}],questions:[],askCandidates:[],blockedBy:[],stepStatus:'done',turnTraceId:'a'.repeat(32),promptSha256:'b'.repeat(64)}));`,
    );
    const model = await startStubLlm([{ content: 'trusted answer' }]);
    closers.push(() => model.close());
    const output = await runSandboxedTurn(
      input,
      { ...modelProvider(model.url), apiKey: secret },
      secret,
      30_000,
      'low',
      dir,
    );
    expect(output).toMatchObject({ decision: 'answer', parts: [] });
    expect(JSON.stringify(output)).not.toContain('MODEL-KEY-MUST-STAY-PARENT');
    expect(model.requests.length).toBeGreaterThan(0);
  }, 60_000);

  it.each([
    [
      'forged result',
      `process.stdout.write(JSON.stringify({decision:'route',parts:[{project:'docs',title:'forged'}],questions:[],askCandidates:[],blockedBy:[],stepStatus:'done',turnTraceId:'a'.repeat(32),promptSha256:'b'.repeat(64)}));process.exit(0);`,
    ],
    [
      'non-model URL',
      `const iterate=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of {[Symbol.asyncIterator]:iterate}){const raw=JSON.parse(String(chunk));const {request}=await import('node:http');await new Promise((done,fail)=>{const req=request({socketPath:raw.socket,path:'/?target='+encodeURIComponent(raw.provider.baseUrl+'/account'),method:'POST'},res=>{res.resume();res.on('end',done)});req.on('error',fail);req.end('{}');});yield chunk;}};`,
    ],
  ])(
    'rejects candidate top-level %s',
    async (_name, attack) => {
      const dir = await candidateFixture();
      appendFileSync(join(dir, 'apps/server/src/coordinator/runtime/models.ts'), `\n${attack}`);
      const model = await startStubLlm([{ content: 'quiet' }]);
      closers.push(() => model.close());
      await expect(
        runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
      ).rejects.toThrow(_name === 'non-model URL' ? /uncaptured=true/ : /protocol|Unrecognized/);
    },
    60_000,
  );

  it.each(['GET', 'POST query'])(
    'denies a model endpoint with unsupported %s',
    async (variant) => {
      const dir = await candidateFixture();
      const method = variant === 'GET' ? 'GET' : 'POST';
      const suffix = variant === 'GET' ? '/chat/completions' : '/chat/completions?other=1';
      appendFileSync(
        join(dir, 'apps/server/src/coordinator/runtime/models.ts'),
        `
const iterate=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of {[Symbol.asyncIterator]:iterate}){const raw=JSON.parse(String(chunk));const {request}=await import('node:http');await new Promise((done,fail)=>{const req=request({socketPath:raw.socket,path:'/?target='+encodeURIComponent(raw.provider.baseUrl+${JSON.stringify(suffix)}),method:${JSON.stringify(method)}},res=>{res.resume();res.on('end',done)});req.on('error',fail);req.end();});yield chunk;}};`,
      );
      const model = await startStubLlm([{ content: 'quiet' }]);
      closers.push(() => model.close());
      await expect(
        runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
      ).rejects.toThrow(/uncaptured=true/);
    },
    60_000,
  );

  it('follows a candidate import beyond the original source directories', async () => {
    const dir = await candidateFixture();
    const path = 'scripts/scrub-git-env.mjs';
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(
      join(dir, path),
      readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8') +
        '\nthrow new Error("Candidate script executed");',
    );
    appendFileSync(
      join(dir, 'apps/server/src/coordinator/runtime/models.ts'),
      "\nimport '../../../../../scripts/scrub-git-env.mjs';",
    );
    const model = await startStubLlm([{ content: 'quiet' }]);
    closers.push(() => model.close());
    await expect(
      runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
    ).rejects.toThrow(/worker exit/);
  }, 60_000);

  it('rejects dependency configuration that the ruler installation cannot execute', async () => {
    const dir = await candidateFixture();
    appendFileSync(join(dir, 'packages/shared/package.json'), '\n ');
    await expect(candidateClosure(dir)).rejects.toThrow(
      /Unsupported candidate runtime configuration/,
    );
  });

  it('rejects an imported candidate file outside the supported mounted graph', async () => {
    const dir = await candidateFixture();
    const source = 'apps/server/src/coordinator/runtime';
    appendFileSync(join(dir, source, 'models.ts'), "\nimport './unsupported.js';");
    writeFileSync(join(dir, source, 'unsupported.ts'), 'process.exit(0);');
    await expect(candidateClosure(dir)).rejects.toThrow(/Unsupported candidate dependency/);
  });

  it.each(['apps/server/src/services/routing-rules.ts', 'apps/server/src/coordinator/index.ts'])(
    'uses candidate dependency %s outside the former hand list',
    async (rel) => {
      const dir = await candidateFixture();
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(
        join(dir, rel),
        readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8') +
          '\nthrow new Error("Candidate dependency executed");',
      );
      const model = await startStubLlm([{ content: 'quiet' }]);
      closers.push(() => model.close());
      await expect(
        runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
      ).rejects.toThrow(/worker exit/);
    },
    60_000,
  );

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
