import { execFile } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { packageProductionRuntime } from './package.mjs';
import { packagingTestsRequested, requirePackagingPlatform } from './packaging-platform.mjs';

const packaging = packagingTestsRequested(process.env.CAIRN_EVAL_PACKAGING_TESTS);
beforeAll(async () => {
  if (packaging) await requirePackagingPlatform();
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});
const repository = resolve(import.meta.dirname, '../../../..');
function scratch() {
  const root = makeTestTempDir('production-package-');
  roots.push(root);
  return root;
}
function candidate(root: string) {
  const target = join(root, 'candidate');
  for (const path of [
    'apps/daemon/src',
    'packages/shared/src',
    'packages/shared/merge-gate-paths.json',
    'integration/eval/harbor/production/runner.mts',
    'integration/eval/harbor/production/run-task.mts',
  ]) {
    mkdirSync(resolve(target, path, '..'), { recursive: true });
    cpSync(join(repository, path), join(target, path), { recursive: true });
  }
  writeFileSync(
    join(target, 'package.json'),
    JSON.stringify({ scripts: { build: 'exit 91', prepack: 'exit 92' } }),
  );
  return target;
}

test.skipIf(!packaging).each(['absolute', 'symlink'] as const)(
  'builder cannot bundle an outside secret through an %s import',
  async (mode) => {
    const root = scratch();
    const source = candidate(root);
    const secret = join(root, 'outside-secret.ts');
    writeFileSync(secret, 'export default "private fixture must never enter a runtime bundle";');
    const production = join(source, 'integration/eval/harbor/production');
    let importPath = secret;
    if (mode === 'symlink') {
      symlinkSync(secret, join(production, 'leak.ts'));
      importPath = './leak.ts';
    }
    const entry = join(production, 'run-task.mts');
    writeFileSync(
      entry,
      `import leak from ${JSON.stringify(importPath)}; console.log(leak);\n${readFileSync(entry, 'utf8')}`,
    );
    await expect(
      packageProductionRuntime({
        candidateRoot: source,
        dependencyRoot: repository,
        outputDir: join(root, 'output'),
      }),
    ).rejects.toThrow(/Could not resolve|outside the build allowlist/);
  },
);

test.skipIf(!packaging)(
  'staged runtime has no Cairn checkout or sourcemaps and completes a fake-model task',
  async () => {
    const root = scratch();
    const output = join(root, 'runtime');
    const manifest = await packageProductionRuntime({
      candidateRoot: candidate(root),
      dependencyRoot: repository,
      outputDir: output,
    });
    expect(manifest.packages).toContainEqual(
      expect.objectContaining({ name: '@earendil-works/pi-coding-agent', version: '1.4.0' }),
    );
    const paths: string[] = [];
    const walk = (path: string) => {
      for (const entry of readdirSync(join(output, path), { withFileTypes: true })) {
        const relative = join(path, entry.name);
        paths.push(relative);
        if (entry.isSymbolicLink()) {
          expect(readlinkSync(join(output, relative)).startsWith('/')).toBe(false);
          expect(realpathSync(join(output, relative)).startsWith(`${output}/`)).toBe(true);
        }
        if (entry.isDirectory()) walk(relative);
      }
    };
    walk('');
    expect(
      paths.some((path) =>
        /(?:^|\/)(?:\.git|tests?|__tests__|eval|grader)(?:\/|$)|\.map$/.test(path),
      ),
    ).toBe(false);
    expect(
      paths.some(
        (path) => path.includes('apps/daemon/src') || path.includes('packages/shared/src'),
      ),
    ).toBe(false);
    const taskDir = join(root, 'app');
    mkdirSync(taskDir);
    let calls = 0;
    const server = createServer(async (request, response) => {
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text) as { messages: { role: string }[] };
      calls++;
      const final = body.messages.some((message) => message.role === 'tool');
      const delta = final
        ? { role: 'assistant', content: 'Staged runtime completed.' }
        : {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'staged-write',
                type: 'function',
                function: {
                  name: 'write',
                  arguments: JSON.stringify({ path: 'answer.txt', content: 'staged tool output' }),
                },
              },
            ],
          };
      const event = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: 'staged', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        `${event(delta, null)}${event({}, final ? 'stop' : 'tool_calls')}data: [DONE]\n\n`,
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing fake model port');
      const descriptor = join(root, 'descriptor.json');
      writeFileSync(
        descriptor,
        JSON.stringify({
          taskDir,
          stateDir: join(root, 'state'),
          claimed: {
            step: { id: 'step', buildId: 'app', kind: 'session', machineId: 'eval', createdAt: 1 },
            conversationId: 'app',
            session: { action: 'new', sessionId: null },
            instruction: 'Write answer.txt.',
            project: { id: 'project', name: 'Task', repo: null },
            agent: {
              id: 'worker',
              displayName: 'Worker',
              description: 'Use production task execution.',
              provider: 'eval-model',
              modelId: 'fixture',
              thinkingLevel: 'low',
            },
            mcpServers: [],
          },
          provider: {
            kind: 'http',
            providerId: 'eval-model',
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            api: 'openai-completions',
            models: [{ id: 'fixture', name: 'Fixture' }],
          },
        }),
      );
      const artifacts = join(root, 'artifacts');
      await promisify(execFile)(
        process.execPath,
        [join(output, 'run-task.mjs'), descriptor, artifacts],
        {
          cwd: taskDir,
          env: {
            PATH: process.env.PATH,
            HOME: join(root, 'home'),
            CAIRN_CUSTOM_MODEL_REASONING: '1',
          },
          timeout: 30_000,
        },
      );
      expect(calls).toBe(2);
      expect(readFileSync(join(taskDir, 'answer.txt'), 'utf8')).toBe('staged tool output');
      expect(JSON.parse(readFileSync(join(artifacts, 'execution.json'), 'utf8')).done.status).toBe(
        'success',
      );
      expect(readFileSync(join(artifacts, 'session.jsonl'), 'utf8')).toContain(
        'Staged runtime completed.',
      );
      if (process.env.VERIFY_EVIDENCE_DIR !== undefined) {
        const evidence = process.env.VERIFY_EVIDENCE_DIR;
        mkdirSync(evidence, { recursive: true });
        cpSync(output, join(evidence, 'runtime'), { recursive: true, verbatimSymlinks: true });
        cpSync(artifacts, join(evidence, 'artifacts'), { recursive: true });
        writeFileSync(join(evidence, 'packaging-manifest.json'), JSON.stringify(manifest));
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  },
);
