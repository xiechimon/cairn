#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_IDLE_WEEKS,
  escalationFiled,
  escalationPending,
  eventId,
  freezeBaselines,
  loadLedger,
  parseEntry,
  readBaselines,
  readEvents,
  recordAll,
  recordEvent,
  renderEscalation,
  renderWeeklySummary,
  weeklySummary,
  writeBaselines,
  writeCounters,
  writeEvents,
} from './lessons-ledger-gate.mjs';

export function collectMergedRecurrences(root) {
  if (!existsSync(join(root, '.git'))) return;
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commits = git(
    'log',
    '--first-parent',
    '--reverse',
    '--format=%H',
    'HEAD',
    '--',
    'docs/lessons/',
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  const ledger = loadLedger(root);
  let events = readEvents(root);
  const added = new Map();
  for (const commit of commits) {
    const parents = git('rev-list', '--parents', '-n', '1', commit).trim().split(' ');
    if (parents.length < 2) continue;
    const parent = parents[1];
    const at = git('show', '-s', '--format=%cI', commit).trim();
    const subject = git('show', '-s', '--format=%s', commit).trim();
    const pr = /\(#(\d+)\)/.exec(subject)?.[1] ?? commit;
    const changed = git('diff', '--name-only', parent, commit, '--', 'docs/lessons/')
      .trim()
      .split('\n');
    const treeFiles = new Set(
      git('ls-tree', '-r', '--name-only', parent, '--', 'docs/lessons/').trim().split('\n'),
    );
    const afterFiles = new Set(
      git('ls-tree', '-r', '--name-only', commit, '--', 'docs/lessons/').trim().split('\n'),
    );
    const historicalEvents = (ref, files) =>
      files.has('docs/lessons/events.jsonl')
        ? git('show', `${ref}:docs/lessons/events.jsonl`)
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
    const beforeEvents = historicalEvents(parent, treeFiles);
    const afterEvents = historicalEvents(commit, afterFiles);
    for (const entry of ledger) {
      const path = `docs/lessons/${entry.name}`;
      if (!changed.includes(path) || !treeFiles.has(path) || !afterFiles.has(path)) continue;
      const before = parseEntry(entry.name, git('show', `${parent}:${path}`)).entry;
      const after = parseEntry(entry.name, git('show', `${commit}:${path}`)).entry;
      if (!before || !after || !before.activated || Date.parse(at) < Date.parse(before.activated))
        continue;
      const recordedDelta =
        afterEvents.filter((e) => e.kind === 'recurrence' && e.category === entry.key).length -
        beforeEvents.filter((e) => e.kind === 'recurrence' && e.category === entry.key).length;
      const increase =
        Number(after.recurrences) - Number(before.recurrences) - Math.max(0, recordedDelta);
      for (let index = 0; index < increase; index++) {
        const event = {
          kind: 'recurrence',
          repo: 'xiechimon/cairn',
          pr,
          category: entry.key,
          at,
          episode: `${commit}:${index}`,
        };
        if (events.some((existing) => existing.id === eventId(event))) continue;
        const result = recordEvent(events, ledger, event);
        events = result.events;
        added.set(entry.key, (added.get(entry.key) ?? 0) + 1);
      }
    }
  }
  if (added.size === 0) return;
  freezeBaselines(root);
  const baselines = readBaselines(root);
  for (const key of added.keys()) {
    const entry = ledger.find((candidate) => candidate.key === key);
    const recorded = events.filter(
      (event) =>
        event.kind === 'recurrence' &&
        event.category === key &&
        Date.parse(event.at) >= Date.parse(entry.activated),
    ).length;
    baselines[key].Recurrences = Math.max(0, Number(entry.recurrences) - recorded);
  }
  writeBaselines(root, baselines);
  writeEvents(root, events);
  writeCounters(root);
}

export async function runWeekly({
  root,
  out,
  now = new Date(),
  idleWeeks = DEFAULT_IDLE_WEEKS,
  gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  file = true,
  logs,
}) {
  collectMergedRecurrences(root);
  if (logs !== undefined) {
    const reported = readdirSync(logs, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .flatMap((entry) =>
        readFileSync(join(entry.parentPath, entry.name), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
    if (reported.some((event) => event.kind !== 'intercept'))
      throw new Error('gate logs must contain only intercepts');
    recordAll(root, reported);
  }
  let current = readEvents(root);
  const filed = [];
  for (const pending of escalationPending(current)) {
    if (!file) break;
    try {
      const text = renderEscalation(pending);
      const [header, body] = text.split(/^---$/m).slice(1);
      const title = /^Title: (.*)$/m.exec(header)?.[1].trim();
      const listing = gh([
        'issue',
        'list',
        '--state',
        'all',
        '--limit',
        '200',
        '--search',
        title,
        '--json',
        'number,title',
      ]);
      const known =
        listing.trim() === ''
          ? undefined
          : JSON.parse(listing).find((issue) => issue.title === title);
      const issue =
        known === undefined
          ? /\/(?:issues)\/(\d+)/.exec(
              gh([
                'issue',
                'create',
                '--title',
                title,
                '--body',
                `${body.trim()}\n\nRecorded event: \`${pending.id}\``,
                ...(pending.review ? ['--label', 'needs-decision'] : []),
              ]),
            )?.[1]
          : String(known.number);
      if (issue === undefined)
        throw new Error(`gh issue create returned no issue number for ${pending.id}`);
      filed.push({ id: pending.id, issue });
      current = escalationFiled(current, pending.id, issue);
    } catch (error) {
      console.error(`lessons-weekly: could not file ${pending.id}: ${error.message}`);
    }
  }
  if (filed.length > 0) writeEvents(root, current);
  const summary = weeklySummary(loadLedger(root), current, { now, idleWeeks });
  const text =
    `${renderWeeklySummary(summary)}\n` +
    `Escalations filed this run: ${filed.length === 0 ? 'none' : filed.map((item) => `${item.id} -> #${item.issue}`).join(', ')}\n`;
  mkdirSync(out, { recursive: true });
  const path = join(out, `lessons-weekly-${now.toISOString().slice(0, 10)}.md`);
  writeFileSync(path, text);
  return { text, path, summary, filed };
}

function readOption(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const root = resolve(readOption(args, '--root') ?? '.');
  const report = await runWeekly({
    root,
    out: readOption(args, '--out') ?? '.gardener',
    now: new Date(readOption(args, '--now') ?? Date.now()),
    idleWeeks: Number(readOption(args, '--idle-weeks') ?? DEFAULT_IDLE_WEEKS),
    file: !args.includes('--no-file'),
    logs: readOption(args, '--logs'),
  });
  process.stdout.write(report.text);
}
