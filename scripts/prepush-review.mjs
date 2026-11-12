import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, matchesGlob, resolve } from 'node:path';
import { countsTowardSize } from './pr-size.mjs';

const root = resolve(import.meta.dirname, '..');

export const LINE_TRIGGER = 300;
export const INPUT_TOKEN_CAP = 24_000;
export const OUTPUT_TOKEN_CAP = 1_500;
export const TIME_CAP_MS = 90_000;
export const MODELS = [
  'workbuddy/deepseek-v4.1-flash',
  'workbuddy/hy4free',
  'anthropic/claude-haiku-5-5',
];
export const ANSWER_TRAILER = 'Pre-push-review-answer';

const CHARS_PER_TOKEN = 4;
const MAX_BUFFER = 256 * 1024 * 1024;
const PI_FLAGS = [
  '--no-session',
  '--no-tools',
  '--no-context-files',
  '-p',
  '--mode',
  'json',
  '--thinking',
  'off',
];
const KEY_VALUE_FILE =
  /(?:\.(?:md|ya?ml|toml|json|jsonl|ini|conf|cfg|properties|env|txt|sh|bash|zsh)|(?:^|\/)\.env[^/]*)$/;
const PEM = /-----BEGIN [A-Z0-9 ]+-----/;
const SECRET_KEY =
  /(?:password|passwd|secret|token|api_key|apikey|private_key|access_key|credential)[\w.-]*["'`]?\s*[:=]\s*(.*)$/i;
const PLACEHOLDER = /^(?:example|changeme|<.*>|xxx|\*\*\*)$/i;

const matchesAny = (path, globs) => globs.some((glob) => matchesGlob(path, glob));

export function reviewTrigger(files, guarded) {
  const path = files.find((file) => matchesAny(file.filename, guarded))?.filename;
  if (path) return `path ${path}`;
  const lines = files
    .filter((file) => countsTowardSize(file.filename))
    .reduce((total, file) => total + file.additions + file.deletions, 0);
  return lines > LINE_TRIGGER ? `${lines} counted lines` : null;
}

export function parseHunks(patch) {
  const lines = patch.split('\n');
  const hunks = [];
  for (let index = 0; index < lines.length; index++) {
    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]);
    if (!head) continue;
    const hunk = {
      oldStart: Number(head[1]),
      oldCount: Number(head[2] ?? 1),
      newStart: Number(head[3]),
      newCount: Number(head[4] ?? 1),
      rows: [],
    };
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    while (
      (oldLine < hunk.oldStart + hunk.oldCount || newLine < hunk.newStart + hunk.newCount) &&
      index + 1 < lines.length
    ) {
      const line = lines[++index];
      if (line.startsWith('\\')) continue;
      const text = line.slice(1);
      if (line.startsWith('+')) hunk.rows.push({ sign: '+', text, newLine: newLine++ });
      else if (line.startsWith('-')) hunk.rows.push({ sign: '-', text, oldLine: oldLine++ });
      else hunk.rows.push({ sign: ' ', text, oldLine: oldLine++, newLine: newLine++ });
    }
    hunks.push(hunk);
  }
  return hunks;
}

export function carriedLine(line, hunks) {
  let shift = 0;
  for (const hunk of hunks) {
    if (hunk.rows.some((row) => row.oldLine === line)) return null;
    if (hunk.oldStart + hunk.oldCount <= line) shift += hunk.newCount - hunk.oldCount;
  }
  return line + shift;
}

export function keyValueSecret(line) {
  const value = SECRET_KEY.exec(line)?.[1]
    .trim()
    .replace(/^["'`]|["'`,;]+$/g, '');
  return Boolean(value) && !/^\$(?:\{|[A-Za-z_])/.test(value) && !PLACEHOLDER.test(value);
}

const rowsOf = (file) => file.hunks.flatMap((hunk) => hunk.rows);

export function sendableFiles(files, credentialGlobs, redactionHits, say) {
  const scanned = files.filter((file) => {
    if (matchesAny(file.path, credentialGlobs)) {
      say(`skipped (credential path) ${file.path}`);
      return false;
    }
    return true;
  });
  const shared = redactionHits(
    scanned.map((file) => ({
      path: file.path,
      text: rowsOf(file)
        .map((row) => row.text)
        .join('\n'),
    })),
  );
  if (shared === null) {
    say('skipped (secret scan unavailable)');
    return null;
  }
  return scanned.filter((file) => {
    const suspect =
      shared.includes(file.path) ||
      rowsOf(file).some(
        (row) => PEM.test(row.text) || (KEY_VALUE_FILE.test(file.path) && keyValueSecret(row.text)),
      );
    if (suspect) say(`withheld (possible secret) ${file.path}`);
    return !suspect;
  });
}

export function buildPayload(files, capChars) {
  const sent = new Map();
  const parts = [];
  let size = 0;
  for (const file of [...files].sort((a, b) => Number(b.guarded) - Number(a.guarded))) {
    for (const hunk of file.hunks) {
      const text = [
        `=== ${file.path}`,
        ...hunk.rows.map((row) => `${row.sign}${row.newLine ?? ''}\t${row.text}`),
      ].join('\n');
      if (size + text.length > capChars) return { text: parts.join('\n'), sent, truncated: true };
      size += text.length + 1;
      parts.push(text);
      const lines = sent.get(file.path) ?? new Set();
      for (const row of hunk.rows) if (row.newLine) lines.add(row.newLine);
      sent.set(file.path, lines);
    }
  }
  return { text: parts.join('\n'), sent, truncated: false };
}

export function assistantText(stdout) {
  let text = null;
  for (const record of stdout.split('\n')) {
    if (!record.startsWith('{')) continue;
    const event = JSON.parse(record);
    if (event.type !== 'message_end' || event.message?.role !== 'assistant') continue;
    text =
      event.message.stopReason === 'stop'
        ? event.message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('')
        : null;
  }
  return text;
}

export function parseReply(reply, sent) {
  if (reply === null || reply.length > OUTPUT_TOKEN_CAP * CHARS_PER_TOKEN) return null;
  const lines = reply.split('\n').map((line) => line.replace(/^[-*\s`]+|[\s`]+$/g, ''));
  const count = /^count: (\d+)$/.exec(lines.findLast((line) => line !== '') ?? '');
  if (!count || (count[1] === '0' && !lines.includes('no issues'))) return null;
  return lines.flatMap((line) => {
    const match = /^(\S+?):(\d+): ([^:]+): (.+)$/.exec(line);
    return match && sent.get(match[1])?.has(Number(match[2]))
      ? [{ path: match[1], line: Number(match[2]), bugClass: match[3], text: match[4] }]
      : [];
  });
}

const classKey = (bugClass) => bugClass.toLowerCase().replace(/[\s_-]/g, '');

export function isAnswered(finding, answers) {
  return answers.some((answer) => {
    const [path, bugClass, ...reason] = answer.split(':').map((part) => part.trim());
    return (
      path === finding.path &&
      classKey(bugClass ?? '') === classKey(finding.bugClass) &&
      reason.join(':') !== ''
    );
  });
}

const findingLine = (finding) =>
  `${finding.path}:${finding.line}: ${finding.bugClass}: ${finding.text}`;

function sharedRedactionHits(files) {
  const scan = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(root, 'scripts/prepush-review-secrets.mjs')],
    {
      cwd: join(root, 'apps/server'),
      input: JSON.stringify(files),
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    },
  );
  return scan.status === 0 ? JSON.parse(scan.stdout) : null;
}

function askModels({ pi, system, input, sent, timeCapMs, say }) {
  const deadline = Date.now() + timeCapMs;
  let reason = 'timeout';
  for (const model of MODELS) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const run = spawnSync(pi, [...PI_FLAGS, '--model', model, '--system-prompt', system], {
      input,
      encoding: 'utf8',
      timeout: left,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_BUFFER,
    });
    if (run.error?.code === 'ENOENT') {
      reason = 'pi missing';
      break;
    }
    if (run.error?.code === 'ETIMEDOUT') break;
    const findings = run.status === 0 ? parseReply(assistantText(run.stdout), sent) : null;
    if (findings) return findings;
    reason = run.status === 0 ? `${model}: no count line` : `${model}: exit ${run.status}`;
  }
  say(`skipped (${reason})`);
  return null;
}

function review({ cwd, env, say, redactionHits, timeCapMs }) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const gatePaths = JSON.parse(
    readFileSync(join(root, 'packages/shared/merge-gate-paths.json'), 'utf8'),
  );
  const guarded = [...gatePaths.protected, ...Object.values(gatePaths.humanQueue).flat()];
  const base = git(['merge-base', 'HEAD', env.PREPUSH_BASE_SHA || 'origin/main']).trim();
  const changed = git(['diff', '--no-renames', '--numstat', '-z', base, 'HEAD'])
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const [additions, deletions, filename] = row.split('\t');
      return { filename, additions: Number(additions) || 0, deletions: Number(deletions) || 0 };
    });
  const trigger = reviewTrigger(changed, guarded);
  if (!trigger) return 0;

  const head = git(['rev-parse', 'HEAD']).trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const statePath = join(git(['rev-parse', '--absolute-git-dir']).trim(), 'prepush-review.json');
  const states = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const prior =
    states[branch] &&
    spawnSync('git', ['cat-file', '-e', `${states[branch].sha}^{commit}`], { cwd }).status === 0
      ? states[branch]
      : null;
  const from = prior?.sha ?? base;
  const files = changed
    .filter((file) => countsTowardSize(file.filename))
    .map((file) => ({
      path: file.filename,
      guarded: matchesAny(file.filename, guarded),
      hunks: parseHunks(git(['diff', '--no-renames', '-U3', from, 'HEAD', '--', file.filename])),
    }));
  const answers = git([
    'log',
    `--format=%(trailers:key=${ANSWER_TRAILER},valueonly)`,
    `${base}..HEAD`,
  ])
    .split('\n')
    .filter(Boolean);
  const carried = (prior?.findings ?? []).flatMap((finding) => {
    const file = files.find((candidate) => candidate.path === finding.path);
    const line = file ? carriedLine(finding.line, file.hunks) : null;
    return line === null ? [] : [{ ...finding, line }];
  });

  const system = readFileSync(join(root, 'scripts/prepush-review.md'), 'utf8');
  const sendable = sendableFiles(
    files.filter((file) => file.hunks.length > 0),
    gatePaths.humanQueue.credentials,
    redactionHits,
    say,
  );
  const payload = buildPayload(sendable ?? [], INPUT_TOKEN_CAP * CHARS_PER_TOKEN - system.length);
  if (payload.truncated) say('truncated');
  const fresh =
    sendable === null || payload.sent.size === 0
      ? sendable && []
      : askModels({
          pi: env.PREPUSH_REVIEW_PI || 'pi',
          system,
          input: [
            'Already reported, do not report again:',
            ...carried.map(findingLine),
            '',
            'Diff:',
            payload.text,
          ].join('\n'),
          sent: payload.sent,
          timeCapMs,
          say,
        });
  const open = [...carried, ...(fresh ?? [])].filter((finding) => !isAnswered(finding, answers));
  if (fresh)
    writeFileSync(
      statePath,
      JSON.stringify({ ...states, [branch]: { sha: head, findings: open } }),
    );
  for (const finding of open) say(findingLine(finding));
  if (fresh) say(`count: ${open.length} (${trigger})`);
  if (open.length === 0) return 0;
  say(
    `blocked: fix each finding, or answer it on a commit in this push with the trailer "${ANSWER_TRAILER}: <path>: <bug-class>: <reason>"`,
  );
  return 1;
}

export function runReview({
  cwd = root,
  env = process.env,
  log = console.log,
  redactionHits = sharedRedactionHits,
  timeCapMs = TIME_CAP_MS,
} = {}) {
  const say = (text) => log(`prepush-review: ${text}`);
  try {
    return review({ cwd, env, say, redactionHits, timeCapMs });
  } catch (error) {
    say(`skipped (${String(error.message).split('\n')[0].slice(0, 160)})`);
    return 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) process.exit(runReview());
