#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = 'docs/verify';
export const LEDGER = `${ROOT}/pruned.json`;
const CODE_PATHS = [
  'apps',
  'packages',
  'scripts',
  '.github',
  'integration',
  '.claude/skills/*/scripts/*',
];
const SELF = [':!scripts/evidence-prune.mjs', ':!scripts/evidence-prune.test.mjs'];
const FOLDER_REF = /docs\/verify\/([A-Za-z0-9_-]+)/g;

const { values } = parseArgs({
  options: {
    days: { type: 'string', default: '14' },
    now: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const top = git('rev-parse', '--show-toplevel').trim();
process.chdir(top);
if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  console.error('evidence-prune: shallow clone, folder ages are unknown; fetch full history first');
  process.exit(2);
}

const folderOf = (path) => path.slice(ROOT.length + 1).split('/')[0];
const folders = new Set(
  git('ls-tree', '-r', '--name-only', 'HEAD', '--', ROOT)
    .split('\n')
    .filter((path) => path.slice(ROOT.length + 1).includes('/'))
    .map(folderOf),
);

const lastCommit = new Map();
let current;
for (const line of git('log', '--format=@%H %ct', '--name-only', '--', ROOT).split('\n')) {
  if (line.startsWith('@')) {
    const [sha, time] = line.slice(1).split(' ');
    current = { sha, time: Number(time) * 1000 };
  } else if (line.startsWith(`${ROOT}/`)) {
    const folder = folderOf(line);
    if (folders.has(folder) && !lastCommit.has(folder)) lastCommit.set(folder, current);
  }
}

const codeRefs = spawnSync(
  'git',
  ['grep', '-ohE', FOLDER_REF.source, '--', ...CODE_PATHS, ...SELF],
  {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  },
);
if (codeRefs.status !== 0 && codeRefs.status !== 1) throw new Error(`git grep failed: ${codeRefs.stderr}`);
const referenced = new Set([...codeRefs.stdout.matchAll(FOLDER_REF)].map((match) => match[1]));

const now = values.now ? Date.parse(values.now) : Date.now();
const cutoff = now - Number(values.days) * 86400000;
const due = [...folders]
  .filter((folder) => !referenced.has(folder) && lastCommit.get(folder).time < cutoff)
  .sort();

if (due.length === 0) {
  console.log(`evidence-prune: nothing to prune (window ${values.days} days)`);
  process.exit(0);
}

for (const folder of due) {
  console.log(`prune ${ROOT}/${folder}/ (last ${lastCommit.get(folder).sha.slice(0, 7)})`);
}
console.log(`evidence-prune: ${due.length} folder(s) due (window ${values.days} days)`);
if (values['dry-run']) process.exit(0);

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
for (const folder of due) ledger[folder] = lastCommit.get(folder).sha;
const sorted = Object.fromEntries(
  Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
);
git('rm', '-r', '-q', '--', ...due.map((folder) => `${ROOT}/${folder}`));
writeFileSync(join(top, LEDGER), `${JSON.stringify(sorted, null, 2)}\n`);
git('add', '--', LEDGER);
