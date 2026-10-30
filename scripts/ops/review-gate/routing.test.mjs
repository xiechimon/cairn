import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const file = (filename, extra = {}) => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 0,
  patch: '@@ text',
  ...extra,
});
const cases = [
  ['protected paths', [file('apps/server/src/lib/keys.ts')]],
  ['outside the auto-merge set', [file('LICENSE')]],
  ['deleted test files', [file('apps/web/test/a.test.ts', { status: 'removed' })]],
  ['binary files', [file('apps/web/src/a.png', { patch: undefined })]],
  ['git binary detection', [file('apps/web/src/a.ts', { gitBinary: true })]],
  ['lines changed', [file('apps/web/src/a.ts', { additions: 801 })]],
  ['files changed', Array.from({ length: 41 }, (_, i) => file(`apps/web/src/a${i}.ts`))],
  ['pause', [file('apps/web/src/a.ts')], { paused: true }],
  ['bootstrap', [file('apps/web/src/a.ts')], { branch: 'B0/2186' }],
  [
    'renamed protected path',
    [file('apps/web/src/a.ts', { status: 'renamed', previous_filename: '.claude/rules.md' })],
  ],
  [
    'renamed test',
    [
      file('apps/web/src/a.ts', {
        status: 'renamed',
        previous_filename: 'apps/web/test/a.test.ts',
      }),
    ],
  ],
  ['API failure', [file('apps/web/src/a.ts')], { apiFailure: true }],
  ['eligible', [file('apps/web/src/a.ts')]],
];
for (const [name, files, options = {}] of cases) {
  for (const cached of [false, true])
    test(`${name}: ${cached ? 'cached' : 'fresh'} PASS reconciles auto-merge`, () => {
      const root = mkdtempSync(join(tmpdir(), 'review-gate-'));
      roots.push(root);
      const log = join(root, 'calls');
      const sha = 'a'.repeat(40);
      const pr = {
        number: 2186,
        isDraft: false,
        headRefOid: sha,
        headRefName: options.branch ?? 'feature/test',
        files: files.map((f) => ({ path: f.filename })),
        title: 'test',
        labels: [{ name: 'review-gate' }],
      };
      writeFileSync(
        join(root, 'data.json'),
        JSON.stringify({
          pr,
          files,
          paused: options.paused,
          apiFailure: options.apiFailure,
          comments: cached
            ? [{ body: `<!-- review-gate:${sha} -->\n**Independent review gate: PASS**` }]
            : [],
        }),
      );
      const stub = join(root, 'stub');
      writeFileSync(
        stub,
        `#!${process.execPath}\nconst fs = require('node:fs');\nconst a = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a)+'\\n');\nconst d=JSON.parse(fs.readFileSync(${JSON.stringify(join(root, 'data.json'))}));\nif(a.includes('list') && a.includes('pr')) console.log(JSON.stringify([d.pr]));\nelse if(a.includes('list') && a.includes('issue')) console.log(JSON.stringify(d.paused?[{number:1}]:[]));\nelse if(a.includes('api')) { if(d.apiFailure) process.exit(1); console.log(JSON.stringify([d.files])); }\nelse if(a.includes('comments')) console.log(JSON.stringify({comments:d.comments}));\nelse if(a.includes('run')) console.log('VERDICT: pass');\n`,
        { mode: 0o755 },
      );
      const git = join(root, 'git');
      writeFileSync(
        git,
        `#!${process.execPath}\nconst d = require(${JSON.stringify(join(root, 'data.json'))});\nif (process.argv.includes('--numstat')) for (const f of d.files) console.log((f.gitBinary || f.patch === undefined) ? '-\\t-\\t'+f.filename : '1\\t0\\t'+f.filename);\n`,
        { mode: 0o755 },
      );
      const gh = join(root, 'gh');
      execFileSync('ln', ['-s', stub, gh]);
      const ai = join(root, 'ai-route');
      execFileSync('ln', ['-s', stub, ai]);
      writeFileSync(join(root, 'prompt'), 'Review the change.');
      const result = spawnSync(
        process.execPath,
        [new URL('./review-gate.mjs', import.meta.url).pathname],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            REVIEW_GATE_MAIN: root,
            REVIEW_GATE_BOT: stub,
            REVIEW_GATE_STATE: join(root, 'state'),
            REVIEW_GATE_MERGE: stub,
            REVIEW_GATE_PROMPT: join(root, 'prompt'),
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      const armed = calls.some((a) => a.includes('--auto'));
      const disarmed = calls.some((a) => a.includes('--disable-auto'));
      assert.equal(armed, name === 'eligible', JSON.stringify(calls));
      assert.equal(disarmed, name !== 'eligible', JSON.stringify(calls));
      if (!cached) assert.ok(calls.some((a) => a.includes('comment')));
    });
}

test('standalone workflow and Node adapter return the same six isolated owner reasons', async () => {
  const source = readFileSync(
    new URL('../../../.claude/workflows/pr-gate.js', import.meta.url),
    'utf8',
  );
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction(
    'args',
    'agent',
    'parallel',
    'pipeline',
    'log',
    source.replace('export const meta', 'const meta'),
  );
  for (const [reason, files] of cases.filter(([name]) =>
    [
      'protected paths',
      'outside the auto-merge set',
      'deleted test files',
      'binary files',
      'lines changed',
      'files changed',
    ].includes(name),
  )) {
    const args = {
      pr: 1,
      ticket: 2186,
      headSha: 'a'.repeat(40),
      changedFiles: files.map((f) => f.filename),
      deletedFiles: files.filter((f) => f.status === 'removed').map((f) => f.filename),
      binaryFiles: files.filter((f) => f.patch === undefined).map((f) => f.filename),
      linesChanged: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
    };
    const agent = async () => ({ ...args, checked: 'stub', findings: [] });
    const pipeline = (items, ...stages) =>
      Promise.all(
        items.map(async (item) => {
          let result = item;
          for (const stage of stages) result = await stage(result, item);
          return result;
        }),
      );
    const result = await run(
      args,
      agent,
      async () => [],
      pipeline,
      () => {},
    );
    assert.equal(result.mergedBy, 'user');
    assert.equal(result.humanReasons.length, 1);
    assert.ok(result.humanReasons[0].includes(reason), result.humanReasons[0]);
  }
});
