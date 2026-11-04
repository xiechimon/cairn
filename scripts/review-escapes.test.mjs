import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { prepushPlan } from './prepush.mjs';

const gate = JSON.parse(
  readFileSync(new URL('./fixtures/review-escapes/gate.json', import.meta.url)),
);
const head = 'a'.repeat(40);
const merged = '2026-10-20T12:00:00Z';
const prefix = 'repos/xiechimon/cairn';

function review(login, type = 'User', changes = {}) {
  return {
    user: { login, type },
    state: 'APPROVED',
    submitted_at: '2026-10-20T10:00:00Z',
    commit_id: head,
    html_url: `https://github.com/xiechimon/cairn/pull/10#pullrequestreview-${login}`,
    body: '',
    ...changes,
  };
}

function trace(originalPr, followUpTimestamp, followUpSha, changes = {}) {
  return {
    originalPr,
    introducingSha: 'b'.repeat(40),
    introducingMergedAt: merged,
    followUpTimestamp,
    followUpSha,
    status: 'resolved',
    withinEscapeWindow: true,
    method: 'revert-body',
    evidence: { paths: ['apps/example.ts'], references: [] },
    ...changes,
  };
}

function responses(number, reviews = [], comments = [], pull = {}) {
  return {
    [`${prefix}/pulls/${number}`]: {
      number,
      merged_at: merged,
      head: { sha: head },
      body: 'ai-reviewed human-reviewed',
      html_url: `https://github.com/xiechimon/cairn/pull/${number}`,
      ...pull,
    },
    [`${prefix}/pulls/${number}/reviews?per_page=100&page=1`]: reviews,
    [`${prefix}/issues/${number}/comments?per_page=100&page=1`]: comments,
  };
}

function run(traces, github, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-review-escapes-'));
  try {
    writeFileSync(join(dir, 'responses.json'), JSON.stringify(github));
    writeFileSync(join(dir, 'traces.json'), JSON.stringify(traces));
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.REQUEST_LOG, JSON.stringify(args) + '\\n');
if (args.length !== 2 || args[0] !== 'api') process.exit(90);
const responses = JSON.parse(fs.readFileSync(process.env.RESPONSES));
if (!(args[1] in responses)) process.exit(91);
const response = responses[args[1]];
if (response.error) { process.stderr.write(response.error); process.exit(1); }
process.stdout.write(JSON.stringify(response));
`,
    );
    chmodSync(join(dir, 'gh'), 0o755);
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/review-escapes.mjs'), '--traces', join(dir, 'traces.json'), ...extra],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          RESPONSES: join(dir, 'responses.json'),
          REQUEST_LOG: join(dir, 'requests'),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const requests = readFileSync(join(dir, 'requests'), 'utf8').trim().split('\n').map(JSON.parse);
    return { output: extra.includes('text') ? result.stdout : JSON.parse(result.stdout), requests };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI fetches original PR reviews through every page and retains evidence', () => {
  const github = responses(
    10,
    Array.from({ length: 100 }, () => review('unrelated-bot', 'Bot')),
  );
  github[`${prefix}/pulls/10/reviews?per_page=100&page=2`] = [review('human-reviewer')];
  const { output, requests } = run([trace(10, '2026-10-21T00:00:00Z', 'c'.repeat(40))], github);
  assert.deepEqual(
    requests.map((args) => args[1]),
    [
      `${prefix}/pulls/10`,
      `${prefix}/pulls/10/reviews?per_page=100&page=1`,
      `${prefix}/pulls/10/reviews?per_page=100&page=2`,
      `${prefix}/issues/10/comments?per_page=100&page=1`,
    ],
  );
  assert.equal(output.events[0].review.path, 'human-only');
  assert.equal(output.events[0].review.evidence[0].reviewer, 'human-reviewer');
  assert.equal(output.events[0].review.evidence[0].headSha, head);
  assert.equal(output.events[0].review.evidence[0].timestamp, '2026-10-20T10:00:00Z');
  assert.match(output.events[0].review.evidence[0].url, /pullrequestreview-human-reviewer$/);
});

test('recorded production gate evidence and formal AI and human reviews classify separately', () => {
  const real = gate.pull;
  const github = {
    ...responses(real.number, [], gate.comments, real),
    ...responses(11, [review('chatgpt-codex-connector[bot]', 'Bot')]),
    ...responses(12, [review('human-reviewer'), review('coderabbitai[bot]', 'Bot')]),
    ...responses(13),
  };
  const traces = [
    trace(real.number, '2026-10-29T00:00:00Z', '1'.repeat(40), {
      introducingMergedAt: real.merged_at,
    }),
    ...[11, 12, 13].map((pr) => trace(pr, '2026-10-21T00:00:00Z', String(pr).repeat(20))),
  ];
  const { output } = run(traces, github);
  assert.deepEqual(
    output.events.map((event) => event.review.path),
    ['ai-only', 'ai-only', 'mixed', 'unknown'],
  );
  const evidence = output.events[0].review.evidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].reviewer, 'cairnwright[bot]');
  assert.equal(evidence[0].headSha, real.head.sha);
  assert.equal(evidence[0].url, gate.comments.at(-1).html_url);
  assert.match(evidence[0].basisUrl, /issuecomment-6479079130$/);
});

test('post-merge, edited-after-merge, stale, spoofed and unknown-bot evidence cannot qualify', () => {
  const comment = gate.comments.at(-1);
  const spoof = {
    ...comment,
    body: comment.body.replaceAll(gate.pull.head.sha, head),
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-20T10:00:00Z',
  };
  const github = {
    ...responses(
      14,
      [
        review('late', 'User', { submitted_at: '2026-10-20T12:00:01Z' }),
        review('invalid-head', 'User', { commit_id: 'invalid' }),
        review('pending', 'User', { state: 'PENDING' }),
        review('unknown-service', 'Bot'),
      ],
      [
        comment,
        { ...spoof, user: { login: 'author', type: 'User' }, performed_via_github_app: null },
        { ...spoof, updated_at: '2026-10-21T00:00:00Z' },
        { ...spoof, body: 'ai-reviewed human-reviewed' },
      ],
    ),
    ...responses(
      15,
      [],
      [
        {
          ...spoof,
          body: `<!-- review-gate:${head} -->\n**Independent review gate: PASS** (separate model; gate weakening, eval gaming, correctness) for \`${head.slice(0, 8)}\`.\n\nVERDICT: pass\n<!-- review-gate-patch:${'f'.repeat(40)} -->`,
        },
      ],
    ),
  };
  const { output } = run(
    [
      trace(14, '2026-10-21T00:00:00Z', '4'.repeat(40)),
      trace(15, '2026-10-21T00:00:00Z', '5'.repeat(40)),
    ],
    github,
  );
  assert.equal(output.events[0].review.path, 'unknown');
  assert.deepEqual(output.events[0].review.evidence, []);
  assert.equal(output.events[1].review.path, 'ai-only');
});

test('UTC weeks count distinct original PRs and events and disclose unavailable and unresolved data', () => {
  const unavailable = responses(12);
  unavailable[`${prefix}/pulls/12/reviews?per_page=100&page=1`] = { error: 'HTTP 503' };
  const github = { ...responses(10, [review('human-reviewer')]), ...responses(11), ...unavailable };
  const traces = [
    trace(10, '2026-10-25T23:59:59Z', '1'.repeat(40)),
    trace(10, '2026-10-25T23:59:59Z', '1'.repeat(40)),
    trace(10, '2026-10-25T23:59:59Z', '2'.repeat(40)),
    trace(10, '2026-10-26T00:00:00Z', '3'.repeat(40)),
    trace(11, '2026-10-26T00:00:00Z', '4'.repeat(40)),
    trace(12, '2026-10-26T00:00:00Z', '5'.repeat(40)),
    trace(null, '2026-10-26T00:00:00Z', '6'.repeat(40), {
      status: 'multiple-origin',
      unresolvedReason: 'multiple-associated-prs',
    }),
    trace(10, '2026-11-03T12:00:00Z', '7'.repeat(40)),
    trace(10, '2026-11-03T12:00:00.001Z', '8'.repeat(40)),
    trace(10, '2026-10-20T11:59:59Z', '9'.repeat(40)),
  ];
  const { output, requests } = run(traces, github);
  assert.deepEqual(
    output.weeks.map((week) => [
      week.week,
      week.paths['human-only'],
      week.paths.unknown,
      week.unresolvedEvents,
      week.unavailableReviewEvents,
    ]),
    [
      [
        '2026-10-19',
        { distinctPrs: 1, followUpEvents: 2 },
        { distinctPrs: 0, followUpEvents: 0 },
        0,
        0,
      ],
      [
        '2026-10-26',
        { distinctPrs: 1, followUpEvents: 1 },
        { distinctPrs: 2, followUpEvents: 2 },
        1,
        1,
      ],
      [
        '2026-11-02',
        { distinctPrs: 1, followUpEvents: 1 },
        { distinctPrs: 0, followUpEvents: 0 },
        0,
        0,
      ],
    ],
  );
  assert.deepEqual(output.totals, {
    qualifyingEvents: 6,
    unknownReviewEvents: 2,
    unresolvedEvents: 1,
    unavailableReviewEvents: 1,
    outsideWindowEvents: 2,
    duplicateEvents: 1,
  });
  assert.equal(requests.filter((args) => args[1] === `${prefix}/pulls/10`).length, 1);
  assert.equal(output.events.find((event) => event.originalPr === 12).review.data, 'unavailable');
  assert.ok(output.events.every((event) => event.followUpUrl && event.attributionEvidence));
  assert.deepEqual(Object.keys(output).sort(), [
    'events',
    'excluded',
    'limitations',
    'totals',
    'version',
    'weeks',
    'windowDays',
  ]);
  assert.deepEqual(Object.keys(output.totals).sort(), [
    'duplicateEvents',
    'outsideWindowEvents',
    'qualifyingEvents',
    'unavailableReviewEvents',
    'unknownReviewEvents',
    'unresolvedEvents',
  ]);
  const fixtureDoc = readFileSync(
    new URL('./fixtures/review-escapes/README.md', import.meta.url),
    'utf8',
  );
  assert.match(fixtureDoc, new RegExp(`${output.totals.qualifyingEvents} qualifying events`));
  assert.match(fixtureDoc, /one exactly at the inclusive 14-day boundary/);
  const text = run(traces, github, ['--format', 'text']).output;
  assert.match(text, /2026-10-19/);
  assert.match(text, /human-only: 1 PRs, 2 follow-up events/);
  assert.match(text, /Unknown review: 2/);
  assert.match(text, /Unresolved attribution: 1/);
  assert.match(text, /Unavailable review data: 1/);
  assert.match(text, /pullrequestreview-human-reviewer/);
  assert.match(text, /\/commit\/111111/);
  assert.equal(
    text,
    [
      'Weekly review escapes (UTC Monday weeks)',
      ...output.limitations,
      '',
      ...output.weeks.flatMap((week) => [
        week.week,
        ...Object.entries(week.paths).map(
          ([path, counts]) =>
            `  ${path}: ${counts.distinctPrs} PRs, ${counts.followUpEvents} follow-up events`,
        ),
        `  Unresolved attribution: ${week.unresolvedEvents}; unavailable review data: ${week.unavailableReviewEvents}`,
      ]),
      '',
      'Qualifying events: 6',
      'Unknown review: 2',
      'Unresolved attribution: 1',
      'Unavailable review data: 1',
      'Outside 14 days: 2',
      'Duplicate events: 1',
      '',
      'Evidence',
      ...[...output.events, ...output.excluded].flatMap((event) => [
        `${event.originalPrUrl ?? 'Unresolved PR'} | ${event.followUpUrl ?? 'Unavailable follow-up'} | ${event.review?.path ?? event.reportStatus ?? event.exclusion}`,
        `  Attribution: ${event.method ?? 'unknown'} ${event.introducingUrl ?? ''} ${JSON.stringify(event.attributionEvidence)}`,
        ...(event.review?.evidence ?? []).map(
          (evidence) =>
            `  ${evidence.reviewer} ${evidence.timestamp} ${evidence.headSha} ${evidence.url}${evidence.basisUrl ? ` basis: ${evidence.basisUrl}` : ''}`,
        ),
        ...(event.review?.errors ?? []).map(
          (error) => `  Unavailable: ${error.url} (${error.reason})`,
        ),
        ...(event.review && !event.review.evidence.length
          ? [`  Review sources: ${event.review.sources.join(' ')}`]
          : []),
      ]),
      '',
    ].join('\n'),
  );
  assert.doesNotMatch(text, /\d+(?:\.\d+)?\s*%|\b\d+\s*\/\s*\d+\b/);
});

test('partial pagination failure does not establish a definitive human-only outcome', () => {
  const github = responses(
    10,
    Array.from({ length: 100 }, () => review('human-reviewer')),
  );
  github[`${prefix}/pulls/10/reviews?per_page=100&page=2`] = { error: 'HTTP 403' };
  const { output } = run([trace(10, '2026-10-21T00:00:00Z', '1'.repeat(40))], github);
  assert.equal(output.events[0].review.path, 'unknown');
  assert.equal(output.events[0].review.data, 'unavailable');
  assert.match(output.events[0].review.errors[0].url, /reviews/);
});

test('the CLI suite runs in local and CI prepush plans', () => {
  for (const mode of ['local', 'ci']) {
    assert.ok(
      prepushPlan(['scripts/review-escapes.mjs'], mode).some((args) =>
        args.includes('scripts/review-escapes.test.mjs'),
      ),
    );
  }
});

test('gate comments paginate and stale heads and ungrounded carryovers remain unknown', () => {
  const real = gate.pull;
  const stale = gate.comments.filter((comment) => comment.body.includes('(separate model;'));
  const github = responses(
    real.number,
    [],
    Array.from({ length: 100 }, () => ({
      body: 'ai-reviewed',
      user: { login: 'author', type: 'User' },
    })),
    real,
  );
  github[`${prefix}/issues/${real.number}/comments?per_page=100&page=2`] = [gate.comments.at(-1)];
  const input = [
    trace(real.number, '2026-10-29T00:00:00Z', '1'.repeat(40), {
      introducingMergedAt: real.merged_at,
    }),
  ];
  const ungrounded = run(input, github);
  assert.equal(ungrounded.output.events[0].review.path, 'unknown');
  github[`${prefix}/issues/${real.number}/comments?per_page=100&page=2`] = stale;
  assert.equal(run(input, github).output.events[0].review.path, 'unknown');
  github[`${prefix}/issues/${real.number}/comments?per_page=100&page=2`] = gate.comments;
  assert.equal(run(input, github).output.events[0].review.path, 'ai-only');
});

test('metadata or comment API failure stays visible even when reviews were retrieved', () => {
  const input = [trace(10, '2026-10-21T00:00:00Z', '1'.repeat(40))];
  for (const endpoint of [
    `${prefix}/pulls/10`,
    `${prefix}/issues/10/comments?per_page=100&page=1`,
  ]) {
    const github = responses(10, [review('human-reviewer')]);
    github[endpoint] = { error: 'HTTP 403' };
    const { output } = run(input, github);
    assert.equal(output.events[0].review.path, 'unknown');
    assert.equal(output.totals.unavailableReviewEvents, 1);
    assert.equal(output.events[0].review.errors[0].url, `https://api.github.com/${endpoint}`);
  }
});

test('a recorded BLOCK gate records AI review activity without claiming approval', () => {
  const block = gate.comments[0];
  const blockedHead = block.body.match(/review-gate:([a-f0-9]{40})/)[1];
  const github = responses(gate.pull.number, [], [block], {
    ...gate.pull,
    head: { sha: blockedHead },
  });
  const { output } = run(
    [
      trace(gate.pull.number, '2026-10-29T00:00:00Z', '1'.repeat(40), {
        introducingMergedAt: gate.pull.merged_at,
      }),
    ],
    github,
  );
  assert.equal(output.events[0].review.path, 'ai-only');
  assert.equal(output.events[0].review.evidence[0].verdict, 'BLOCK');
});

test('the resolver outside-window status is excluded rather than counted as unresolved', () => {
  const { output } = run(
    [
      trace(10, '2026-10-21T00:00:00Z', '1'.repeat(40)),
      trace(10, '2026-11-03T12:00:00.001Z', '2'.repeat(40), {
        status: 'outside-window',
        withinEscapeWindow: false,
      }),
    ],
    responses(10),
  );
  assert.equal(output.totals.outsideWindowEvents, 1);
  assert.equal(output.totals.unresolvedEvents, 0);
  assert.equal(output.events.length, 1);
  assert.equal(output.excluded[0].status, 'outside-window');
});

test('malformed review and gate pages disclose unavailable data without crashing the CLI', () => {
  for (const resource of ['reviews', 'comments']) {
    const github = responses(10, [review('human-reviewer')]);
    const endpoint =
      resource === 'reviews'
        ? `${prefix}/pulls/10/reviews?per_page=100&page=1`
        : `${prefix}/issues/10/comments?per_page=100&page=1`;
    github[endpoint] = [null];
    const { output } = run([trace(10, '2026-10-21T00:00:00Z', '1'.repeat(40))], github);
    assert.equal(output.events[0].review.path, 'unknown');
    assert.equal(output.events[0].review.data, 'unavailable');
    assert.equal(output.totals.unavailableReviewEvents, 1);
    assert.equal(output.events[0].review.errors[0].url, `https://api.github.com/${endpoint}`);
  }
});

test('non-approving formal AI reviews do not establish AI coverage', () => {
  for (const state of ['CHANGES_REQUESTED', 'COMMENTED']) {
    const { output } = run(
      [trace(10, '2026-10-21T00:00:00Z', '1'.repeat(40))],
      responses(10, [review('coderabbitai[bot]', 'Bot', { state })]),
    );
    assert.equal(output.events[0].review.path, 'unknown');
    assert.deepEqual(output.events[0].review.evidence, []);
  }
});

test('earlier PR commits retain human evidence with explicit head coverage', () => {
  const earlier = 'e'.repeat(40);
  for (const ai of [[], [review('coderabbitai[bot]', 'Bot')]]) {
    const { output } = run(
      [trace(10, '2026-10-21T00:00:00Z', '1'.repeat(40))],
      responses(10, [review('human-reviewer', 'User', { commit_id: earlier }), ...ai]),
    );
    assert.equal(output.events[0].review.path, ai.length ? 'mixed' : 'human-only');
    assert.equal(output.events[0].review.evidence[0].headSha, earlier);
    assert.equal(output.events[0].review.evidence[0].matchesMergedHead, false);
    assert.equal(output.events[0].review.mergedHeadSha, head);
  }
});
