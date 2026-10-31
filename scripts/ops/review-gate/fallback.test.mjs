import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const gateScript = fileURLToPath(new URL('./review-gate.mjs', import.meta.url));
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
const script = (path, body) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

function host({ author, claude, priorNoVerdictMs, stallNoted }) {
  const home = mkdtempSync(join(tmpdir(), 'review-gate-host-'));
  const bin = join(home, 'bin');
  const log = join(home, 'calls.log');
  const origin = join(home, 'origin.git');
  const work = join(home, 'work');
  for (const dir of [
    bin,
    work,
    join(home, '.cairn/tools/app-token'),
    join(home, '.cairn/tools/governor'),
    join(home, '.local/state/ai-route'),
    join(home, '.local/state/review-gate'),
    join(work, 'packages/shared/src/records'),
  ])
    mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(work, 'packages/shared/src/records/merge-gate.ts'),
    "export const PROTECTED_PATH_GLOBS = [\n  'scripts/**',\n];\n",
  );
  git(home, 'init', '-q', '--bare', origin);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  writeFileSync(join(work, 'feature.txt'), 'change\n');
  git(work, 'add', 'feature.txt');
  git(work, 'commit', '-q', '-m', 'change');
  const sha = git(work, 'rev-parse', 'HEAD').trim();
  git(work, 'push', '-q', 'origin', 'HEAD:refs/pull/2306/head');
  git(home, 'clone', '-q', origin, join(home, 'lanes/cairn'));

  const pr = {
    number: 2306,
    isDraft: false,
    headRefOid: sha,
    headRefName: 'lane/2303',
    files: [{ path: 'feature.txt' }],
    title: 'web(2303): example',
    labels: [],
    autoMergeRequest: null,
  };
  writeFileSync(join(home, 'prs.json'), JSON.stringify([pr]));
  writeFileSync(
    join(home, 'comments.json'),
    JSON.stringify({
      comments: stallNoted ? [{ body: `<!-- review-gate-stalled:${sha} -->\nnoted` }] : [],
    }),
  );
  writeFileSync(
    join(home, '.local/state/ai-route/runs.jsonl'),
    `${JSON.stringify({ role: 'implement', failed: false, cwd: '/x/cairn-2303', kind: author.kind, model: author.model })}\n`,
  );
  if (priorNoVerdictMs)
    writeFileSync(
      join(home, '.local/state/review-gate/runs.jsonl'),
      `${JSON.stringify({ at: new Date(Date.now() - priorNoVerdictMs).toISOString(), pr: 2306, sha, verdict: null })}\n`,
    );
  script(
    join(bin, 'gh'),
    `#!/bin/sh
echo "gh $*" >> "${log}"
case "$*" in
  *"pr list"*) cat "${home}/prs.json" ;;
  *"--json comments"*) cat "${home}/comments.json" ;;
  *"--json files"*) echo '{"files":[{"path":"feature.txt"}]}' ;;
  *"--json title,body"*) echo '{"title":"web(2303): example","body":"PR BODY TEXT"}' ;;
esac
`,
  );
  script(
    join(home, '.cairn/tools/app-token/as-bot.sh'),
    `#!/bin/sh
if [ "$1" = gh ]; then shift; echo "bot gh $*" >> "${log}"; cat >> "${log}"; echo >> "${log}"; exit 0; fi
exec "$@"
`,
  );
  script(join(home, '.cairn/tools/governor/tier.sh'), '#!/bin/sh\necho AI_ROUTE_PREFER=pi\n');
  script(
    join(bin, 'ai-route'),
    `#!/bin/sh
echo "ai-route $AI_ROUTE_EXCLUDE_VENDORS" >> "${log}"
echo "ai-route: no usable model for role review" >&2
exit 1
`,
  );
  if (claude)
    script(
      join(bin, 'claude'),
      `#!/bin/sh
echo "claude $* proxy=$HTTPS_PROXY" >> "${log}"
cat > "${home}/claude-input.txt"
printf '%s\\n' "${claude}"
`,
    );
  const run = spawnSync(process.execPath, [gateScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      HTTPS_PROXY: 'http://127.0.0.1:7890',
    },
  });
  return { run, calls: existsSync(log) ? readFileSync(log, 'utf8') : '', sha, home };
}

const openai = { kind: 'codex', model: 'default' };
const anthropic = { kind: 'claude', model: 'claude-opus-5-5' };

test('openai author with no usable cross-vendor model gets a Claude verdict', () => {
  const { run, calls, sha, home } = host({
    author: openai,
    claude: '1. suggestion: none\nVERDICT: pass',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(calls, /ai-route openai/);
  assert.match(
    calls,
    /^claude -p --model opus .*--tools Read,Grep,Glob .*proxy=http:\/\/127\.0\.0\.1:7890$/m,
  );
  const input = readFileSync(join(home, 'claude-input.txt'), 'utf8');
  assert.match(input, /PR description:\nPR BODY TEXT/);
  assert.match(input, /\+change/);
  assert.match(
    calls,
    new RegExp(`<!-- review-gate:${sha} -->\\n\\*\\*Independent review gate: PASS\\*\\* for `),
  );
  assert.match(calls, /reviewer: Claude \(opus\), author vendor openai excluded/);
});

test('a Claude BLOCK is posted as a block', () => {
  const { calls } = host({
    author: openai,
    claude: '1. blocking: feature.txt:1 wrong\nVERDICT: block',
  });
  assert.match(calls, /Independent review gate: BLOCK/);
  assert.match(calls, /feature.txt:1 wrong/);
});

test('anthropic author never falls back to Claude', () => {
  const { calls } = host({ author: anthropic, claude: 'VERDICT: pass' });
  assert.match(calls, /ai-route anthropic/);
  assert.doesNotMatch(calls, /^claude /m);
  assert.doesNotMatch(calls, /Independent review gate: PASS/);
});

test('no verdict for over an hour alerts once with the review-stalled label', () => {
  const first = host({ author: anthropic, priorNoVerdictMs: 2 * 3600_000 });
  assert.match(first.calls, new RegExp(`<!-- review-gate-stalled:${first.sha} -->`));
  assert.match(first.calls, /bot gh pr edit 2306 -R xiechimon\/cairn --add-label review-stalled/);
  const fresh = host({ author: anthropic, priorNoVerdictMs: 10 * 60_000 });
  assert.doesNotMatch(fresh.calls, /review-gate-stalled/);
  const again = host({ author: anthropic, priorNoVerdictMs: 3 * 3600_000, stallNoted: true });
  assert.doesNotMatch(again.calls, /review-gate-stalled|add-label/);
});
