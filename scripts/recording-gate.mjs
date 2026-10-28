#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  isRecordingPath,
  RECORDING_EXTENSIONS,
  RECORDING_MAX_BYTES,
  recordingRequirements,
} from '../packages/shared/src/records/recording-trigger.ts';

const EVIDENCE_ROOT = 'docs/verify/';
const EVIDENCE_FILE_RE = /^docs\/verify\/([A-Za-z0-9_-]+)\/.+/;
const CAP_MIB = RECORDING_MAX_BYTES / (1024 * 1024);

const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    base: { type: 'string', default: 'origin/main' },
    ticket: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(
    'usage: node scripts/recording-gate.mjs [--repo <dir>] [--base origin/main] [--ticket <ref>]',
  );
  process.exit(0);
}

const git = (repo, ...args) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });

const run = (repo, args) => {
  try {
    return git(repo, ...args);
  } catch (error) {
    console.error(
      `recording-gate: cannot read the change (git ${args.join(' ')} exited ${error.status ?? 'unknown'})`,
    );
    console.error(
      '  Fetch the base branch, or pass --base <ref> naming a commit this branch forks from.',
    );
    process.exit(2);
  }
};

const repo = values.repo
  ? resolve(values.repo)
  : run(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
let mergeBase = values.base;
try {
  mergeBase = git(repo, 'merge-base', values.base, 'HEAD').trim();
} catch {
  run(repo, ['rev-parse', '--verify', values.base]);
}
const changed = run(repo, ['diff', '--name-only', '-z', mergeBase, 'HEAD'])
  .split('\0')
  .filter((path) => path.length > 0);
if (changed.length === 0) {
  console.log('recording-gate: OK (the branch changes nothing against its base)');
  process.exit(0);
}
const patches = run(repo, [
  'diff',
  '--no-color',
  '--unified=0',
  mergeBase,
  'HEAD',
  '--',
  ...changed,
]);

const requirement = recordingRequirements(
  changed.map((path) => ({
    filename: path,
    status:
      run(repo, ['diff', '--name-status', mergeBase, 'HEAD', '--', path]).split('\t')[0] ??
      'modified',
    patch: (() => {
      const start = patches.indexOf(`diff --git a/${path} b/${path}`);
      if (start === -1) return null;
      const next = patches.indexOf('\ndiff --git ', start);
      return next === -1 ? patches.slice(start) : patches.slice(start, next);
    })(),
  })),
);

if (!requirement.required) {
  console.log('recording-gate: OK (no added line animates or drives an interaction)');
  process.exit(0);
}
const tickets = new Set();
for (const path of changed) {
  const match = EVIDENCE_FILE_RE.exec(path);
  if (match !== null) tickets.add(match[1]);
}
if (values.ticket !== undefined) {
  if (tickets.size > 0 && !tickets.has(values.ticket)) {
    console.error(
      `recording-gate: --ticket ${values.ticket} does not match the evidence directory this branch touches (${[...tickets].join(', ')})`,
    );
    process.exit(2);
  }
  tickets.clear();
  tickets.add(values.ticket);
}
if (tickets.size > 1) {
  console.error(
    `recording-gate: two ticket evidence directories in one branch (${[...tickets].sort().join(', ')})`,
  );
  console.error('  Split the diff, or pass --ticket <ref> naming the one this change belongs to.');
  process.exit(2);
}
const ticket = tickets.size === 1 ? [...tickets][0] : null;

console.log('recording-gate: this change animates or drives an interaction:');
for (const reason of requirement.reasons) console.log(`  ${reason}`);

const dir = ticket === null ? EVIDENCE_ROOT : `${EVIDENCE_ROOT}${ticket}/`;
const recordings = changed.filter((path) => path.startsWith(dir) && isRecordingPath(path));
if (recordings.length === 0) {
  console.error(`recording-missing: ${dir} adds no ${RECORDING_EXTENSIONS.join(', ')} recording`);
  console.error(
    `  Record the behavior: node .claude/skills/verify-cairn/scripts/vp.mjs capture <route> --video, then archive it under ${dir}.`,
  );
  process.exit(1);
}

const oversized = recordings.filter((path) => {
  const full = resolve(repo, path);
  return (
    !existsSync(full) || statSync(full).size === 0 || statSync(full).size > RECORDING_MAX_BYTES
  );
});
if (oversized.length > 0) {
  for (const path of oversized) {
    const full = resolve(repo, path);
    const size = existsSync(full) ? statSync(full).size : 0;
    console.error(
      `recording-too-large: ${path} is ${size} bytes, at most ${RECORDING_MAX_BYTES} (${CAP_MIB} MiB)`,
    );
  }
  console.error('  Trim the idle gaps, or shorten the recorded wait.');
  process.exit(1);
}

console.log(`recording-gate: OK (${recordings.join(', ')})`);
