import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { cleanupTestTempDirs, makeTestTempDir } from '../scripts/test-tmpdir.mjs';
import { runLaneTask } from './harness/lane.js';
import type { LaneTask } from './harness/types.js';
import { scoreLane } from './scorers/lane-checks.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAM_DIR = join(ROOT, 'eval');

afterAll(cleanupTestTempDirs);

const savedEnv: Record<string, string | undefined> = {};
function setEnv(entries: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(entries)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key];
});

function writeStubDevin(dir: string, scriptBody: string): string {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, 'devin');
  writeFileSync(binPath, `#!/usr/bin/env node\n${scriptBody}\n`);
  chmodSync(binPath, 0o755);
  return binPath;
}

function readTask(id: string): LaneTask {
  return JSON.parse(
    readFileSync(join(EXAM_DIR, 'tasks', 'lane', id, 'task.json'), 'utf8'),
  ) as LaneTask;
}

describe('eval lane harness', () => {
  it('passes --permission-mode dangerous and --process-model in-process and isolates HOME', async () => {
    const dir = makeTestTempDir('eval-stub-');
    const devinHome = join(dir, 'devin-home');
    mkdirSync(devinHome, { recursive: true });
    const argsLog = join(dir, 'args.json');
    const envLog = join(dir, 'env.json');
    const cmdEnvLog = join(dir, 'cmd-env.json');
    writeStubDevin(
      dir,
      `
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)));
      fs.writeFileSync(${JSON.stringify(envLog)}, JSON.stringify({ HOME: process.env.HOME, PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE }));
      fs.writeFileSync('main.py', 'def greet(name):\\n  return "hello " + name\\n');
      `,
    );
    setEnv({
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
      EVAL_DAILY_DEVIN_HOME: devinHome,
    });
    const cmdScript = join(dir, 'record-cmd-env.cjs');
    writeFileSync(
      cmdScript,
      `require('node:fs').writeFileSync(${JSON.stringify(cmdEnvLog)}, JSON.stringify({ HOME: process.env.HOME }));\n`,
    );
    const task: LaneTask = {
      ...readTask('add-fn'),
      timeoutMs: 2_000,
      checks: {
        files: [{ path: 'main.py', contains: 'def greet' }],
        commands: [`node ${JSON.stringify(cmdScript)}`],
      },
    };
    const record = await runLaneTask(task, EXAM_DIR);
    expect(record.incomplete).toBeUndefined();
    const argv = JSON.parse(readFileSync(argsLog, 'utf8')) as string[];
    expect(argv).toContain('--permission-mode');
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('dangerous');
    expect(argv).toContain('--process-model');
    expect(argv[argv.indexOf('--process-model') + 1]).toBe('in-process');
    expect(argv).toContain('--respect-workspace-trust');
    expect(JSON.parse(readFileSync(envLog, 'utf8'))).toEqual({
      HOME: devinHome,
      PYTHONDONTWRITEBYTECODE: '1',
    });
    expect(JSON.parse(readFileSync(cmdEnvLog, 'utf8'))).toEqual({ HOME: devinHome });
    expect(typeof (record as { durationMs?: number }).durationMs).toBe('number');
    expect(scoreLane(task, record).every((c) => c.value === 1)).toBe(true);
  });

  it('resolves devin binary from EVAL_DEVIN_BIN -> PATH -> real HOME managed tools before child HOME override', async () => {
    const dir = makeTestTempDir('eval-bin-order-');
    const fakeRealHome = join(dir, 'real-home');
    const devinHome = join(dir, 'devin-home');
    mkdirSync(devinHome, { recursive: true });
    const managedDir = join(fakeRealHome, '.cairn', 'tools', 'devin', 'versions', '3000.14.999');
    writeStubDevin(managedDir, 'process.exit(0);');
    mkdirSync(join(fakeRealHome, '.cairn', 'tools', 'devin'), { recursive: true });
    writeFileSync(
      join(fakeRealHome, '.cairn', 'tools', 'devin', 'current.json'),
      JSON.stringify({ version: '3000.14.999' }),
    );
    const overrideDir = join(dir, 'override');
    const overrideBin = writeStubDevin(overrideDir, 'process.exit(0);');
    const { resolveDevinBin } = await import('./harness/devin-env.mjs');
    expect(
      resolveDevinBin({
        EVAL_DEVIN_BIN: overrideBin,
        PATH: '/usr/bin:/bin',
        HOME: fakeRealHome,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      }),
    ).toBe(overrideBin);
    const pathDir = join(dir, 'path-devin');
    const pathBin = writeStubDevin(pathDir, 'process.exit(0);');
    expect(
      resolveDevinBin({
        PATH: `${join(pathDir, 'bin')}:/usr/bin`,
        HOME: fakeRealHome,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      }),
    ).toBe(pathBin);
    expect(
      resolveDevinBin({
        PATH: '/nonexistent-eval-bin',
        HOME: fakeRealHome,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      }),
    ).toBe(join(managedDir, 'bin', 'devin'));
  });

  it('classifies confirmation rejection, login failure, quota error, and ENOENT as incomplete, while distinguishing unrecognized non-zero exit and stdout 401', async () => {
    const dir = makeTestTempDir('eval-classify-');
    const task: LaneTask = { ...readTask('fix-bug'), timeoutMs: 2_000 };
    const cases = [
      {
        label: 'permission-rejected',
        code: `process.stderr.write('warning: rejected a tool call that requires confirmation\\n'); process.exit(0);`,
        wantIncomplete: true,
      },
      {
        label: 'login-canceled',
        code: `process.stderr.write('Error: Login canceled\\n'); process.exit(1);`,
        wantIncomplete: true,
      },
      {
        label: 'quota-exceeded',
        code: `process.stderr.write('HTTP 429 quota limit reached\\n'); process.exit(1);`,
        wantIncomplete: true,
      },
      {
        label: 'unrecognized-exit-1',
        code: `process.stderr.write('model could not figure out the fix\\n'); process.exit(1);`,
        wantIncomplete: false,
      },
      {
        label: 'stdout-401-only',
        code: `process.stdout.write('Note: HTTP 401 is an auth status code\\n'); process.exit(1);`,
        wantIncomplete: false,
      },
    ];
    for (const c of cases) {
      const caseDir = join(dir, c.label);
      const bin = writeStubDevin(caseDir, c.code);
      setEnv({
        EVAL_DEVIN_BIN: bin,
        PATH: `${join(caseDir, 'bin')}:${process.env.PATH ?? ''}`,
      });
      const record = await runLaneTask(task, EXAM_DIR);
      if (c.wantIncomplete) {
        expect(record.incomplete, c.label).toBeTruthy();
      } else {
        expect(record.incomplete, c.label).toBeUndefined();
        expect(record.lane?.exitCode, c.label).toBe(1);
        expect(
          scoreLane(task, record).find((s) => s.name === 'lane.completed')?.value,
          c.label,
        ).toBe(0);
      }
    }
    setEnv({
      EVAL_DEVIN_BIN: join(dir, 'does-not-exist', 'devin'),
      PATH: '/usr/bin:/bin',
    });
    const missing = await runLaneTask(task, EXAM_DIR);
    expect(missing.incomplete).toBeTruthy();
  });

  it('classifies timeout and ENOBUFS as task failure rather than incomplete', async () => {
    const dir = makeTestTempDir('eval-timeout-');
    const timeoutBin = writeStubDevin(dir, `setTimeout(() => {}, 5000);`);
    setEnv({
      EVAL_DEVIN_BIN: timeoutBin,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
    });
    const timeoutTask: LaneTask = { ...readTask('fix-bug'), timeoutMs: 250 };
    const timedOut = await runLaneTask(timeoutTask, EXAM_DIR);
    expect(timedOut.incomplete).toBeUndefined();
    expect(scoreLane(timeoutTask, timedOut).find((s) => s.name === 'lane.completed')?.value).toBe(
      0,
    );
    expect((timedOut as { diagnostics?: string }).diagnostics ?? '').toContain('timeout');

    const floodBin = writeStubDevin(
      join(dir, 'flood'),
      `const chunk = 'x'.repeat(1024 * 1024); for (let i = 0; i < 20; i++) process.stdout.write(chunk);`,
    );
    setEnv({
      EVAL_DEVIN_BIN: floodBin,
      PATH: `${join(dir, 'flood', 'bin')}:${process.env.PATH ?? ''}`,
    });
    const floodTask: LaneTask = { ...readTask('fix-bug'), timeoutMs: 5_000 };
    const flooded = await runLaneTask(floodTask, EXAM_DIR);
    expect(flooded.incomplete).toBeUndefined();
    expect(scoreLane(floodTask, flooded).find((s) => s.name === 'lane.completed')?.value).toBe(0);
  });

  it('scrubs secrets and home paths from diagnostics and incomplete messages', async () => {
    const dir = makeTestTempDir('eval-scrub-');
    const secretA = `sk-${'Z'.repeat(24)}`;
    const secretB = `sk-lf-${'Y'.repeat(20)}`;
    const bin = writeStubDevin(
      dir,
      `process.stderr.write('Error: Login canceled using ${secretA} and Bearer ${secretB} at ${dir}/creds\\n'); process.exit(1);`,
    );
    setEnv({
      EVAL_DEVIN_BIN: bin,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: dir,
    });
    const record = await runLaneTask({ ...readTask('fix-bug'), timeoutMs: 2_000 }, EXAM_DIR);
    const text = `${record.incomplete ?? ''}\n${(record as { diagnostics?: string }).diagnostics ?? ''}`;
    expect(text).not.toContain(secretA);
    expect(text).not.toContain(secretB);
    expect(text).not.toContain(dir);
  });

  it('excludes __pycache__ and .pyc artifacts and removes temp workspace', async () => {
    const dir = makeTestTempDir('eval-pyc-');
    const bin = writeStubDevin(
      dir,
      `
      const fs = require('node:fs');
      fs.mkdirSync('__pycache__', { recursive: true });
      fs.writeFileSync('__pycache__/main.cpython-312.pyc', 'compiled');
      fs.writeFileSync('main.py', 'def greet(name):\\n  return "hello " + name\\n');
      `,
    );
    setEnv({
      EVAL_DEVIN_BIN: bin,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
    });
    const beforeDirs = new Set(
      readdirSync(tmpdir()).filter((n) => n.startsWith('eval-lane-add-fn-')),
    );
    const record = await runLaneTask({ ...readTask('add-fn'), timeoutMs: 2_000 }, EXAM_DIR);
    const afterDirs = readdirSync(tmpdir()).filter(
      (n) => n.startsWith('eval-lane-add-fn-') && !beforeDirs.has(n),
    );
    expect(afterDirs).toEqual([]);
    expect(record.lane?.changedFiles).toEqual(['main.py']);
    expect(scoreLane(readTask('add-fn'), record).every((c) => c.value === 1)).toBe(true);
  });

  it('validates fix-bug behaviorally and rename-var on word boundaries', () => {
    const dir = makeTestTempDir('eval-tasks-');
    const fixBug = readTask('fix-bug');
    const fixDir = join(dir, 'fix-bug');
    cpSync(join(EXAM_DIR, 'tasks', 'lane', 'fix-bug', 'repo'), fixDir, { recursive: true });
    for (const candidate of [
      { code: 'def s(a, b): return a + b\n', pass: true },
      { code: 'def s(a, b): return float(a) + float(b)\n', pass: true },
      { code: 'def s(a, b): return str(a) + str(b)\n', pass: false },
    ]) {
      writeFileSync(join(fixDir, 'sum.py'), candidate.code);
      const filesOk = fixBug.checks.files.every(
        (f) =>
          existsSync(join(fixDir, f.path)) &&
          (f.contains === undefined ||
            readFileSync(join(fixDir, f.path), 'utf8').includes(f.contains)),
      );
      const cmdsOk = fixBug.checks.commands.every(
        (cmd) => spawnSync('bash', ['-c', cmd], { cwd: fixDir, encoding: 'utf8' }).status === 0,
      );
      expect(filesOk && cmdsOk).toBe(candidate.pass);
    }

    const renameVar = readTask('rename-var');
    const renameDir = join(dir, 'rename-var');
    cpSync(join(EXAM_DIR, 'tasks', 'lane', 'rename-var', 'repo'), renameDir, { recursive: true });
    for (const candidate of [
      { code: 'result = 1\nprint(tmp)\n', pass: false },
      { code: 'result = 1\ntmpl = 2\nprint(result, tmpl)\n', pass: true },
    ]) {
      writeFileSync(join(renameDir, 'code.py'), candidate.code);
      const cmdsOk = renameVar.checks.commands.every(
        (cmd) => spawnSync('bash', ['-c', cmd], { cwd: renameDir, encoding: 'utf8' }).status === 0,
      );
      expect(cmdsOk).toBe(candidate.pass);
    }
  });

  it('resolves EVAL_MAX_DEVIN_RUNS safely across empty, zero, negative, and non-numeric values', async () => {
    const { resolveDevinCap } = await import('./harness/budget.js');
    expect(resolveDevinCap(undefined, 40)).toBe(40);
    expect(resolveDevinCap('', 40)).toBe(40);
    expect(resolveDevinCap('   ', 40)).toBe(40);
    expect(resolveDevinCap('0', 40)).toBe(0);
    expect(resolveDevinCap('12', 40)).toBe(12);
    expect(() => resolveDevinCap('-1', 40)).toThrow();
    expect(() => resolveDevinCap('abc', 40)).toThrow();
  });

  it('extracts Langfuse trace metadata and projectId from experiment results', async () => {
    const dir = makeTestTempDir('eval-run-lf-ok-');
    const bin = writeStubDevin(
      dir,
      `require('node:fs').writeFileSync('sum.py', 'def s(a, b): return a + b\\n');`,
    );
    setEnv({
      EVAL_DEVIN_BIN: bin,
      EVAL_MAX_DEVIN_RUNS: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: 'https://lf.example.test',
    });
    const { runEval } = await import('./run.js');
    const outOk = join(dir, 'ok.json');
    const codeOk = await runEval(
      [
        '--arm',
        'daily-test',
        '--exam',
        EXAM_DIR,
        '--out',
        outOk,
        '--only',
        'lane',
        '--require-langfuse',
      ],
      {
        openClient: () => ({
          client: {
            experiment: {
              run: async (cfg: { data: unknown[]; task: (item: unknown) => Promise<unknown> }) => {
                const itemResults = [];
                for (let i = 0; i < cfg.data.length; i += 1) {
                  itemResults.push({
                    item: cfg.data[i],
                    output: await cfg.task(cfg.data[i]),
                    traceId: `trace-${i}`,
                  });
                }
                return {
                  experimentId: 'exp-123',
                  experimentUrl: 'https://lf.example.test/project/proj-abc/experiments/exp-123',
                  runName: 'eval-daily-test',
                  itemResults,
                  runEvaluations: [],
                };
              },
            },
          } as never,
          close: async () => {},
        }),
      },
    );
    expect(codeOk).toBe(0);
    const written = JSON.parse(readFileSync(outOk, 'utf8')) as {
      langfuse?: { projectId?: string; experimentId?: string; experimentUrl?: string };
      items: { traceId?: string; traceUrl?: string; durationMs?: number }[];
    };
    expect(written.langfuse?.projectId).toBe('proj-abc');
    expect(written.langfuse?.experimentId).toBe('exp-123');
    expect(written.items[0]?.traceId).toBe('trace-0');
    expect(written.items[0]?.traceUrl).toBe(
      'https://lf.example.test/project/proj-abc/traces/trace-0',
    );
  });

  it('exits 3 on Langfuse config, experiment, itemResults, or close failures', async () => {
    const dir = makeTestTempDir('eval-run-lf-err-');
    setEnv({
      EVAL_MAX_DEVIN_RUNS: '0',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: undefined,
    });
    const { runEval } = await import('./run.js');
    expect(
      await runEval([
        '--arm',
        'bad-base',
        '--exam',
        EXAM_DIR,
        '--out',
        join(dir, 'no-base.json'),
        '--only',
        'lane',
        '--require-langfuse',
      ]),
    ).toBe(3);

    setEnv({ LANGFUSE_BASE_URL: 'https://lf.example.test' });
    expect(
      await runEval([
        '--arm',
        'bad-combo',
        '--exam',
        EXAM_DIR,
        '--out',
        join(dir, 'combo.json'),
        '--only',
        'lane',
        '--offline',
        '--require-langfuse',
      ]),
    ).toBe(3);

    expect(
      await runEval(
        [
          '--arm',
          'throw-exp',
          '--exam',
          EXAM_DIR,
          '--out',
          join(dir, 'throw.json'),
          '--only',
          'lane',
          '--require-langfuse',
        ],
        {
          openClient: () => ({
            client: {
              experiment: {
                run: async () => {
                  throw new Error('langfuse down');
                },
              },
            } as never,
            close: async () => {},
          }),
        },
      ),
    ).toBe(3);

    expect(
      await runEval(
        [
          '--arm',
          'missing-items',
          '--exam',
          EXAM_DIR,
          '--out',
          join(dir, 'missing.json'),
          '--only',
          'lane',
          '--require-langfuse',
        ],
        {
          openClient: () => ({
            client: {
              experiment: {
                run: async () => ({
                  experimentId: 'exp-1',
                  runName: 'r',
                  itemResults: [],
                  runEvaluations: [],
                }),
              },
            } as never,
            close: async () => {},
          }),
        },
      ),
    ).toBe(3);

    expect(
      await runEval(
        [
          '--arm',
          'close-fail',
          '--exam',
          EXAM_DIR,
          '--out',
          join(dir, 'close-fail.json'),
          '--only',
          'lane',
          '--require-langfuse',
        ],
        {
          openClient: () => ({
            client: {
              experiment: {
                run: async (cfg: {
                  data: unknown[];
                  task: (item: unknown) => Promise<unknown>;
                }) => ({
                  experimentId: 'exp-1',
                  runName: 'r',
                  itemResults: await Promise.all(
                    cfg.data.map(async (item, i) => ({
                      item,
                      output: await cfg.task(item),
                      traceId: `t-${i}`,
                    })),
                  ),
                  runEvaluations: [],
                }),
              },
            } as never,
            close: async () => {
              throw new Error('Experiment trace export failed');
            },
          }),
        },
      ),
    ).toBe(3);
  });
});
