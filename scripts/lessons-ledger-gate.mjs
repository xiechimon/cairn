#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIELDS = [
  'Category',
  'Source',
  'Level',
  'Safeguard',
  'Intercepts',
  'Recurrences',
  'Notes',
];
const COUNTERS = ['Intercepts', 'Recurrences'];
const ENTRY_NAME = /^\d+-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;
export const EVENTS_PATH = 'docs/lessons/events.jsonl';
export const BASELINES_PATH = 'docs/lessons/baselines.json';
const EVENT_KINDS = {
  intercept: ['repo', 'branch', 'category', 'gate'],
  recurrence: ['repo', 'pr', 'category'],
};
const EVENT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WEEK = 604800000;
const MIN_LEVEL = 1;
export const DEFAULT_IDLE_WEEKS = 4;

function parseFrontmatter(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) return { fields: null, problems: ['missing leading --- frontmatter'] };
  const problems = [];
  const fields = {};
  let last = null;
  let inContinuation = false;
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    const key = separator === -1 ? line : line.slice(0, separator);
    if (!FIELDS.includes(key) || Object.hasOwn(fields, key)) {
      problems.push(`unknown, duplicate or malformed line: ${line.slice(0, 30)}`);
      inContinuation = true;
      continue;
    }
    if (
      problems.length === 0 &&
      last !== null &&
      !inContinuation &&
      FIELDS.indexOf(key) !== FIELDS.indexOf(last) + 1
    )
      problems.push(`fields must be in the order: ${FIELDS.join(', ')}`);
    fields[key] = line.slice(separator + 1).trim();
    last = key;
    inContinuation = false;
  }
  for (const key of FIELDS) if (!(key in fields)) problems.push(`missing field: ${key}`);
  return { fields: problems.length === 0 ? fields : null, problems };
}

export function parseEntry(fileName, text) {
  const { fields, problems } = parseFrontmatter(text);
  if (fields === null) return { fields: null, problems };
  const notes = {
    key: /^\d+-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(fileName)?.[1] ?? null,
    text: fields.Notes.split('\n').slice(1).join('\n').trim(),
  };
  const lane = /^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(fileName);
  const entry = {
    ticket: lane?.[1] ?? null,
    key: lane?.[2] ?? null,
    category: fields.Category,
    source: fields.Source,
    level: fields.Level,
    safeguard: fields.Safeguard,
    intercepts: fields.Intercepts,
    recurrences: fields.Recurrences,
    activated: /^.*; since (\d{4}-\d{2}-\d{2})\b/.exec(fields.Safeguard)?.at(1) ?? null,
    escalations: notes.text.match(/\(escalated in #\d+\)/g)?.map((hit) => hit.slice(14, -1)) ?? [],
    notes: notes.text,
  };
  return { fields, entry, problems };
}

export function checkEntry(fileName, text) {
  const violations = [];
  if (!ENTRY_NAME.test(fileName))
    violations.push(
      `${fileName}: file name must be <ticket>-<short-name>.md with a lowercase alphanumeric hyphenated short name`,
    );
  const { fields, problems } = parseEntry(fileName, text);
  violations.push(...problems.map((problem) => `${fileName}: ${problem}`));
  if (fields === null) return violations;
  for (const key of ['Category', 'Source', 'Safeguard'])
    if (fields[key] === '') violations.push(`${fileName}: ${key} must not be empty`);
  if (!/^[1-5]$/.test(fields.Level)) violations.push(`${fileName}: Level must be between 1 and 5`);
  else if (Number(fields.Level) >= 4 && fields.Notes === '')
    violations.push(
      `${fileName}: Level ${fields.Level} must state in Notes why a higher level is not feasible`,
    );
  if (/pending upgrade|upgrade pending|待升/i.test(fields.Notes) && !/#\d+/.test(fields.Notes))
    violations.push(`${fileName}: "pending upgrade" in Notes must carry a ticket number`);
  violations.push(
    ...COUNTERS.filter((key) => !/^\d+$/.test(fields[key])).map(
      (key) => `${fileName}: ${key} must be a non-negative integer`,
    ),
  );
  const since = /since (\S*)/.exec(fields.Safeguard)?.[1];
  if (
    since !== undefined &&
    !(/^\d{4}-\d{2}-\d{2}$/.test(since) && Number.isFinite(Date.parse(since)))
  )
    violations.push(
      `${fileName}: the safeguard's "; since YYYY-MM-DD" marker must end the field with a valid date (the date of the latest safeguard)`,
    );
  return violations;
}

export function ledgerEntries(root) {
  const directory = join(root, 'docs/lessons');
  return readdirSync(directory)
    .filter((name) => name !== 'README.md' && name.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, text: readFileSync(join(directory, name), 'utf8') }));
}

export function loadLedger(root) {
  return ledgerEntries(root)
    .map(({ name, text }) => ({ name, text, ...parseEntry(name, text).entry }))
    .filter((entry) => entry.key !== null);
}
export function checkLedgerRoot(root) {
  const violations = [];
  if (existsSync(join(root, 'docs/lessons.md')))
    violations.push(
      'docs/lessons.md was split into per-entry files under docs/lessons/; do not bring the summary table back',
    );
  if (!existsSync(join(root, 'docs/lessons'))) return [...violations, 'docs/lessons/ is missing'];
  const entries = ledgerEntries(root);
  if (entries.length === 0) violations.push('docs/lessons/ has no entries');
  for (const { name, text } of entries) violations.push(...checkEntry(name, text));
  if (!violations.includes('docs/lessons/ has no entries'))
    violations.push(...checkLedgerKeys(root));
  violations.push(...checkLedgerEvents(root));
  return violations;
}

function categoryOwners(entries) {
  const owners = new Map();
  for (const entry of entries) {
    if (entry.key === null) continue;
    owners.set(entry.key, [...(owners.get(entry.key) ?? []), entry.name]);
  }
  return owners;
}

export function checkLedgerKeys(root) {
  return [...categoryOwners(loadLedger(root))]
    .filter(([, names]) => names.length > 1)
    .map(
      ([key, names]) =>
        `category key "${key}" is claimed by ${names.join(' and ')}; recurrences of one kind must update the original entry, so keys must be unique`,
    );
}

export function readEvents(root) {
  const path = join(root, EVENTS_PATH);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}
export function eventId(event) {
  if (event.kind === 'recurrence')
    return `recurrence:${event.repo}+${event.pr}:${event.episode ?? `${event.repo}#${event.pr}`}:${event.category}`;
  const date = new Date(event.at ?? event.shipped);
  const week = Number.isFinite(date.getTime())
    ? new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() - ((date.getUTCDay() + 6) % 7),
        ),
      )
        .toISOString()
        .slice(0, 10)
    : 'undated';
  return `intercept:${event.repo}:${event.branch}:${event.category}:${event.gate}:${week}`;
}

export function eventProblems(event) {
  const problems = [];
  if (!Object.hasOwn(EVENT_KINDS, event.kind))
    return [`kind must be "intercept" or "recurrence", got ${JSON.stringify(event.kind)}`];
  for (const field of ['repo', 'category', ...EVENT_KINDS[event.kind]])
    if (typeof event[field] !== 'string' || event[field] === '')
      problems.push(`${event.kind} event needs a non-empty "${field}"`);
  if (!EVENT_ID.test(event.category ?? ''))
    problems.push(
      `category must be a category key (lowercase hyphenated), got "${event.category}"`,
    );
  if (event.episode !== undefined && (typeof event.episode !== 'string' || event.episode === ''))
    problems.push('episode must be a non-empty string when present');
  if (event.activated !== undefined && !Number.isFinite(Date.parse(event.activated)))
    problems.push('activated must be an ISO timestamp when present');
  if (event.kind === 'intercept' && event.shipped !== undefined) {
    if (!Number.isFinite(Date.parse(event.shipped)))
      problems.push('shipped must be an ISO timestamp when present');
    if (event.issue !== undefined && !/^#?\d+$/.test(String(event.issue)))
      problems.push('issue must be a ticket number when present');
  }
  return problems;
}

export function checkLedgerEvents(root) {
  const path = join(root, EVENTS_PATH);
  if (!existsSync(path)) return [];
  const owners = categoryOwners(loadLedger(root));
  const violations = [];
  const seen = new Map();
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (line.trim() === '') continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      violations.push(`${EVENTS_PATH}:${index + 1}: not valid JSON`);
      continue;
    }
    const problems = eventProblems(event);
    if (problems.length > 0) {
      violations.push(...problems.map((problem) => `${EVENTS_PATH}:${index + 1}: ${problem}`));
      continue;
    }
    if (!owners.has(event.category))
      violations.push(
        `${EVENTS_PATH}:${index + 1}: no ledger entry carries "Key: ${event.category}"; add the entry before its events`,
      );
    const id = eventId(event);
    const first = seen.get(id);
    if (first !== undefined)
      violations.push(`${EVENTS_PATH}:${index + 1}: duplicates the event on line ${first} (${id})`);
    else seen.set(id, index + 1);
  }
  return violations;
}

export function countersOf(text) {
  const counts = {};
  for (const match of text.matchAll(/^(Intercepts|Recurrences): (\d+)$/gm))
    counts[match[1]] = Number(match[2]);
  return counts;
}

export function sameCounters(a, b) {
  return COUNTERS.every((key) => a[key] === b[key]);
}

export function readBaselines(root) {
  const path = join(root, BASELINES_PATH);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeBaselines(root, baselines) {
  const sorted = Object.fromEntries(
    Object.entries(baselines).sort(([left], [right]) => left.localeCompare(right, 'en')),
  );
  writeFileSync(join(root, BASELINES_PATH), `${JSON.stringify(sorted, null, 2)}\n`);
}

function baselineFor(entry, baselines) {
  const frozen = baselines[entry.key];
  if (frozen !== undefined)
    return { Intercepts: frozen.Intercepts, Recurrences: frozen.Recurrences };
  return countersOf(entry.text);
}

export function activeEvents(events, entry) {
  const activated = entry.activated === null ? Number.NaN : Date.parse(entry.activated);
  if (!Number.isFinite(activated)) return [];
  return events.filter(
    (event) => event.category === entry.key && Date.parse(event.at ?? '') >= activated,
  );
}

export function projectCounters(root) {
  const events = readEvents(root);
  const baselines = readBaselines(root);
  return loadLedger(root).map((entry) => {
    const active = activeEvents(events, entry);
    const baseline = baselineFor(entry, baselines);
    const projected = {
      Intercepts: baseline.Intercepts + active.filter((event) => event.kind === 'intercept').length,
      Recurrences:
        baseline.Recurrences + active.filter((event) => event.kind === 'recurrence').length,
    };
    return {
      name: entry.name,
      key: entry.key,
      baseline: baselineFor(entry, baselines),
      projected,
      text: entry.text.replace(
        /^(Intercepts|Recurrences):.*$/gm,
        (_line, key) => `${key}: ${projected[key]}`,
      ),
    };
  });
}

export function checkBaselines(root) {
  const baselines = readBaselines(root);
  const ledger = loadLedger(root);
  const events = readEvents(root);
  const keys = new Set(ledger.map((entry) => entry.key));
  return [
    ...Object.keys(baselines)
      .filter((key) => !keys.has(key))
      .map(
        (key) =>
          `${BASELINES_PATH}: freezes "${key}", which no ledger entry carries any more; delete the stale baseline`,
      ),
    ...Object.entries(baselines)
      .filter(
        ([, counts]) =>
          !Number.isInteger(counts.Intercepts) || !Number.isInteger(counts.Recurrences),
      )
      .map(([key]) => `${BASELINES_PATH}: "${key}" needs integer Intercepts and Recurrences`),
    ...ledger.flatMap((entry) =>
      lowBaselines(entry, baselines[entry.key], events).map(
        ({ key, frozen, carried }) =>
          `${BASELINES_PATH}: "${entry.key}" freezes ${key} ${frozen}, which is below the entry's own ${key} ${carried} in docs/lessons/${entry.name} with no ${counterKind(key)} event to explain the difference, so the baseline would erase recorded history; raise it to ${carried}`,
      ),
    ),
  ];
}

function counterKind(key) {
  return key === 'Intercepts' ? 'intercept' : 'recurrence';
}

function lowBaselines(entry, frozen, events) {
  if (frozen === undefined) return [];
  const carried = countersOf(entry.text);
  const recorded = activeEvents(events, entry);
  return COUNTERS.map((key) => ({ key, frozen: frozen[key], carried: carried[key] })).filter(
    ({ key, frozen: value, carried: carriedValue }) =>
      Number.isInteger(value) &&
      value < carriedValue &&
      recorded.every((event) => event.kind !== counterKind(key)),
  );
}

export function freezeBaselines(root) {
  const baselines = readBaselines(root);
  const events = readEvents(root);
  let changed = false;
  for (const entry of loadLedger(root)) {
    const frozen = baselines[entry.key];
    const raised =
      frozen === undefined ? COUNTERS : lowBaselines(entry, frozen, events).map(({ key }) => key);
    if (raised.length === 0) continue;
    const carried = countersOf(entry.text);
    baselines[entry.key] = {
      ...frozen,
      ...Object.fromEntries(raised.map((key) => [key, carried[key]])),
    };
    changed = true;
  }
  if (!changed) return false;
  writeBaselines(root, baselines);
  return true;
}

export function checkCounters(root) {
  return projectCounters(root)
    .filter(
      (row) =>
        !sameCounters(
          countersOf(readFileSync(join(root, 'docs/lessons', row.name), 'utf8')),
          row.projected,
        ),
    )
    .map((row) => {
      const written = countersOf(readFileSync(join(root, 'docs/lessons', row.name), 'utf8'));
      return `docs/lessons/${row.name}: Intercepts/Recurrences are written from the recorded events, do not edit them by hand (the file says Intercepts ${written.Intercepts}, Recurrences ${written.Recurrences}; the events give Intercepts ${row.projected.Intercepts}, Recurrences ${row.projected.Recurrences}); run \`node scripts/lessons-ledger-gate.mjs write\``;
    });
}

function storeEvent(events, ledger, event) {
  const problems = eventProblems(event);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const owner = categoryOwners(ledger).get(event.category) ?? [];
  if (owner.length !== 1)
    throw new Error(
      owner.length === 0
        ? `no ledger entry carries "Key: ${event.category}"; categories are matched by key only, never by symptom prose`
        : `category key "${event.category}" is ambiguous: ${owner.join(', ')}`,
    );
  const id = eventId(event);
  const duplicate = events.find((existing) => eventId(existing) === id);
  if (duplicate === undefined) {
    const stored = { ...event, id };
    if (stored.kind === 'recurrence')
      Object.assign(stored, applyEscalation(ledger, owner[0], null));
    return { recorded: event.shipped === undefined, events: [...events, stored], event: stored };
  }
  if (duplicate.issue || event.issue === undefined)
    return { recorded: false, events, event: duplicate };
  const escalated = { ...duplicate, ...applyEscalation(ledger, owner[0], event.issue) };
  return {
    recorded: false,
    events: events.map((existing) => (existing === duplicate ? escalated : existing)),
    event: escalated,
  };
}

export function recordEvent(events, ledger, event) {
  const next = storeEvent(events, ledger, event);
  if (next.event.kind === 'recurrence' || event.shipped === undefined) return next;
  return storeEvent(events, ledger, { ...event, entryId: next.event.id });
}

export function mergedInterception(events, ledger, { pr, repo, category, mergedAt }) {
  const identity = { pr: String(pr), repo, category };
  const markerId = eventId({
    kind: 'intercept',
    repo: identity.repo,
    branch: identity.pr,
    category: identity.category,
    gate: 'merged',
    shipped: mergedAt,
  });
  const replay = events.find((event) => event.id === markerId);
  if (replay !== undefined) return { recorded: false, events, event: replay };
  const hit = interceptedOnBranch(events, identity) ?? {
    kind: 'intercept',
    repo,
    branch: identity.pr,
    category,
    gate: 'merged',
  };
  const shipped = { ...hit, gate: 'merged', shipped: mergedAt };
  const earlier = events.filter(
    (event) => event.id !== markerId && !interceptedOnBranch([event], identity),
  );
  const withHit = storeEvent(earlier, ledger, shipped);
  if (interceptedOnBranch(withHit.events, identity) !== undefined) return withHit;
  return storeEvent(withHit.events, ledger, {
    kind: 'recurrence',
    repo,
    pr: identity.pr,
    at: mergedAt,
    category,
    entryId: markerId,
  });
}

function interceptedOnBranch(events, { pr, repo, category }) {
  return events.find(
    (event) =>
      event.kind === 'intercept' &&
      event.category === category &&
      event.repo === repo &&
      event.gate !== 'merged' &&
      String(event.branch) === pr,
  );
}

function applyEscalation(ledger, entryName, issue) {
  const level = Number(ledger.find((candidate) => candidate.name === entryName).level);
  const suggestedLevel = Math.max(level - 1, MIN_LEVEL);
  return {
    issue: issue ?? null,
    upgradedEntry: entryName,
    suggestedLevel,
    suggestion:
      level <= MIN_LEVEL
        ? 'the safeguard is already at level 1, the strongest rung; a human review of the category is required'
        : `move the safeguard from level ${level} to level ${suggestedLevel}`,
    review: level <= MIN_LEVEL,
  };
}

export function categoriesForGate(ledger, gate) {
  return ledger.filter((entry) => entry.safeguard.includes(gate)).map((entry) => entry.key);
}

export function interceptEventsForGate(ledger, gate, { repo, branch, at }) {
  return categoriesForGate(ledger, gate).map((category) => ({
    kind: 'intercept',
    repo,
    branch,
    at: at ?? new Date().toISOString(),
    category,
    gate,
  }));
}

export function escalationPending(events) {
  return events
    .filter((event) => event.kind === 'recurrence' && !event.issue)
    .map((event) => ({
      id: event.id,
      category: event.category,
      entry: event.upgradedEntry,
      suggestedLevel: event.suggestedLevel,
      suggestion: event.suggestion,
      review: event.review,
    }));
}

export function escalationFiled(events, id, issue) {
  const found = events.find((event) => event.id === id);
  if (found === undefined) throw new Error(`no event carries the id ${id}`);
  return events.map((event) => (event.id === id ? { ...event, issue: String(issue) } : event));
}

export function renderEscalation(pending) {
  return [
    '---',
    `Title: lessons escalation: ${pending.category} recurred after its safeguard (${pending.entry})`,
    ...(pending.review ? ['Labels: correction, needs-decision'] : ['Labels: correction']),
    ...(pending.issue == null ? [] : [`Issue-Number: ${String(pending.issue).replace(/^#/, '')}`]),
    '---',
    '',
    'The same kind of error reappeared after its safeguard landed, so the ledger counts it as a recurrence.',
    '',
    `- Category key: ${pending.category}`,
    `- Ledger entry: docs/lessons/${pending.entry}`,
    `- Suggested stronger safeguard: ${pending.suggestion}`,
  ].join('\n');
}

export function weeklySummary(
  entries,
  events,
  { now = new Date(), idleWeeks = DEFAULT_IDLE_WEEKS } = {},
) {
  const end = now.getTime();
  const start = end - WEEK;
  const inWindow = (value) => {
    const at = Date.parse(value);
    return Number.isFinite(at) && at >= start && at < end;
  };
  const activatedAt = (entry) =>
    entry.activated === null ? Number.NaN : Date.parse(entry.activated);
  const tracked = entries.filter((entry) => Number.isFinite(activatedAt(entry)));
  return {
    week: `${new Date(start).toISOString().slice(0, 16)}..${new Date(end).toISOString().slice(0, 16)}`,
    untracked: entries
      .filter((entry) => !Number.isFinite(activatedAt(entry)))
      .map((entry) => entry.key),
    newCategories: tracked.filter((entry) => inWindow(entry.activated)).map((entry) => entry.key),
    intercepts: events.filter((event) => event.kind === 'intercept' && inWindow(event.at)).length,
    recurrences: events.filter((event) => event.kind === 'recurrence' && inWindow(event.at)).length,
    dormant: tracked
      .filter(
        (entry) =>
          start -
            Math.max(
              activatedAt(entry),
              ...activeEvents(events, entry).map((event) => Date.parse(event.at)),
            ) >=
          idleWeeks * WEEK,
      )
      .map((entry) => entry.key),
    idleWeeks,
    awaitingDecision: escalationPending(events).map((pending) => pending.category),
    escalationsUnfiled: events.filter(
      (event) => event.kind === 'recurrence' && !event.issue && inWindow(event.at),
    ).length,
  };
}

export function renderWeeklySummary(summary) {
  const list = (values) => (values.length === 0 ? ['none'] : values.map((value) => `- ${value}`));
  return [
    '## Lessons ledger weekly summary',
    '',
    `Week: ${summary.week}`,
    `New categories: ${summary.newCategories.length}`,
    `Intercepts: ${summary.intercepts}`,
    `Recurrences: ${summary.recurrences}`,
    `Escalations filed: ${summary.recurrences - summary.escalationsUnfiled}`,
    '',
    'New categories:',
    ...list(summary.newCategories),
    '',
    'Safeguards awaiting evaluation:',
    ...list(summary.dormant),
    '',
    'Escalations awaiting an issue:',
    ...list(summary.awaitingDecision),
    '',
    `No safeguarding date yet (${summary.untracked.length} entries, excluded from the counts above):`,
    ...list(summary.untracked),
    '',
  ].join('\n');
}

export function renderTable(entries) {
  const violations = entries.flatMap(({ name, text }) => checkEntry(name, text));
  if (violations.length > 0) throw new Error(violations.join('\n'));
  const rows = entries.map(({ name, text }) => {
    const { fields } = parseFrontmatter(text);
    const values = FIELDS.map((key) => fields[key]);
    return `| ${[name.replace(/\.md$/, ''), ...values].map((value) => value.replaceAll('\\|', '|').replaceAll('|', '\\|')).join(' | ')} |`;
  });
  return [`| File | ${FIELDS.join(' | ')} |`, `|${'---|'.repeat(FIELDS.length + 1)}`, ...rows].join(
    '\n',
  );
}

export function writeCounters(root) {
  for (const row of projectCounters(root))
    writeFileSync(join(root, 'docs/lessons', row.name), row.text);
}

export function writeEvents(root, events, { append = false } = {}) {
  mkdirSync(join(root, 'docs/lessons'), { recursive: true });
  const path = join(root, EVENTS_PATH);
  const known = append ? readEvents(root) : [];
  const merged = [...known, ...events.filter((event) => !known.some((e) => e.id === event.id))];
  writeFileSync(path, merged.map((event) => `${JSON.stringify(event)}\n`).join(''));
}

function readOption(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

export function recordAll(root, reported) {
  freezeBaselines(root);
  const reducers = { intercept: recordEvent, recurrence: recordEvent, merged: mergedInterception };
  const pendingBefore = new Set(escalationPending(readEvents(root)).map((pending) => pending.id));
  let latest = { events: readEvents(root), recorded: [] };
  const unowned = [];
  for (const event of reported) {
    const reduce = reducers[event.kind] ?? recordEvent;
    try {
      const result = reduce(latest.events, loadLedger(root), event);
      latest = { events: result.events, recorded: [...latest.recorded, result.recorded === true] };
    } catch (error) {
      if (!(error instanceof Error) || !/^no ledger entry carries/.test(error.message)) throw error;
      unowned.push(error.message);
    }
  }
  writeEvents(root, latest.events);
  writeCounters(root);
  return {
    recorded: latest.recorded.filter(Boolean).length,
    unowned,
    escalated: escalationPending(latest.events).filter((pending) => !pendingBefore.has(pending.id)),
  };
}

export function runCli(root, args) {
  const command = args[0];
  if (command === '--table') return console.log(renderTable(ledgerEntries(root)));
  if (command === 'write') {
    freezeBaselines(root);
    writeCounters(root);
    return console.log('lessons counters written');
  }
  if (['record', 'gate-failed', 'merged'].includes(command)) {
    const file = readOption(args, '--event');
    if (file === undefined) throw new Error(`${command} needs --event <file.json>`);
    const reported = JSON.parse(readFileSync(file, 'utf8'));
    const events = Array.isArray(reported) ? reported : [reported];
    const outcome = recordAll(root, events);
    console.log(`lessons ledger recorded ${outcome.recorded} of ${events.length} events`);
    for (const message of outcome.unowned)
      console.error(`lessons ledger skipped an event: ${message}`);
    for (const pending of outcome.escalated) console.log(renderEscalation(pending));
    return;
  }
  if (command === 'escalate') {
    const id = readOption(args, '--id');
    const issue = readOption(args, '--filed');
    if (id === undefined || issue === undefined)
      throw new Error('escalate needs --id <event id> --filed <issue number>');
    writeEvents(root, escalationFiled(readEvents(root), id, issue));
    console.log(`lessons ledger marked ${id} as filed in #${issue}`);
    return;
  }
  if (command === 'pending') {
    for (const pending of escalationPending(readEvents(root)))
      console.log(renderEscalation(pending));
    return;
  }
  if (command === 'summary') {
    const now = new Date(readOption(args, '--now') ?? Date.now());
    const idleWeeks = Number(readOption(args, '--idle-weeks') ?? DEFAULT_IDLE_WEEKS);
    process.stdout.write(
      renderWeeklySummary(weeklySummary(loadLedger(root), readEvents(root), { now, idleWeeks })),
    );
    return;
  }
  const violations = [...checkLedgerRoot(root), ...checkBaselines(root), ...checkCounters(root)];
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('lessons ledger ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runCli(fileURLToPath(new URL('..', import.meta.url)), process.argv.slice(2));
