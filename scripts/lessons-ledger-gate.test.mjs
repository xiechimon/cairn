import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkBaselines,
  checkCounters,
  checkEntry,
  checkLedgerEvents,
  checkLedgerRoot,
  escalationPending,
  eventId,
  freezeBaselines,
  interceptEventsForGate,
  ledgerEntries,
  loadLedger,
  mergedInterception,
  projectCounters,
  readBaselines,
  readEvents,
  recordEvent,
  renderEscalation,
  renderTable,
  renderWeeklySummary,
  weeklySummary,
  writeBaselines,
  writeCounters,
  writeEvents,
} from './lessons-ledger-gate.mjs';

const repoRoot = join(import.meta.dirname, '..');
const lessonsDir = join(repoRoot, 'docs/lessons');
const entryText = (name) => readFileSync(join(lessonsDir, name), 'utf8');
const withField = (text, field, value) =>
  text.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`);

const memoryEntry = '1656-image-not-attached-to-reply.md';
const gateEntry = '1566-prepush-stale-origin-main.md';

test('every migrated entry passes and the old table is gone', () => {
  assert.ok(ledgerEntries(repoRoot).length >= 55);
  assert.deepEqual(checkLedgerRoot(repoRoot), []);
  assert.equal(existsSync(join(repoRoot, 'docs/lessons.md')), false);
});

test('level 5 entry without a reason is rejected', () => {
  const bad = withField(entryText(memoryEntry), 'Notes', '');
  assert.equal(checkEntry(memoryEntry, bad).length, 1);
});

test('level outside 1 to 5 is rejected', () => {
  for (const level of ['0', '6', 'two']) {
    assert.equal(checkEntry(gateEntry, withField(entryText(gateEntry), 'Level', level)).length, 1);
  }
});

test('pending upgrade without a ticket is rejected, with a ticket passes', () => {
  const base = entryText(memoryEntry);
  assert.equal(
    checkEntry(memoryEntry, withField(base, 'Notes', 'pending upgrade to level 2')).length,
    1,
  );
  assert.deepEqual(
    checkEntry(memoryEntry, withField(base, 'Notes', 'pending upgrade to level 2, see #12')),
    [],
  );
});

test('the real bad note that sat on main without a ticket is rejected', () => {
  const unticketed =
    'Negative control: the old table said FULL, the new table says file map; pending upgrade: make --check-coverage also report unmapped route source files';
  const text = withField(entryText(gateEntry), 'Notes', unticketed);
  assert.deepEqual(checkEntry(gateEntry, text), [
    `${gateEntry}: "pending upgrade" in Notes must carry a ticket number`,
  ]);
});

test('file name without a ticket number is rejected', () => {
  const text = entryText(gateEntry);
  for (const name of [
    'prepush-stale-origin-main.md',
    '1566.md',
    '1566-Stale_Ref.md',
    'x1566-a.md',
  ]) {
    assert.equal(checkEntry(name, text).length, 1, name);
  }
});

test('missing, reordered or malformed fields are rejected', () => {
  const text = entryText(gateEntry);
  assert.ok(checkEntry(gateEntry, text.replace(/^Intercepts:.*\n/m, '')).length >= 1);
  assert.ok(checkEntry(gateEntry, withField(text, 'Recurrences', 'many')).length >= 1);
  assert.ok(checkEntry(gateEntry, withField(text, 'Intercepts', '-1')).length >= 1);
  assert.ok(checkEntry(gateEntry, text.replace(/^---\n/, '')).length >= 1);
  assert.ok(
    checkEntry(
      gateEntry,
      text.replace(/Category:([^\n]*)\nSource:([^\n]*)/, 'Source:$2\nCategory:$1'),
    ).some((problem) => problem.includes('fields must be in the order')),
  );
  assert.ok(
    checkEntry(gateEntry, text.replace(/^Level:/m, 'Source: duplicate\nLevel:')).some((problem) =>
      problem.includes('unknown, duplicate or malformed line'),
    ),
  );
});

test('a resurrected docs/lessons.md table is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons-gate-'));
  try {
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    cpSync(join(lessonsDir, gateEntry), join(root, 'docs/lessons', gateEntry));
    assert.deepEqual(checkLedgerRoot(root), []);
    writeFileSync(join(root, 'docs/lessons.md'), '| Category |\n');
    assert.equal(checkLedgerRoot(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two parallel branches each adding an entry merge without conflict', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons-merge-'));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const addEntry = (branch, name) => {
    git('checkout', '-q', '-b', branch, 'main');
    cpSync(join(lessonsDir, gateEntry), join(root, 'docs/lessons', name));
    git('add', '.');
    git('commit', '-q', '-m', branch);
  };
  try {
    git('init', '-q', '-b', 'main');
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    cpSync(join(lessonsDir, memoryEntry), join(root, 'docs/lessons', memoryEntry));
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    addEntry('lane-a', '2001-lane-a-mistake.md');
    addEntry('lane-b', '2002-lane-b-mistake.md');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-edit', 'lane-a');
    git('merge', '-q', '--no-edit', 'lane-b');
    assert.equal(readdirSync(join(root, 'docs/lessons')).length, 3);
    assert.deepEqual(checkLedgerRoot(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the old single table does conflict when two branches append a row', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons-table-'));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const appendRow = (branch) => {
    git('checkout', '-q', '-b', branch, 'main');
    writeFileSync(join(root, 'lessons.md'), `| Category |\n|---|\n| base |\n| ${branch} |\n`);
    git('commit', '-q', '-am', branch);
  };
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(root, 'lessons.md'), '| Category |\n|---|\n| base |\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    appendRow('lane-a');
    appendRow('lane-b');
    git('checkout', '-q', 'lane-a');
    assert.throws(() => git('merge', '-q', '--no-edit', 'lane-b'));
    assert.equal(git('diff', '--name-only', '--diff-filter=U').trim(), 'lessons.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('both upgrade-pending word orders and the original Chinese marker require a ticket', () => {
  for (const note of ['upgrade pending to level 2', '待升至 level 2']) {
    assert.equal(checkEntry(gateEntry, withField(entryText(gateEntry), 'Notes', note)).length, 1);
  }
});

test('table generation rejects malformed entries with the ledger diagnostic', () => {
  assert.throws(
    () => renderTable([{ name: gateEntry, text: 'broken' }]),
    /missing leading --- frontmatter/,
  );
});

test('generated table keeps existing escaped pipes inside their cell', () => {
  const text = withField(entryText(gateEntry), 'Notes', String.raw`git commit \| tail`);
  assert.ok(renderTable([{ name: gateEntry, text }]).includes(String.raw`git commit \| tail`));
  assert.ok(!renderTable([{ name: gateEntry, text }]).includes(String.raw`git commit \\| tail`));
});

test('the CLI can validate and render entries from a checkout path containing spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons checkout '));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    cpSync(
      join(repoRoot, 'scripts/lessons-ledger-gate.mjs'),
      join(root, 'scripts/lessons-ledger-gate.mjs'),
    );
    cpSync(join(lessonsDir, gateEntry), join(root, 'docs/lessons', gateEntry));
    assert.match(
      execFileSync(process.execPath, [join(root, 'scripts/lessons-ledger-gate.mjs')], {
        encoding: 'utf8',
      }),
      /lessons ledger ok/,
    );
    assert.match(
      execFileSync(process.execPath, [join(root, 'scripts/lessons-ledger-gate.mjs'), '--table'], {
        encoding: 'utf8',
      }),
      /File.*Category.*Source/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const ledgerEntry = (
  key,
  { level = 2, since = '2026-10-20', intercepts = 0, recurrences = 0 } = {},
) => ({
  name: `2099-${key}.md`,
  text: `---\nCategory: a symptom written in prose\nSource: #1\nLevel: ${level}\nSafeguard: a gate for this kind; since ${since}\nIntercepts: ${intercepts}\nRecurrences: ${recurrences}\nNotes: free text\n---\n`,
  key,
  ticket: '2099',
  level: String(level),
  activated: since,
  intercepts: String(intercepts),
  recurrences: String(recurrences),
});

const helperKey = 'single-use-helper-gate';
const intercept = (overrides = {}) => ({
  kind: 'intercept',
  repo: 'xiechimon/cairn',
  branch: 'lane/2040',
  at: '2026-10-27T08:00:00Z',
  category: helperKey,
  gate: 'single-use-helper-gate',
  ...overrides,
});
const recurrence = (overrides = {}) => ({
  kind: 'recurrence',
  repo: 'xiechimon/cairn',
  pr: '2043',
  at: '2026-10-27T09:00:00Z',
  category: helperKey,
  ...overrides,
});

function fixture(entries, events = []) {
  const root = mkdtempSync(join(tmpdir(), 'lessons-events-'));
  mkdirSync(join(root, 'docs/lessons'), { recursive: true });
  for (const item of entries) writeFileSync(join(root, 'docs/lessons', item.name), item.text);
  const ledger = loadLedger(root);
  writeEvents(
    root,
    events.flatMap((event) => {
      try {
        return recordEvent([], ledger, event).events;
      } catch {
        return [{ ...event, id: eventId(event) }];
      }
    }),
  );
  return root;
}

const counterOf = (root, key) =>
  projectCounters(root)
    .find((row) => row.key === key)
    .text.match(/^(Intercepts|Recurrences): (\d+)$/gm)
    .join('\n');

test('replaying one gate failure twice for the same pull request counts one intercept', () => {
  const root = fixture([ledgerEntry(helperKey, { intercepts: 3 })]);
  try {
    const ledger = loadLedger(root);
    const first = recordEvent([], ledger, intercept());
    const replay = recordEvent(first.events, ledger, intercept());
    assert.equal(first.recorded, true);
    assert.equal(replay.recorded, false);
    assert.equal(replay.events.length, 1);
    writeEvents(root, replay.events);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 4\nRecurrences: 0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a new commit on the same branch does not count the interception again, a new branch does', () => {
  const root = fixture([ledgerEntry(helperKey, { intercepts: 3 })]);
  try {
    const ledger = loadLedger(root);
    let events = recordEvent([], ledger, intercept({ branch: 'lane/2040' })).events;
    const reshipped = recordEvent(
      events,
      ledger,
      intercept({ branch: 'lane/2040', at: '2026-10-28T08:00:00Z' }),
    );
    assert.equal(reshipped.recorded, false);
    events = reshipped.events;
    assert.equal(recordEvent(events, ledger, intercept({ branch: 'lane/2042' })).recorded, true);
    writeEvents(root, recordEvent(events, ledger, intercept({ branch: 'lane/2042' })).events);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 5\nRecurrences: 0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a red gate on a pull request and on its merge counts once, and the merge a recurrence', () => {
  const root = fixture([ledgerEntry(helperKey, { intercepts: 0 })]);
  try {
    const ledger = loadLedger(root);
    const branch = recordEvent(
      [],
      ledger,
      intercept({ branch: '2040', at: '2026-10-26T08:00:00Z' }),
    );
    const merged = mergedInterception(branch.events, ledger, {
      pr: '2040',
      repo: 'xiechimon/cairn',
      category: helperKey,
      mergedAt: '2026-10-27T08:00:00Z',
    });
    assert.equal(merged.events.length, 2);
    assert.equal(merged.event.kind, 'recurrence');
    assert.equal(
      merged.event.entryId,
      'intercept:xiechimon/cairn:2040:single-use-helper-gate:merged:2026-10-26',
    );
    const replay = mergedInterception(merged.events, ledger, {
      pr: '2040',
      repo: 'xiechimon/cairn',
      category: helperKey,
      mergedAt: '2026-10-27T08:00:00Z',
    });
    assert.equal(replay.events.length, 2);
    assert.equal(replay.event.kind, 'intercept');
    writeEvents(root, replay.events);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 1\nRecurrences: 1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an event from before the safeguard activated stays out of the counters', () => {
  const root = fixture([ledgerEntry(helperKey, { intercepts: 3, since: '2026-10-28' })]);
  try {
    const result = recordEvent([], loadLedger(root), intercept({ at: '2026-10-27T08:00:00Z' }));
    assert.equal(result.recorded, true);
    writeEvents(root, result.events);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 3\nRecurrences: 0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a hand-written counter drifts from the projection and the gate says so', () => {
  const entry = ledgerEntry(helperKey, { intercepts: 0 });
  const root = fixture([entry], [intercept()]);
  try {
    freezeBaselines(root);
    writeFileSync(
      join(root, 'docs/lessons', entry.name),
      entry.text.replace(/^Intercepts: 0$/m, 'Intercepts: 7'),
    );
    assert.match(checkCounters(root).join('\n'), /do not edit them by hand/);
    writeCounters(root);
    assert.deepEqual(checkCounters(root), []);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 1\nRecurrences: 0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the counters an entry already carried are frozen as its baseline, never recounted', () => {
  const entry = ledgerEntry(helperKey, { intercepts: 4, recurrences: 1 });
  const root = fixture([entry], [intercept(), recurrence()]);
  try {
    freezeBaselines(root);
    assert.deepEqual(readBaselines(root), { [helperKey]: { Intercepts: 4, Recurrences: 1 } });
    writeCounters(root);
    assert.deepEqual(checkCounters(root), []);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 5\nRecurrences: 2');
    assert.deepEqual(readBaselines(root), { [helperKey]: { Intercepts: 4, Recurrences: 1 } });
    freezeBaselines(root);
    writeCounters(root);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 5\nRecurrences: 2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a baseline frozen below what the entry already records is reported, never applied', () => {
  const entry = ledgerEntry(helperKey, { intercepts: 4, recurrences: 2 });
  const root = fixture([entry]);
  try {
    writeBaselines(root, { [helperKey]: { Intercepts: 4, Recurrences: 1 } });
    assert.match(
      checkBaselines(root).join('\n'),
      /freezes Recurrences 1, which is below the entry's own Recurrences 2/,
    );
    freezeBaselines(root);
    writeCounters(root);
    assert.deepEqual(checkBaselines(root), []);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 4\nRecurrences: 2');
    assert.deepEqual(readBaselines(root), {
      [helperKey]: { Intercepts: 4, Recurrences: 2 },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a baseline left behind by a deleted entry is reported, not ignored', () => {
  const root = fixture([ledgerEntry(helperKey)]);
  try {
    writeBaselines(root, {
      [helperKey]: { Intercepts: 0, Recurrences: 0 },
      'gone-gate': { Intercepts: 1, Recurrences: 0 },
    });
    assert.match(checkBaselines(root).join('\n'), /delete the stale baseline/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('categories are matched by file-derived key, never by symptom prose', () => {
  const prose = ledgerEntry(helperKey, { intercepts: 0 });
  const root = fixture([prose]);
  try {
    assert.throws(
      () =>
        recordEvent([], loadLedger(root), intercept({ category: 'a-symptom-written-in-prose' })),
      /no ledger entry carries/,
    );
    assert.equal(recordEvent([], loadLedger(root), intercept()).recorded, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an ambiguous or malformed event is rejected before it reaches the log', () => {
  const root = fixture([ledgerEntry(helperKey), ledgerEntry('single-use-helper-gate-copy')]);
  try {
    const single = loadLedger(root).filter((row) => row.key === helperKey);
    assert.equal(recordEvent([], single, intercept()).recorded, true);
    assert.throws(() => recordEvent([], [...single, ...single], intercept()), /ambiguous/);
    for (const broken of [
      intercept({ branch: '' }),
      intercept({ gate: undefined }),
      intercept({ category: 'Not A Key' }),
      intercept({ repo: '' }),
      recurrence({ pr: '' }),
      { kind: 'escape', repo: 'r', pr: '1', category: helperKey },
    ])
      assert.throws(
        () => recordEvent([], single, broken),
        /event needs|cannot be|kind must|must be a non-empty|category must be/,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a recurrence counts once, opens one escalation and records the issue that came back', () => {
  const root = fixture([ledgerEntry(helperKey, { intercepts: 1 })]);
  try {
    const ledger = loadLedger(root);
    const first = recordEvent([], ledger, recurrence());
    assert.equal(first.recorded, true);
    assert.deepEqual(
      escalationPending(first.events).map(({ category }) => category),
      [helperKey],
    );
    writeEvents(root, first.events);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 1\nRecurrences: 1');
    const notified = recordEvent(readEvents(root), ledger, recurrence({ issue: '2077' }));
    assert.equal(notified.recorded, false);
    assert.equal(notified.event.issue, '2077');
    writeEvents(root, notified.events);
    assert.deepEqual(escalationPending(readEvents(root)), []);
    assert.equal(counterOf(root, helperKey), 'Intercepts: 1\nRecurrences: 1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the escalation ticket asks for the stronger rung and flags level 1, which has none', () => {
  const escalate = (level) => {
    const root = fixture([ledgerEntry(helperKey, { level })]);
    try {
      const result = recordEvent([], loadLedger(root), recurrence());
      return escalationPending(result.events)[0];
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  assert.equal(escalate(3).suggestedLevel, 2);
  assert.match(escalate(3).suggestion, /from level 3 to level 2/);
  assert.match(escalate(2).suggestion, /from level 2 to level 1/);
  assert.equal(escalate(2).review, false);
  assert.match(escalate(1).suggestion, /already at level 1, the strongest rung/);
  const body = renderEscalation(escalate(1));
  assert.match(body, /^---\nTitle: lessons escalation: single-use-helper-gate/);
  assert.match(body, /Labels: correction, needs-decision/);
  assert.match(renderEscalation(escalate(3)), /Labels: correction$/m);
});

test('the event log rejects duplicate ids and events for categories with no entry', () => {
  const entry = ledgerEntry(helperKey);
  const root = fixture([entry], [intercept()]);
  try {
    assert.deepEqual(checkLedgerEvents(root), []);
    writeFileSync(
      join(root, 'docs/lessons/events.jsonl'),
      `${readFileSync(join(root, 'docs/lessons/events.jsonl'), 'utf8')}${JSON.stringify(intercept())}\n`,
    );
    assert.match(checkLedgerEvents(root).join('\n'), /duplicates the event on line 1/);
    const orphan = fixture([entry], [intercept({ category: 'no-such-category' })]);
    try {
      assert.match(checkLedgerEvents(orphan).join('\n'), /no ledger entry carries/);
    } finally {
      rmSync(orphan, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the window is the seven days before now, so Monday 01:23 UTC reports the week that ended', () => {
  const entries = [];
  const monday = new Date('2026-10-26T01:23:00Z');
  const activity = [
    intercept({ at: '2026-10-18T02:00:00Z', branch: 'lane/2037' }),
    intercept({ at: '2026-10-20T02:00:00Z', branch: 'lane/2039' }),
    intercept({ at: '2026-10-25T23:00:00Z', branch: 'lane/2040' }),
    intercept({ at: '2026-10-26T01:00:00Z', branch: 'lane/2041' }),
  ];
  const summary = weeklySummary(entries, activity, { now: monday });
  assert.equal(summary.week, '2026-10-19T01:23..2026-10-26T01:23');
  assert.equal(summary.intercepts, 3);
  assert.equal(
    weeklySummary(entries, [], { now: monday }).week,
    '2026-10-19T01:23..2026-10-26T01:23',
  );
});

test('the weekly summary runs on an empty ledger and on a normal week', () => {
  const empty = weeklySummary([], [], { now: new Date('2026-10-28T12:00:00Z') });
  assert.deepEqual(empty.newCategories, []);
  assert.equal(empty.intercepts, 0);
  assert.equal(empty.recurrences, 0);
  assert.match(renderWeeklySummary(empty), /Intercepts: 0/);

  const entries = [
    ledgerEntry(helperKey, { since: '2026-10-22' }),
    ledgerEntry('quiet-gate', { since: '2026-09-01' }),
    ledgerEntry('brand-new-gate', { since: '2026-10-27' }),
    ledgerEntry('untracked-gate', { since: '', intercepts: 2 }),
  ];
  entries.at(-1).activated = null;
  const events = [
    intercept({ at: '2026-10-27T08:00:00Z', branch: 'lane/2040' }),
    intercept({ at: '2026-10-28T08:00:00Z', branch: 'lane/2041' }),
    recurrence({ at: '2026-10-28T09:00:00Z' }),
    intercept({ at: '2026-10-19T08:00:00Z', branch: 'lane/2039' }),
  ];
  const summary = weeklySummary(entries, events, {
    now: new Date('2026-10-28T12:00:00Z'),
    idleWeeks: 4,
  });
  assert.equal(summary.week, '2026-10-21T12:00..2026-10-28T12:00');
  assert.equal(summary.escalationsUnfiled, 1);
  assert.deepEqual(summary.newCategories, ['single-use-helper-gate', 'brand-new-gate']);
  assert.equal(summary.intercepts, 2);
  assert.equal(summary.recurrences, 1);
  assert.deepEqual(summary.dormant, ['quiet-gate']);
  assert.deepEqual(summary.awaitingDecision, [helperKey]);
  assert.deepEqual(summary.untracked, ['untracked-gate']);
  const report = renderWeeklySummary(summary);
  assert.match(report, /Safeguards awaiting evaluation:\n- quiet-gate/);
  assert.match(report, /No safeguarding date yet \(1 entries/);
});

test('the idle threshold counts whole weeks since the last activity, not since a fixed date', () => {
  const entries = [ledgerEntry('quiet-gate', { since: '2026-09-01' })];
  const now = new Date('2026-10-28T12:00:00Z');
  assert.deepEqual(weeklySummary(entries, [], { now, idleWeeks: 4 }).dormant, ['quiet-gate']);
  assert.deepEqual(weeklySummary(entries, [], { now, idleWeeks: 9 }).dormant, []);
  const recent = [intercept({ at: '2026-10-15T08:00:00Z', category: 'quiet-gate' })];
  assert.deepEqual(weeklySummary(entries, recent, { now, idleWeeks: 1 }).dormant, []);
  assert.deepEqual(
    weeklySummary(entries, recent, { now: new Date('2026-11-24T00:00:00Z'), idleWeeks: 4 }).dormant,
    ['quiet-gate'],
  );
});

test('the CLI records an event once, writes the counters and prints one escalation request', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons cli '));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    cpSync(
      join(repoRoot, 'scripts/lessons-ledger-gate.mjs'),
      join(root, 'scripts/lessons-ledger-gate.mjs'),
    );
    const entry = ledgerEntry(helperKey, { intercepts: 2 });
    writeFileSync(join(root, 'docs/lessons', entry.name), entry.text);
    const eventFile = join(root, 'event.json');
    writeFileSync(eventFile, JSON.stringify(recurrence()));
    const run = (...args) =>
      execFileSync(process.execPath, [join(root, 'scripts/lessons-ledger-gate.mjs'), ...args], {
        encoding: 'utf8',
      });
    const first = run('record', '--event', eventFile);
    const replay = run('record', '--event', eventFile);
    assert.match(first, /lessons ledger recorded 1 of 1 events/);
    assert.match(first, /Title: lessons escalation/);
    assert.match(replay, /lessons ledger recorded 0 of 1 events/);
    assert.doesNotMatch(replay, /Title: lessons escalation/);
    assert.equal(readEvents(root).length, 1);
    assert.match(readFileSync(join(root, 'docs/lessons', entry.name), 'utf8'), /^Recurrences: 1$/m);
    assert.match(run('--table'), /Recurrences/);
    assert.match(run('summary', '--now', '2026-10-28T12:00:00Z'), /Recurrences: 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a gate failure names every entry whose safeguard points at that gate', () => {
  const ledger = [
    {
      ...ledgerEntry('comment-discipline-gate'),
      safeguard: '`scripts/comment-discipline-gate.mjs`',
    },
    { ...ledgerEntry('unrelated-gate'), safeguard: '`scripts/ui-debt-gate.mjs`' },
  ];
  const events = interceptEventsForGate(ledger, 'scripts/comment-discipline-gate.mjs', {
    repo: 'xiechimon/cairn',
    pr: '2040',
    at: '2026-10-27T08:00:00Z',
    episode: 'e4f3aadf',
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].category, 'comment-discipline-gate');
  assert.equal(events[0].gate, 'scripts/comment-discipline-gate.mjs');
  assert.deepEqual(
    interceptEventsForGate(ledger, 'scripts/no-such-gate.mjs', { repo: 'r', pr: '1' }),
    [],
  );
});

test('the gate-failed command records a batch and prints one escalation per new recurrence', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons gate-failed '));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'docs/lessons'), { recursive: true });
    cpSync(
      join(repoRoot, 'scripts/lessons-ledger-gate.mjs'),
      join(root, 'scripts/lessons-ledger-gate.mjs'),
    );
    writeFileSync(
      join(root, 'docs/lessons/2099-single-use-helper-gate.md'),
      ledgerEntry(helperKey).text,
    );
    const eventFile = join(root, 'batch.json');
    writeFileSync(eventFile, JSON.stringify([recurrence(), intercept()]));
    const run = (...args) =>
      execFileSync(process.execPath, [join(root, 'scripts/lessons-ledger-gate.mjs'), ...args], {
        encoding: 'utf8',
      });
    const first = run('gate-failed', '--event', eventFile);
    assert.match(first, /recorded 2 of 2 events/);
    assert.match(first, /Title: lessons escalation/);
    const replay = run('gate-failed', '--event', eventFile);
    assert.match(replay, /recorded 0 of 2 events/);
    assert.doesNotMatch(replay, /Title: lessons escalation/);
    assert.equal(readEvents(root).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('intercept deduplication resets at Monday UTC and ignores commits within the week', () => {
  const ledger = [ledgerEntry(helperKey)];
  const first = recordEvent([], ledger, intercept({ at: '2026-11-01T23:59:59Z' }));
  const replay = recordEvent(
    first.events,
    ledger,
    intercept({ at: '2026-11-01T23:59:59Z', episode: 'another-commit' }),
  );
  assert.equal(replay.recorded, false);
  const next = recordEvent(replay.events, ledger, intercept({ at: '2026-11-02T00:00:00Z' }));
  assert.equal(next.recorded, true);
  assert.equal(next.events.length, 2);
});

test('weekly deduplication also recognizes previously stored intercept ids', () => {
  const ledger = [ledgerEntry(helperKey)];
  const old = {
    ...intercept(),
    id: `intercept:xiechimon/cairn:lane/2040:${helperKey}:single-use-helper-gate`,
  };
  assert.equal(recordEvent([old], ledger, intercept()).recorded, false);
  assert.equal(
    recordEvent([old], ledger, intercept({ at: '2026-11-03T00:00:00Z' })).recorded,
    true,
  );
});
