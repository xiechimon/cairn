import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupOverlaps, resolveOverlap } from './github-overlap.mjs';

test('searches titles and bodies with alternative terms and includes same-file PRs', async () => {
  const calls = [];
  const report = await lookupOverlaps({
    repo: 'octo/repo',
    terms: ['retry', 'temporary push'],
    paths: ['git.ts'],
    request: async (path) => {
      calls.push(path);
      if (path.includes('/files')) return [{ filename: 'git.ts' }];
      if (path.includes('/pulls?'))
        return [
          { number: 9, title: 'Different work', body: '', state: 'open', head: { ref: 'lane/9' } },
        ];
      if (path.includes('is%3Aissue'))
        return [
          {
            number: 1786,
            title: 'Retry transient push failures',
            body: 'Retry temporary git errors',
            state: 'open',
          },
        ];
      return [{ number: 8, title: 'Recently merged', body: 'push', state: 'closed' }];
    },
    now: new Date('2026-10-26T00:00:00Z'),
  });
  assert.deepEqual(
    report.openIssues.map((item) => item.number),
    [1786],
  );
  assert.deepEqual(
    report.filePulls.map((item) => [item.number, item.head.ref, item.overlappingFiles]),
    [[9, 'lane/9', ['git.ts']]],
  );
  assert.equal(report.recentPulls[0].number, 8);
  assert.ok(calls.some((path) => decodeURIComponent(path).includes('in:title,body')));
  assert.ok(calls.some((path) => decodeURIComponent(path).includes('merged:>=2026-10-19')));
});

test('lookup errors stop creation rather than reporting no overlaps', async () => {
  await assert.rejects(
    lookupOverlaps({
      repo: 'octo/repo',
      terms: ['retry'],
      paths: [],
      request: async () => {
        throw new Error('rate limit');
      },
    }),
    /rate limit/,
  );
});

test('duplicate ask eval: a rephrased request extends the existing item without creating an issue', async () => {
  const writes = [];
  const report = {
    openIssues: [{ number: 1786, title: 'Retry transient push failures' }],
    openPulls: [],
    recentPulls: [],
    filePulls: [],
  };
  const result = await resolveOverlap({
    report,
    sameAsk: 1786,
    kind: 'issue',
    body: 'Please repeat pushes when temporary network errors occur.',
    write: async (...args) => {
      writes.push(args);
      return { number: 1786 };
    },
  });
  assert.equal(result.action, 'extended');
  assert.deepEqual(
    writes.map(([path]) => path),
    ['issues/1786/comments'],
  );
  assert.ok(!writes.some(([path]) => path === 'issues'));
});

test('an existing same-ask PR also extends its discussion, and unknown references fail closed', async () => {
  const report = { openIssues: [], openPulls: [{ number: 9 }], recentPulls: [], filePulls: [] };
  const writes = [];
  await resolveOverlap({
    report,
    sameAsk: 9,
    kind: 'pull',
    body: 'Extend this change.',
    write: async (...args) => {
      writes.push(args);
    },
  });
  assert.equal(writes[0][0], 'issues/9/comments');
  await assert.rejects(
    resolveOverlap({ report, sameAsk: 99, kind: 'issue', body: 'x', write: async () => {} }),
    /not in the overlap report/,
  );
});

test('empty planned paths fail before querying GitHub instead of hiding file overlaps', async () => {
  let requests = 0;
  await assert.rejects(
    lookupOverlaps({
      repo: 'octo/repo',
      terms: ['retry'],
      paths: ['   '],
      request: async () => {
        requests++;
        return [];
      },
    }),
    /planned path/,
  );
  assert.equal(requests, 0);
});
