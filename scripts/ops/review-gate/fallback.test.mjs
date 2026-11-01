import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

const GATE = { login: 'cairnwright' };
const COMMENT_URL = 'https://github.com/xiechimon/cairn/pull/2306#issuecomment-99';

function host({
  author,
  claude,
  priorNoVerdictMs,
  stallNoted,
  labelled,
  failLabel,
  bigDiff,
  bulkFiles,
  comments,
  failStatus,
  staleHead,
  setup,
  files,
  labels,
}) {
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
    join(work, 'packages/shared'),
  ])
    mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(work, 'packages/shared/merge-gate-paths.json'),
    `${JSON.stringify({
      protected: ['scripts/**', 'docs/adr/**'],
      limits: { maxLines: 800, maxFiles: 40 },
    })}\n`,
  );
  git(home, 'init', '-q', '--bare', origin);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'pr');
  const commit = (changes, message) => {
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) rmSync(join(work, path));
      else {
        mkdirSync(dirname(join(work, path)), { recursive: true });
        writeFileSync(join(work, path), content);
      }
    }
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', message);
    return git(work, 'rev-parse', 'HEAD').trim();
  };
  const onMain = (changes, message) => {
    git(work, 'checkout', '-q', 'main');
    const moved = commit(changes, message);
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', 'pr');
    return moved;
  };
  const merge = (changes) => {
    git(work, 'merge', '-q', '--no-ff', '--no-edit', '--no-commit', 'main');
    return commit(changes ?? {}, 'merge main');
  };
  const patchOf = (ref) =>
    execFileSync(
      'bash',
      ['-c', `git diff origin/main...${ref} | git patch-id --stable | cut -d' ' -f1`],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  const featureChange = () => {
    commit(
      {
        'feature.txt': 'change\n',
        ...(bulkFiles
          ? {
              ...Object.fromEntries(
                Array.from({ length: bulkFiles }, (_, i) => [`bulk/f${i}.txt`, 'x\n']),
              ),
              'docs/verify/2372/run.txt': `${'evidence\n'.repeat(900)}`,
            }
          : {}),
        ...(bigDiff
          ? {
              'benign.txt': `${'benign line\n'.repeat(12_000)}`,
              'scripts/zz-gate.mjs': 'export const gate = false;\n',
            }
          : {}),
      },
      'change',
    );
  };
  const extra = (setup ?? featureChange)({ commit, onMain, merge, patchOf }) ?? {};
  const sha = git(work, 'rev-parse', 'HEAD').trim();
  const patch = patchOf('HEAD');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/pull/2306/head');
  git(home, 'clone', '-q', origin, join(home, 'lanes/cairn'));

  const pr = {
    number: 2306,
    isDraft: false,
    headRefOid: staleHead ? 'd'.repeat(40) : sha,
    headRefName: 'lane/2303',
    files: files ?? [{ path: 'feature.txt' }],
    title: 'web(2303): example',
    labels: [...(labelled ? [{ name: 'review-stalled' }] : []), ...(labels ?? [])],
    autoMergeRequest: null,
  };
  writeFileSync(join(home, 'prs.json'), JSON.stringify([pr]));
  const setComments = (list) =>
    writeFileSync(join(home, 'comments.json'), JSON.stringify({ comments: list }));
  setComments([
    ...(stallNoted ? [{ author: GATE, body: `<!-- review-gate-stalled:${sha} -->\nnoted` }] : []),
    ...(comments ? comments({ sha, patch, ...extra }) : []),
  ]);
  const failStatusFlag = join(home, 'fail-status');
  if (failStatus) writeFileSync(failStatusFlag, '');
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
  "api --method POST repos/xiechimon/cairn/statuses/"*) [ -f "${failStatusFlag}" ] && exit 1; echo '{}' ;;
esac
`,
  );
  script(
    join(home, '.cairn/tools/app-token/as-bot.sh'),
    `#!/bin/sh
if [ "$1" = gh ]; then shift; echo "bot gh $*" >> "${log}"; cat >> "${log}"; echo >> "${log}"
  case "$*" in *--add-label*) [ -n "${failLabel ? 'fail' : ''}" ] && exit 1 ;; "pr comment"*) echo "${COMMENT_URL}" ;; esac
  exit 0
fi
exec "$@"
`,
  );
  script(join(home, '.cairn/tools/governor/tier.sh'), '#!/bin/sh\necho AI_ROUTE_PREFER=pi\n');
  script(
    join(bin, 'ai-route'),
    `#!/bin/sh
echo "ai-route $AI_ROUTE_EXCLUDE_VENDORS" >> "${log}"
for arg; do prompt=$arg; done
printf '%s' "$prompt" > "${home}/ai-route-prompt.txt"
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
  const round = () => {
    const before = existsSync(log) ? readFileSync(log, 'utf8').length : 0;
    const run = spawnSync(process.execPath, [gateScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        HTTPS_PROXY: 'http://127.0.0.1:7890',
      },
    });
    return { run, calls: existsSync(log) ? readFileSync(log, 'utf8').slice(before) : '' };
  };
  const next = (list) => {
    setComments(list);
    rmSync(failStatusFlag, { force: true });
    return round();
  };
  return { ...round(), sha, patch, home, next, ...extra };
}

const statusPosts = (calls) =>
  [...calls.matchAll(/^gh api --method POST repos\/xiechimon\/cairn\/statuses\/(\S+) (.*)$/gm)].map(
    ([, sha, rest]) => ({ sha, rest }),
  );
const onlyFor = (calls, sha) => {
  const posts = statusPosts(calls);
  assert.ok(posts.length > 0, 'a review-gate status was posted');
  for (const post of posts) {
    assert.equal(post.sha, sha);
    assert.match(post.rest, /^-f state=\w+ -f context=review-gate -f description=/);
  }
  return posts;
};
const verdictComment = (sha, verdict, patch) => ({
  author: GATE,
  url: COMMENT_URL,
  body: `<!-- review-gate:${sha} -->\n**Independent review gate: ${verdict}** for \`${sha.slice(0, 8)}\`.\n<!-- review-gate-patch:${patch} -->`,
});

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
  const again = host({
    author: anthropic,
    priorNoVerdictMs: 3 * 3600_000,
    stallNoted: true,
    labelled: true,
  });
  assert.doesNotMatch(again.calls, /review-gate-stalled|add-label/);
});

test('a failed label add is retried on the next round without a second comment', () => {
  const failed = host({ author: anthropic, priorNoVerdictMs: 2 * 3600_000, failLabel: true });
  assert.equal(failed.run.status, 0, failed.run.stderr);
  assert.match(failed.calls, new RegExp(`<!-- review-gate-stalled:${failed.sha} -->`));
  assert.match(failed.calls, /--add-label review-stalled/);
  assert.match(failed.run.stdout, /review-stalled label failed; retrying next round/);
  const retry = host({ author: anthropic, priorNoVerdictMs: 2 * 3600_000, stallNoted: true });
  assert.match(retry.calls, /bot gh pr edit 2306 -R xiechimon\/cairn --add-label review-stalled/);
  assert.doesNotMatch(retry.calls, /review-gate-stalled/);
});

test('a diff over the cap never reaches Claude, so a hidden change cannot PASS', () => {
  const { calls } = host({ author: openai, claude: 'VERDICT: pass', bigDiff: true });
  assert.doesNotMatch(calls, /^claude /m);
  assert.doesNotMatch(calls, /Independent review gate: PASS/);
});

test('the reviewer is told the PR is oversize and must answer why it is this big', () => {
  const { home } = host({ author: openai, claude: 'VERDICT: pass', bulkFiles: 41 });
  const input = readFileSync(join(home, 'claude-input.txt'), 'utf8');
  assert.match(input, /Size: OVERSIZE, 42 lines, 42 files outside docs\/verify/);
  assert.match(input, /Why is it this big/);
});

test('a PR within limits gets the size facts without the oversize question', () => {
  const { home } = host({ author: openai, claude: 'VERDICT: pass' });
  const input = readFileSync(join(home, 'claude-input.txt'), 'utf8');
  assert.match(input, /Size: within limits, 1 lines, 1 files outside docs\/verify/);
  assert.doesNotMatch(input, /Size: OVERSIZE/);
});

test('a PASS publishes a success status on the reviewed head, after a pending one', () => {
  const { run, calls, sha } = host({ author: openai, claude: 'VERDICT: pass' });
  assert.equal(run.status, 0, run.stderr);
  const posts = onlyFor(calls, sha);
  assert.match(posts[0].rest, /^-f state=pending -f context=review-gate -f description=Reviewing /);
  assert.equal(
    posts.at(-1).rest,
    `-f state=success -f context=review-gate -f description=PASS for ${sha.slice(0, 8)} -f target_url=${COMMENT_URL}`,
  );
  assert.ok(calls.indexOf('state=pending') < calls.indexOf('bot gh pr comment 2306'));
});

test('a BLOCK publishes a failure status on the reviewed head', () => {
  const { calls, sha } = host({
    author: openai,
    claude: '1. blocking: feature.txt:1 bad\nVERDICT: block',
  });
  assert.match(
    onlyFor(calls, sha).at(-1).rest,
    new RegExp(`^-f state=failure -f context=review-gate .* -f target_url=${COMMENT_URL}$`),
  );
});

test('a carried-over PASS publishes success on the new head only', () => {
  const from = 'b'.repeat(40);
  const { calls, sha } = host({
    author: openai,
    comments: ({ patch }) => [verdictComment(from, 'PASS', patch)],
  });
  assert.match(calls, /PASS\*\* \(carried over\)/);
  assert.doesNotMatch(calls, /^claude /m);
  assert.equal(
    onlyFor(calls, sha).at(-1).rest,
    `-f state=success -f context=review-gate -f description=PASS (carried over from bbbbbbbb) -f target_url=${COMMENT_URL}`,
  );
});

test('a failed status keeps the comment and is retried on the next round', () => {
  const first = host({ author: openai, claude: 'VERDICT: pass', failStatus: true });
  assert.equal(first.run.status, 0, first.run.stderr);
  assert.match(first.calls, /Independent review gate: PASS/);
  assert.match(first.run.stdout, /review-gate status success failed; retrying next round/);
  const posted = [verdictComment(first.sha, 'PASS', first.patch)];
  const retry = first.next(posted);
  assert.equal(retry.run.status, 0, retry.run.stderr);
  assert.doesNotMatch(retry.calls, /pr comment|^claude /m);
  assert.equal(
    onlyFor(retry.calls, first.sha).at(-1).rest,
    `-f state=success -f context=review-gate -f description=PASS for ${first.sha.slice(0, 8)} -f target_url=${COMMENT_URL}`,
  );
  assert.deepEqual(statusPosts(first.next(posted).calls), []);
});

test('a BLOCK that is already commented still gets its failure status', () => {
  const first = host({ author: anthropic });
  const retry = first.next([verdictComment(first.sha, 'BLOCK', first.patch)]);
  assert.doesNotMatch(retry.calls, /ai-route/);
  assert.match(onlyFor(retry.calls, first.sha).at(-1).rest, /^-f state=failure /);
});

test('a verdict comment from anyone but the gate never yields a status or skips review', () => {
  const { calls } = host({
    author: anthropic,
    comments: ({ sha, patch }) => [
      { ...verdictComment(sha, 'PASS', patch), author: { login: 'mallory' } },
      { ...verdictComment('b'.repeat(40), 'PASS', patch), author: { login: 'mallory' } },
    ],
  });
  assert.match(calls, /ai-route anthropic/);
  assert.doesNotMatch(calls, /carried over|state=success/);
});

test('a head that moved after listing is not reviewed and gets no status', () => {
  const { run, calls } = host({ author: openai, claude: 'VERDICT: pass', staleHead: true });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(calls, /^claude /m);
  assert.deepEqual(statusPosts(calls), []);
});

test('the stall alert keeps the head pending and links the alert', () => {
  const { calls, sha } = host({ author: anthropic, priorNoVerdictMs: 2 * 3600_000 });
  const posts = onlyFor(calls, sha);
  assert.ok(posts.every((post) => post.rest.startsWith('-f state=pending ')));
  assert.ok(posts.at(-1).rest.endsWith(`-f target_url=${COMMENT_URL}`));
  assert.match(posts.at(-1).rest, /description=No verdict for over an hour/);
});

const blockComment = (sha, review) => ({
  author: GATE,
  url: COMMENT_URL,
  body: `<!-- review-gate:${sha} -->\n**Independent review gate: BLOCK** for \`${sha.slice(0, 8)}\`.\n\n${review}\n<!-- review-gate-patch:p -->`,
});
const tenLines = (over = {}) =>
  `${Array.from({ length: 10 }, (_, k) => over[k + 1] ?? `line ${k + 1}`).join('\n')}\n`;
const mergedMain =
  ({ mergeChanges, after } = {}) =>
  ({ commit, onMain, merge, patchOf }) => {
    onMain({ 'shared.txt': tenLines() }, 'shared');
    merge();
    const old = commit({ 'shared.txt': tenLines({ 6: 'six from the PR' }) }, 'pr change');
    const oldPatch = patchOf(old);
    onMain({ 'shared.txt': tenLines({ 4: 'four from main' }) }, 'main moved');
    merge(mergeChanges);
    if (after) commit(after, 'after the merge');
    return { old, oldPatch };
  };

test('a head that only merged main carries over the PASS even when the patch id moved', () => {
  const { calls, sha, old, oldPatch, patch } = host({
    author: anthropic,
    setup: mergedMain(),
    comments: ({ old, oldPatch }) => [verdictComment(old, 'PASS', oldPatch)],
  });
  assert.notEqual(patch, oldPatch);
  assert.doesNotMatch(calls, /ai-route/);
  assert.match(
    calls,
    new RegExp(
      `<!-- review-gate:${sha} -->\\n\\*\\*Independent review gate: PASS\\*\\* \\(carried over\\) for \`${sha.slice(0, 8)}\`: the reviewed head \`${old.slice(0, 8)}\` only merged main`,
    ),
  );
  assert.equal(
    onlyFor(calls, sha).at(-1).rest,
    `-f state=success -f context=review-gate -f description=PASS (carried over from ${old.slice(0, 8)}) -f target_url=${COMMENT_URL}`,
  );
});

test('a BLOCK is never carried over to a head that only merged main', () => {
  const { calls } = host({
    author: anthropic,
    setup: mergedMain(),
    comments: ({ old, oldPatch }) => [verdictComment(old, 'BLOCK', oldPatch)],
  });
  assert.match(calls, /ai-route anthropic/);
  assert.doesNotMatch(calls, /carried over/);
});

test('a merge that edits the PR, or a commit after the merge, is reviewed again', () => {
  for (const variant of [
    { mergeChanges: { 'shared.txt': tenLines({ 4: 'four from main', 6: 'six from the merge' }) } },
    { mergeChanges: { 'smuggled.txt': 'x\n' } },
    { after: { 'other.txt': 'x\n' } },
  ]) {
    const { calls } = host({
      author: anthropic,
      setup: mergedMain(variant),
      comments: ({ old, oldPatch }) => [verdictComment(old, 'PASS', oldPatch)],
    });
    assert.match(calls, /ai-route anthropic/, JSON.stringify(variant));
    assert.doesNotMatch(calls, /carried over/, JSON.stringify(variant));
  }
});

test('a new head after a BLOCK is judged on its changes since the blocked head', () => {
  const { home, old } = host({
    author: openai,
    claude: 'VERDICT: pass',
    setup: ({ commit }) => {
      const old = commit({ 'feature.txt': 'change\n' }, 'change');
      commit({ 'second file [x]*.txt': 'fix\n', 'naïve.txt': 'also\n' }, 'fix');
      return { old };
    },
    comments: ({ old }) => [blockComment(old, '1. blocking: feature.txt:1 wrong')],
  });
  const prompt = readFileSync(join(home, 'ai-route-prompt.txt'), 'utf8');
  assert.match(prompt, /1\. blocking: feature\.txt:1 wrong/);
  assert.match(prompt, /"still unfixed"/);
  assert.match(prompt, /read `\.git\/review-gate-2306-since\.diff`/);
  assert.equal(
    git(join(home, 'lanes/cairn'), 'rev-parse', 'review-gate-2306-reviewed').trim(),
    old,
  );
  const sinceFile = readFileSync(
    join(home, 'lanes/cairn/.git/review-gate-2306-since.diff'),
    'utf8',
  );
  assert.match(sinceFile, /second file \[x\]\*\.txt/);
  assert.match(sinceFile, /^\+fix$/m);
  assert.match(sinceFile, /^\+also$/m);
  assert.doesNotMatch(sinceFile, /^\+change$/m);
  const input = readFileSync(join(home, 'claude-input.txt'), 'utf8');
  const since = input.slice(input.lastIndexOf(`Changes since \`${old.slice(0, 8)}\` in this PR`));
  assert.match(since, /^\+fix$/m);
  assert.doesNotMatch(since, /^\+change$/m);
  assert.match(input.slice(0, input.length - since.length), /^\+change$/m);
});

test('earlier findings still reach the reviewer when the blocked head is gone', () => {
  const { home } = host({
    author: anthropic,
    comments: () => [blockComment('e'.repeat(40), '1. blocking: feature.txt:1 wrong')],
  });
  const prompt = readFileSync(join(home, 'ai-route-prompt.txt'), 'utf8');
  assert.match(prompt, /feature\.txt:1 wrong/);
  assert.match(prompt, /review the full diff/);
  assert.doesNotMatch(prompt, /review-gate-2306-reviewed/);
});

const threeBlocks = ['1', '2', '3'].map((c) => blockComment(c.repeat(40), `${c}. blocking: x`));
const humanNote = (sha) => ({
  author: GATE,
  url: COMMENT_URL,
  body: `<!-- review-gate-human:${sha} -->\nnote`,
});

test('three BLOCK rounds stop the reviews and hand the PR to a human', () => {
  const { calls, sha } = host({ author: anthropic, comments: () => threeBlocks });
  assert.doesNotMatch(calls, /ai-route/);
  assert.match(calls, /bot gh pr edit 2306 -R xiechimon\/cairn --add-label review-gate-human/);
  assert.equal(calls.match(/bot gh pr comment 2306/g)?.length, 1);
  assert.match(calls, new RegExp(`<!-- review-gate-human:${sha} -->`));
  assert.match(calls, /needs a human after 3 BLOCK rounds/);
  assert.equal(
    onlyFor(calls, sha).at(-1).rest,
    `-f state=failure -f context=review-gate -f description=3 BLOCK rounds; needs a human -f target_url=${COMMENT_URL}`,
  );
});

test('the review-gate-human label keeps the PR skipped until it is removed', () => {
  const human = [{ name: 'review-gate-human' }];
  const held = host({
    author: anthropic,
    labels: human,
    comments: ({ sha }) => [...threeBlocks, humanNote(sha)],
  });
  assert.doesNotMatch(held.calls, /ai-route|pr comment|add-label/);
  assert.match(onlyFor(held.calls, held.sha).at(-1).rest, /^-f state=failure .*needs a human/);
  const noted = host({ author: anthropic, labels: human, comments: () => threeBlocks });
  assert.equal(noted.calls.match(/bot gh pr comment 2306/g)?.length, 1);
  assert.doesNotMatch(noted.calls, /ai-route|add-label/);
  const resumed = host({
    author: anthropic,
    comments: ({ sha }) => [...threeBlocks, humanNote(sha)],
  });
  assert.match(resumed.calls, /ai-route anthropic/);
  assert.doesNotMatch(resumed.calls, /review-gate-human/);
});

test('a failed review-gate-human label is retried before the comment is posted', () => {
  const { run, calls } = host({ author: anthropic, failLabel: true, comments: () => threeBlocks });
  assert.equal(run.status, 0, run.stderr);
  assert.match(calls, /--add-label review-gate-human/);
  assert.doesNotMatch(calls, /pr comment|ai-route/);
  assert.match(run.stdout, /review-gate-human label failed; retrying next round/);
});

test('a PR of only docs, tests and locale strings passes as the low-risk tier', () => {
  const { calls, sha } = host({
    author: anthropic,
    setup: ({ commit }) => {
      commit(
        {
          'docs/guide.md': 'x\n',
          'apps/web/test/a.test.ts': 'x\n',
          'apps/web/src/locales/zh/app.json': '{}\n',
        },
        'docs',
      );
    },
  });
  assert.doesNotMatch(calls, /ai-route/);
  assert.match(
    calls,
    new RegExp(
      `<!-- review-gate:${sha} -->\\n\\*\\*Independent review gate: PASS\\*\\* for \`${sha.slice(0, 8)}\` \\(low-risk tier\\)`,
    ),
  );
  assert.equal(
    onlyFor(calls, sha).at(-1).rest,
    `-f state=success -f context=review-gate -f description=PASS (low-risk tier) -f target_url=${COMMENT_URL}`,
  );
});

test('a PR that was blocked before never leaves through the low-risk tier', () => {
  const { calls } = host({
    author: anthropic,
    setup: ({ commit }) => {
      commit({ 'apps/web/test/a.test.ts': 'weakened\n' }, 'tests only');
    },
    comments: () => [blockComment('1'.repeat(40), '1. blocking: a.test.ts:1 weakened')],
  });
  assert.match(calls, /ai-route anthropic/);
  assert.doesNotMatch(calls, /low-risk tier/);
});

test('a protected doc, a file the PR list missed or a deleted test is still reviewed', () => {
  for (const setup of [
    ({ commit }) => {
      commit({ 'docs/adr/0001-x.md': 'x\n' }, 'adr');
    },
    ({ commit }) => {
      commit({ 'docs/guide.md': 'x\n', 'feature.txt': 'x\n' }, 'mixed');
    },
    ({ commit, onMain, merge }) => {
      onMain({ 'apps/web/test/old.test.ts': 'x\n' }, 'add test');
      merge();
      commit({ 'apps/web/test/old.test.ts': null }, 'drop test');
    },
  ]) {
    const { calls } = host({ author: anthropic, files: [{ path: 'docs/guide.md' }], setup });
    assert.match(calls, /ai-route anthropic/);
    assert.doesNotMatch(calls, /low-risk tier/);
  }
});
