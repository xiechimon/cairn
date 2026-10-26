import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { join, resolve } from 'node:path';
import { trajectoryPackSchema } from '@cairn/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

vi.setConfig({ testTimeout: 30_000 });

const fixtures = resolve(import.meta.dirname, 'fixtures/trajectory-attribution');
const packsFile = join(fixtures, 'packs.jsonl');
const labeledFile = join(fixtures, 'labeled.jsonl');

interface LabelerRequest {
  authorization: string | undefined;
  body: { model: string; messages: { role: string; content: string }[] };
}

let server: Server;
let baseUrl: string;
let requests: LabelerRequest[];
let reply: (request: LabelerRequest) => unknown;
const dirs: string[] = [];

const verdict = {
  where: 'runtime',
  why: 'premature_finish',
  evidence: [{ stepId: 'any', messageIndex: 2 }],
};

beforeEach(async () => {
  requests = [];
  reply = (request) => {
    const buildId = /build-[a-z]+/.exec(request.body.messages.at(-1)?.content ?? '')?.[0];
    return { ...verdict, evidence: [{ stepId: `${buildId}-step-1`, messageIndex: 2 }] };
  };
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request = {
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      };
      requests.push(request);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(request)) } }] }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch() {
  const dir = makeTestTempDir('cairn-attr-');
  dirs.push(dir);
  return dir;
}

function cli(file: string, args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, ['--import', 'tsx', `src/${file}`, ...args], {
      cwd: resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        CAIRN_LABELER_BASE_URL: baseUrl,
        CAIRN_LABELER_API_KEY: 'test-key',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

const label = (args: string[]) => cli('trajectory-label-cli.ts', args);
const summarize = (args: string[]) => cli('trajectory-attribution-summary-cli.ts', args);

function readPacks(path: string) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => trajectoryPackSchema.parse(JSON.parse(line)));
}

test('labels only failed packs and leaves merged or pending packs untouched', async () => {
  const out = join(scratch(), 'labeled.jsonl');
  const result = await label(['--in', packsFile, '--out', out, '--model', 'openai/gpt-5']);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(`labeled=3 already_labeled=0 not_failed=2 out=${out}`);
  const packs = readPacks(out);
  expect(packs.map((pack) => pack.buildId)).toEqual([
    'build-unmerged',
    'build-reverted',
    'build-fixed',
    'build-merged',
    'build-pending',
  ]);
  const labeled = packs.slice(0, 3);
  for (const pack of labeled) {
    expect(pack.attribution).toEqual({
      where: 'runtime',
      why: 'premature_finish',
      evidence: [{ stepId: `${pack.buildId}-step-1`, messageIndex: 2 }],
      labeler: 'openai/gpt-5',
      labeledAt: expect.any(Number),
    });
  }
  expect(packs.slice(3).map((pack) => pack.attribution)).toEqual([null, null]);
  expect(requests).toHaveLength(3);
  expect(requests[0]?.authorization).toBe('Bearer test-key');
  expect(requests[0]?.body.model).toBe('openai/gpt-5');
  expect(requests[0]?.body.messages.at(-1)?.content).toContain('tests failed');
});

test('stable output: relabeling the same input yields the same structure', async () => {
  const dir = scratch();
  const first = join(dir, 'a.jsonl');
  const second = join(dir, 'b.jsonl');
  await label(['--in', packsFile, '--out', first, '--model', 'openai/gpt-5']);
  await label(['--in', packsFile, '--out', second, '--model', 'openai/gpt-5']);
  const strip = (path: string) =>
    readPacks(path).map((pack) => ({
      ...pack,
      attribution: pack.attribution && { ...pack.attribution, labeledAt: 0 },
    }));
  expect(strip(first)).toEqual(strip(second));
});

test('rejects a labeler that is the tested model, with or without provider prefix', async () => {
  for (const model of [
    'anthropic/claude-sonnet-4',
    'claude-sonnet-4',
    'claude-code/claude-sonnet-4',
  ]) {
    const out = join(scratch(), 'labeled.jsonl');
    const result = await label(['--in', packsFile, '--out', out, '--model', model]);
    expect(result.status, model).toBe(1);
    expect(result.stderr, model).toContain('Labeler must differ from the tested model');
    expect(existsSync(out), model).toBe(false);
  }
  expect(requests).toHaveLength(0);
});

test('does not call the labeler for packs that are already labeled', async () => {
  const out = join(scratch(), 'labeled.jsonl');
  const result = await label(['--in', labeledFile, '--out', out, '--model', 'openai/gpt-5-mini']);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('labeled=0 already_labeled=5 not_failed=1');
  expect(requests).toHaveLength(0);
  expect(readFileSync(out, 'utf8')).toBe(readFileSync(labeledFile, 'utf8'));
});

test('a verdict outside the vocabularies or pointing at a missing message fails the run without output', async () => {
  const replies: unknown[] = [
    { ...verdict, where: 'harness' },
    { ...verdict, why: 'laziness' },
    { ...verdict, evidence: [{ stepId: 'no-such-step', messageIndex: 0 }] },
    { ...verdict, evidence: [{ stepId: 'build-unmerged-step-1', messageIndex: 99 }] },
    'not json at all',
  ];
  for (const value of replies) {
    reply = () => value;
    const out = join(scratch(), 'labeled.jsonl');
    const result = await label(['--in', packsFile, '--out', out, '--model', 'openai/gpt-5']);
    expect(result.status, JSON.stringify(value)).toBe(1);
    expect(result.stderr).toContain('build-unmerged');
    expect(existsSync(out)).toBe(false);
  }
});

test('refuses to overwrite an existing output file', async () => {
  const out = join(scratch(), 'labeled.jsonl');
  writeFileSync(out, 'keep');
  const result = await label(['--in', packsFile, '--out', out, '--model', 'openai/gpt-5']);
  expect(result.status).toBe(1);
  expect(readFileSync(out, 'utf8')).toBe('keep');
});

test('requires --in, --out and --model', async () => {
  const result = await label(['--in', packsFile]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Use --in <packs.jsonl> --out <labeled.jsonl> --model <id>');
});

test('summary prints a (where, why) count table sorted by count', async () => {
  const result = await summarize([labeledFile]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(
    [
      'where\twhy\tcount',
      'runtime\tpremature_finish\t2',
      'prompt\tignored_instruction\t1',
      'runtime\twrong_tool\t1',
      'infra\tother\t1',
      'total=6 unlabeled=1',
      '',
    ].join('\n'),
  );
});

test('summary merges several files and rejects an invalid pack', async () => {
  const merged = await summarize([labeledFile, labeledFile]);
  expect(merged.stdout).toContain('runtime\tpremature_finish\t4');
  expect(merged.stdout).toContain('total=12 unlabeled=2');
  const broken = join(scratch(), 'broken.jsonl');
  writeFileSync(broken, `${readFileSync(labeledFile, 'utf8').replace('"runtime"', '"harness"')}`);
  const result = await summarize([broken]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('attribution.where');
});
