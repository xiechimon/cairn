import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bugClassSlug,
  findingKey,
  issueFor,
  knownKeys,
  parseFindings,
  planIssues,
} from './findings.mjs';
import { countChanges, rankHotspots, sliceFor } from './hotspots.mjs';
import { runNightly } from './run.mjs';

const finding = (over = {}) => ({
  file: 'apps/server/src/a.ts',
  line: 12,
  severity: 'high',
  bugClass: 'Unchecked JSON.parse',
  title: 'parse can throw',
  evidence: 'Line 12 calls JSON.parse on request input without a guard.',
  ...over,
});

test('rankHotspots orders by changes times lines and drops tests, docs and other languages', () => {
  const changes = countChanges(
    [
      'apps/server/src/big.ts',
      'apps/server/src/big.ts',
      'apps/server/src/small.ts',
      'apps/server/test/big.test.ts',
      'docs/x.ts',
      'README.md',
      'apps/web/src/locales/en.ts',
      'apps/web/src/i18n/en.ts',
      'apps/server/src/empty.ts',
    ].join('\n'),
  );
  const lineCounts = new Map([
    ['apps/server/src/big.ts', 500],
    ['apps/server/src/small.ts', 20],
    ['apps/server/test/big.test.ts', 900],
    ['docs/x.ts', 900],
    ['apps/web/src/locales/en.ts', 900],
    ['apps/web/src/i18n/en.ts', 900],
  ]);
  const ranked = rankHotspots({ changes, lineCounts });
  assert.deepEqual(
    ranked.map((entry) => entry.file),
    ['apps/server/src/big.ts', 'apps/server/src/small.ts'],
  );
  assert.equal(ranked[0].score, 1000);
});

test('sliceFor rotates through the hotspot pool one slice per day and wraps', () => {
  const ranked = Array.from({ length: 12 }, (_, i) => ({ file: `f${i}.ts` }));
  const options = { pool: 12, size: 5 };
  const nights = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'].map((date) =>
    sliceFor(ranked, date, options),
  );
  assert.equal(new Set(nights.slice(0, 3).map((slice) => slice.join())).size, 3);
  assert.deepEqual(nights[3], nights[0]);
  assert.deepEqual(sliceFor([], '2026-11-04'), []);
  assert.ok(nights.flat().every((file) => ranked.some((entry) => entry.file === file)));
});

test('parseFindings keeps valid findings in the slice and drops malformed ones', () => {
  const slice = ['apps/server/src/a.ts'];
  const text = `Here you go:\n${JSON.stringify([
    finding(),
    finding({ file: 'apps/server/src/other.ts' }),
    finding({ line: '12' }),
    finding({ severity: 'low' }),
    finding({ bugClass: '!!!' }),
    finding({ evidence: '  ' }),
    null,
  ])}\nDone.`;
  assert.deepEqual(parseFindings(text, slice), [finding()]);
  assert.deepEqual(parseFindings('no findings', slice), []);
  assert.deepEqual(parseFindings('[not json]', slice), []);
  assert.deepEqual(parseFindings('{"a":1}', slice), []);
});

test('parseFindings collapses repeats of the same file and bug class', () => {
  const slice = ['apps/server/src/a.ts'];
  const repeated = [
    finding(),
    finding({ line: 40, title: 'again' }),
    finding({ bugClass: 'Other' }),
  ];
  assert.equal(parseFindings(JSON.stringify(repeated), slice).length, 2);
});

test('the dedupe key is the file plus the normalized bug class', () => {
  assert.equal(bugClassSlug('  Unchecked  JSON.parse! '), 'unchecked-json-parse');
  assert.equal(findingKey(finding()), 'apps/server/src/a.ts::unchecked-json-parse');
  assert.equal(
    findingKey(finding({ bugClass: 'unchecked json parse', line: 99 })),
    findingKey(finding()),
  );
});

test('planIssues skips keys already reported, even in closed issues, and caps a night', () => {
  const known = knownKeys([issueFor(finding()).body, 'unrelated body', null]);
  assert.ok(known.has(findingKey(finding())));
  const plan = planIssues(
    [finding(), finding({ bugClass: 'b' }), finding({ bugClass: 'c', severity: 'medium' })],
    known,
    1,
  );
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].bugClass, 'b');
  assert.equal(plan.deferred.length, 1);
});

test('issueFor carries the location, the bug class and the dedupe marker', () => {
  const issue = issueFor(finding());
  assert.match(issue.title, /^nightly-scan: parse can throw \(apps\/server\/src\/a\.ts\)$/);
  assert.match(issue.body, /apps\/server\/src\/a\.ts:12/);
  assert.match(issue.body, /<!-- nightly-scan:apps\/server\/src\/a\.ts::unchecked-json-parse -->/);
});

const logOf = (file, times) => Array.from({ length: times }, () => file).join('\n');
const fakeRun = ({ agentText, issuesBody = [] }) => {
  const calls = [];
  const records = [];
  const run = () =>
    runNightly({
      date: '2026-11-04',
      changedFiles: () =>
        `${logOf('apps/server/src/a.ts', 3)}\n${logOf('apps/server/src/b.ts', 1)}`,
      lineCount: () => 100,
      askAgent: async (prompt) => {
        calls.push({ kind: 'agent', prompt });
        return agentText;
      },
      gh: (args) => {
        calls.push({ kind: 'gh', args });
        if (args[1] === 'list') return JSON.stringify(issuesBody.map((body) => ({ body })));
        return 'https://github.com/o/r/issues/1\n';
      },
      record: (entry) => {
        records.push(entry);
        return entry;
      },
    });
  return { run, calls, records };
};

test('a night files the agent findings as labelled issues and records the run', async () => {
  const { run, calls, records } = fakeRun({ agentText: JSON.stringify([finding()]) });
  await run();
  const agent = calls.find((call) => call.kind === 'agent');
  assert.match(agent.prompt, /Slice:\n- apps\/server\/src\/a\.ts\n- apps\/server\/src\/b\.ts/);
  const created = calls.filter((call) => call.kind === 'gh' && call.args[1] === 'create');
  assert.equal(created.length, 1);
  assert.ok(created[0].args.includes('found-by:nightly-scan'));
  assert.equal(records[0].status, 'ok');
  assert.equal(records[0].created.length, 1);
});

test('the second night does not reopen a problem that already has an issue', async () => {
  const { run, calls, records } = fakeRun({
    agentText: JSON.stringify([finding()]),
    issuesBody: [issueFor(finding()).body],
  });
  await run();
  assert.equal(calls.filter((call) => call.kind === 'gh' && call.args[1] === 'create').length, 0);
  assert.equal(records[0].duplicates, 1);
  assert.deepEqual(records[0].created, []);
});

test('a night with no hotspots writes a run record and calls nothing', async () => {
  const calls = [];
  const records = [];
  await runNightly({
    date: '2026-11-04',
    changedFiles: () => 'README.md',
    lineCount: () => 100,
    askAgent: async () => calls.push('agent'),
    gh: () => calls.push('gh'),
    record: (entry) => records.push(entry),
  });
  assert.deepEqual(calls, []);
  assert.equal(records[0].status, 'empty-slice');
});
