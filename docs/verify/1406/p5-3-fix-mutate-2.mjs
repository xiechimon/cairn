// #1406 P5-3 follow-up, round 2 (#1480 pr-gate run 1 suggestions 4 and 7,
// plus the /code-review fixes of this round). Same shape as
// p5-3-fix-mutate.mjs: for each rule, copy the source file into a scratch
// directory, apply one mutation, run the named test files, record the
// summary, then copy the saved file back and check its sha256. An edit is an
// anchored replacement ({from, to}); the anchor must occur exactly once.
// Run from the repo root:
//   node docs/verify/1406/p5-3-fix-mutate-2.mjs "$PWD" <scratch-dir> > docs/verify/1406/p5-3-fix-mutations-2.txt
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = process.argv[2];
const scratch = process.argv[3];
if (!root || !scratch) throw new Error('usage: p5-3-fix-mutate-2.mjs <repo-root> <scratch-dir>');
mkdirSync(scratch, { recursive: true });
const sha = (s) => createHash('sha256').update(s).digest('hex');

const ATTACH = 'apps/daemon/src/step-attachments.ts';
const ATTACH_T = 'apps/daemon/test/step-attachments.test.ts';
const DAEMON_T = 'apps/daemon/test/runner-issue-fence.test.ts';
const STRIP = '    if (cp < 0x20 || cp === 0x85 || cp === 0x2028 || cp === 0x2029) continue;\n';

const mutations = [
  {
    id: 'M12',
    rule: 'safeFileName strips U+0085 (suggestion 4)',
    note: 'the U+0085 comparison is dropped; U+2028, U+2029 and Cf are still stripped',
    file: ATTACH,
    edits: [{ from: STRIP, to: '    if (cp < 0x20 || cp === 0x2028 || cp === 0x2029) continue;\n' }],
    tests: [ATTACH_T],
  },
  {
    id: 'M13',
    rule: 'safeFileName strips U+2029 (suggestion 4)',
    note: 'the U+2029 comparison is dropped; U+0085, U+2028 and Cf are still stripped',
    file: ATTACH,
    edits: [{ from: STRIP, to: '    if (cp < 0x20 || cp === 0x85 || cp === 0x2028) continue;\n' }],
    tests: [ATTACH_T],
  },
  {
    id: 'M14',
    rule: 'a name that strips to ".." falls back to "attachment" (suggestion 7)',
    note: 'the fallback covers "" and "." only (the ff385a4 rule)',
    file: ATTACH,
    edits: [
      {
        from: "  return out === '' || out === '.' || out === '..' ? 'attachment' : out;\n",
        to: "  return out === '' || out === '.' ? 'attachment' : out;\n",
      },
    ],
    tests: [ATTACH_T, DAEMON_T],
  },
  {
    id: 'M15',
    rule: 'materializeFile refuses a path that is not <root>/<one segment>/<name> (suggestion 7)',
    note: 'the segment guard never fires',
    file: ATTACH,
    edits: [
      {
        from: "  if (segments.length !== 2 || segments.includes('..')) {\n",
        to: '  if (segments.length < 0) {\n',
      },
    ],
    tests: [ATTACH_T],
  },
  {
    id: 'M16',
    rule: 'the guard rejects a parent segment, not only a wrong segment count',
    note: 'the guard checks the segment count only, so stepId ".." passes ("../<name>" is two segments)',
    file: ATTACH,
    edits: [
      {
        from: "  if (segments.length !== 2 || segments.includes('..')) {\n",
        to: '  if (segments.length !== 2) {\n',
      },
    ],
    tests: [ATTACH_T],
  },
  {
    id: 'M17',
    rule: 'the guard runs before any directory is created',
    note: 'mkdirSync runs before the guard',
    file: ATTACH,
    edits: [
      {
        from: '  const segments = relative(materializeDir, path).split(sep);\n',
        to: '  mkdirSync(dirname(path), { recursive: true });\n  const segments = relative(materializeDir, path).split(sep);\n',
      },
    ],
    tests: [ATTACH_T],
  },
  {
    id: 'M18',
    rule: 'the guard error stays on one line (path JSON-encoded) (/code-review)',
    note: 'the raw path goes into the message',
    file: ATTACH,
    edits: [{ from: '${JSON.stringify(path)}`,\n', to: '${path}`,\n' }],
    tests: [ATTACH_T],
  },
  {
    id: 'M19',
    rule: 'a materialize failure fails that token only; other images still arrive (/code-review)',
    note: 'the materialize catch rethrows (the ff385a4 behavior: the whole resolve fails)',
    file: ATTACH,
    edits: [
      {
        from: "    return unavailable(ref.key, 'materialize', err, opts.log);\n",
        to: '    throw err;\n',
      },
    ],
    tests: [ATTACH_T, DAEMON_T],
  },
];

function apply(text, edit, id) {
  const hits = text.split(edit.from).length - 1;
  if (hits !== 1) throw new Error(`${id}: anchor occurs ${hits} times`);
  return text.replace(edit.from, () => edit.to);
}

const out = [];
for (const m of mutations) {
  const path = join(root, m.file);
  const saved = join(scratch, `${m.id}-${basename(m.file)}`);
  copyFileSync(path, saved);
  const original = readFileSync(saved, 'utf8');
  let mutated = original;
  for (const e of m.edits) mutated = apply(mutated, e, m.id);
  writeFileSync(path, mutated);
  let log = '';
  let status = 0;
  try {
    log = execFileSync('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', ...m.tests], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
  } catch (err) {
    status = err.status ?? 1;
    log = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    copyFileSync(saved, path);
  }
  if (sha(readFileSync(path, 'utf8')) !== sha(original)) throw new Error(`${m.id}: restore failed`);
  const lines = log.split('\n');
  const failed = lines.filter((l) => /^\s+×/.test(l)).map((l) => l.replace(/\s+\d+ms$/, '').trim());
  const reasons = lines
    .filter((l) => /^AssertionError|^Error:|^TypeError/.test(l))
    .map((l) => l.trim().slice(0, 240));
  const summary = lines.filter((l) => /^\s+(Test Files|Tests)\s/.test(l));
  out.push(
    `## ${m.id}: ${m.rule}`,
    `file: ${m.file}`,
    `mutation: ${m.note}`,
    ...m.edits.map((e) => `  edit: ${JSON.stringify(e.from.trim())} -> ${JSON.stringify(e.to.trim())}`),
    `tests: ${m.tests.join(' ')}`,
    `vitest exit: ${status} (${status === 0 ? 'SURVIVED' : 'KILLED'})`,
    ...summary.map((l) => l.trim()),
    'failing cases:',
    ...failed.map((l) => `  ${l}`),
    'first assertion messages:',
    ...reasons.slice(0, 4).map((l) => `  ${l}`),
    `restored by copying back the scratch copy ${basename(saved)} (sha256 ${sha(original)})`,
    '',
  );
}
process.stdout.write(`${out.join('\n')}\n`);
