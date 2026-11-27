import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { parse } from 'yaml';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const workflow = parse(
  readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8'),
);

const rel = (tag_name, draft = false, prerelease = false) => ({ tag_name, draft, prerelease });
const releases = (...entries) => JSON.stringify(entries);
const filler = (count) => Array.from({ length: count }, (_, i) => rel(`web-v${i}`));
const pageOf = (url) => Number(/[?&]page=(\d+)/.exec(url)[1]);

test('the decide step releases only a green changed untagged tip; every event follows the same rule', (t) => {
  const script = workflow.jobs.decide.steps.find((step) => step.id === 'decision').run;
  const root = makeTestTempDir('desktop-release-');
  t.after(() => releaseTestTempDir(root));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '--quiet');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.com');
  mkdirSync(join(root, 'apps/desktop/test'), { recursive: true });
  writeFileSync(join(root, 'apps/desktop/main.js'), 'initial source');
  git('add', 'apps/desktop/main.js');
  git('commit', '--quiet', '-m', 'Initial source');
  symlinkSync(import.meta.dirname, join(root, 'scripts'), 'dir');

  const bin = join(root, 'bin');
  mkdirSync(bin);
  const callsFile = join(root, 'gh-calls');
  const output = join(root, 'output');
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$GH_CALLS"',
      'if [ "$1" = "api" ]; then',
      '  case "$2" in',
      '    *"releases?per_page=100&page=1") printf \'%s\\n\' "$RELEASES_PAGE1"; exit 0 ;;',
      '    *"releases?per_page=100&page=2") printf \'%s\\n\' "$RELEASES_PAGE2"; exit 0 ;;',
      '    *"releases?per_page=100&page="*) printf \'[]\\n\'; exit 0 ;;',
      '    *page=2*|*page=3*) printf \'%s\\n\' "$EMPTY_PAGE"; exit 0 ;;',
      '    *attempts/*/jobs*) printf \'%s\\n\' "$JOBS_PAGE"; exit 0 ;;',
      '    *workflows/ci.yml/runs*)',
      '      if [ -n "$OLDER_SHA" ] && echo "$2" | grep -q "head_sha=$OLDER_SHA"; then printf \'%s\\n\' "$OLDER_RUNS"; else printf \'%s\\n\' "$RUNS_PAGE"; fi; exit 0 ;;',
      '    *actions/runs/8) printf \'%s\\n\' "$OLDER_READ"; exit 0 ;;',
      '    *matching-refs*) printf \'%s\\n\' "$TAGS_READ"; exit 0 ;;',
      "    *releases*) printf '[]\\n'; exit 0 ;;",
      '    *actions/runs/*) printf \'%s\\n\' "$RUN_READ"; exit 0 ;;',
      '  esac',
      'fi',
      'printf \'stub gh: unexpected %s\\n\' "$*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const head = () => git('rev-parse', 'HEAD').trim();
  const tagRef = (tag, sha) => ({
    ref: `refs/tags/${tag}`,
    object: { sha, type: 'commit' },
  });
  const ciRun = (sha, over = {}) => ({
    id: 7,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: sha,
    event: 'push',
    head_branch: 'main',
    ...over,
  });
  const decide = (expected, { tags = '[]', ci, page1 = '[]', page2 = '[]', env = {} } = {}) => {
    writeFileSync(output, '');
    writeFileSync(callsFile, '');
    const sha = head();
    const run = ci === undefined ? ciRun(sha) : ci;
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_SHA: sha,
        GATE_REPO: 'o/r',
        GH_TOKEN: 'fixture-token',
        GITHUB_OUTPUT: output,
        GH_CALLS: callsFile,
        TAGS_READ: tags,
        RUNS_PAGE: JSON.stringify({ workflow_runs: run === null ? [] : [run] }),
        RUN_READ: JSON.stringify(run ?? {}),
        JOBS_PAGE: JSON.stringify({ jobs: greenJobs() }),
        EMPTY_PAGE: JSON.stringify({ jobs: [], workflow_runs: [] }),
        RELEASES_PAGE1: page1,
        RELEASES_PAGE2: page2,
        ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, 'utf8'), new RegExp(`^release=${expected}$`, 'm'));
    return readFileSync(callsFile, 'utf8');
  };

  let calls = decide(true);
  assert.match(calls, /workflows\/ci\.yml\/runs\?head_sha=/);

  const releasedSha = head();
  git('tag', 'desktop-v0.1.1');
  const tagsOnReleased = JSON.stringify([tagRef('desktop-v0.1.1', releasedSha)]);
  calls = decide(false, { tags: tagsOnReleased, page1: releases(rel('desktop-v0.1.1')) });
  assert.doesNotMatch(calls, /workflows\/ci\.yml/);
  assert.match(calls, /matching-refs|releases\?per_page/, 'the plan reads tags and releases');

  writeFileSync(join(root, 'apps/desktop/README.md'), 'Documentation only');
  writeFileSync(join(root, 'apps/desktop/test/main.test.js'), 'Test only');
  git('add', 'apps/desktop/README.md', 'apps/desktop/test/main.test.js');
  git('commit', '--quiet', '-m', 'Non-shipped changes');
  const baseline1 = releases(rel('desktop-v0.1.1'));
  decide(false, { tags: tagsOnReleased, page1: baseline1 });
  decide(false, {
    tags: tagsOnReleased,
    page1: baseline1,
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch' },
  });
  decide(false, { tags: tagsOnReleased, page1: releases(...filler(100)), page2: baseline1 });
  decide(false, {
    tags: tagsOnReleased,
    page1: releases(
      rel('desktop-v9.9.9', true),
      rel('desktop-v9.9.8', false, true),
      rel('desktop-v0.1.1'),
    ),
  });

  writeFileSync(join(root, 'apps/desktop/main.js'), 'updated source');
  git('add', 'apps/desktop/main.js');
  git('commit', '--quiet', '-m', 'Shipped source change');
  decide(true, { tags: tagsOnReleased, page1: baseline1 });
  decide(true, {
    tags: tagsOnReleased,
    page1: baseline1,
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch' },
  });

  decide(true, {
    tags: tagsOnReleased,
    page1: releases(
      rel('desktop-v0.1.2', true),
      rel('desktop-v0.1.3', true),
      rel('desktop-v0.1.1'),
    ),
  });
  assert.match(
    readFileSync(output, 'utf8'),
    /^version=0\.1\.4$/m,
    'drafts holding the next two names are skipped before packaging picks the version',
  );

  decide(true, {
    tags: tagsOnReleased,
    page1: releases(
      ...Array.from({ length: 9 }, (_, i) => rel(`desktop-v0.1.${i + 2}`, true)),
      rel('desktop-v0.1.1'),
    ),
  });
  assert.match(
    readFileSync(output, 'utf8'),
    /^version=0\.1\.11$/m,
    'nine leftover drafts occupying consecutive names never cap the pick',
  );

  const midSha = head();
  git('tag', 'desktop-v0.1.2');
  const tagsOnMid = JSON.stringify([
    tagRef('desktop-v0.1.1', releasedSha),
    tagRef('desktop-v0.1.2', midSha),
  ]);
  const baseline2 = releases(rel('desktop-v0.1.2'), rel('desktop-v0.1.1'));

  mkdirSync(join(root, 'apps/tsnet-sidecar'), { recursive: true });
  writeFileSync(join(root, 'apps/tsnet-sidecar/main.go'), 'package main\n');
  git('add', 'apps/tsnet-sidecar/main.go');
  git('commit', '--quiet', '-m', 'Sidecar source change');
  decide(true, { tags: tagsOnMid, page1: baseline2 });

  decide(true, {
    tags: tagsOnMid,
    page1: releases(rel('desktop-v9.9.9', true), rel('desktop-v0.1.2'), rel('desktop-v0.1.1')),
  });
  assert.match(
    readFileSync(output, 'utf8'),
    /^version=0\.1\.3$/m,
    'a draft only reserves its own name; it never raises the base version',
  );

  decide(false, {
    tags: tagsOnMid,
    page1: baseline2,
    ci: ciRun(head(), { status: 'in_progress', conclusion: null }),
  });
  decide(false, {
    tags: tagsOnMid,
    page1: baseline2,
    ci: ciRun(head(), { conclusion: 'failure' }),
  });
  decide(false, { tags: tagsOnMid, page1: baseline2, ci: null });

  const olderGreen = head();
  git('commit', '--quiet', '--allow-empty', '-m', 'Tip CI still running: run 45409074612');
  for (const status of ['in_progress', 'queued', 'completed']) {
    const older = ciRun(olderGreen, { id: 8 });
    decide(true, {
      tags: tagsOnMid,
      page1: baseline2,
      ci: ciRun(head(), { status, conclusion: status === 'completed' ? 'failure' : null }),
      env: {
        OLDER_SHA: olderGreen,
        OLDER_RUNS: JSON.stringify({ workflow_runs: [older] }),
        OLDER_READ: JSON.stringify(older),
      },
    });
    assert.match(readFileSync(output, 'utf8'), new RegExp(`^sha=${olderGreen}$`, 'm'));
  }

  const baselineCi = ciRun(midSha, { id: 8 });
  const bounded = decide(false, {
    tags: tagsOnMid,
    page1: baseline2,
    ci: ciRun(head(), { status: 'in_progress', conclusion: null }),
    env: {
      OLDER_SHA: midSha,
      OLDER_RUNS: JSON.stringify({ workflow_runs: [baselineCi] }),
      OLDER_READ: JSON.stringify(baselineCi),
    },
  });
  assert.doesNotMatch(bounded, new RegExp(`head_sha=${midSha}`));

  git('tag', 'desktop-v0.1.3');
  decide(true, {
    tags: JSON.stringify([
      tagRef('desktop-v0.1.1', releasedSha),
      tagRef('desktop-v0.1.2', midSha),
      tagRef('desktop-v0.1.3', head()),
    ]),
    page1: releases(rel('desktop-v0.1.3', true), rel('desktop-v0.1.2'), rel('desktop-v0.1.1')),
  });
  assert.match(
    readFileSync(output, 'utf8'),
    /^version=0\.1\.4$/m,
    'a draft on the tip is skipped past by version, not resumed',
  );

  const taggedSha = head();
  git('tag', 'desktop-v0.1.4');
  const v14Baseline = releases(rel('desktop-v0.1.4'), rel('desktop-v0.1.2'), rel('desktop-v0.1.1'));
  writeFileSync(join(root, 'apps/desktop/README.md'), 'More documentation');
  git('add', 'apps/desktop/README.md');
  git('commit', '--quiet', '-m', 'Docs only under an orphan tag');
  git('tag', 'desktop-v0.1.5');
  const docsSha = head();
  decide(false, {
    tags: JSON.stringify([
      tagRef('desktop-v0.1.1', releasedSha),
      tagRef('desktop-v0.1.2', midSha),
      tagRef('desktop-v0.1.3', taggedSha),
      tagRef('desktop-v0.1.4', taggedSha),
      tagRef('desktop-v0.1.5', docsSha),
    ]),
    page1: v14Baseline,
  });

  writeFileSync(join(root, 'apps/desktop/main.js'), 'final source');
  git('add', 'apps/desktop/main.js');
  git('commit', '--quiet', '-m', 'Shipped source under a prerelease tag');
  const preSha = head();
  git('tag', 'desktop-v0.1.9');
  decide(true, {
    tags: JSON.stringify([
      tagRef('desktop-v0.1.1', releasedSha),
      tagRef('desktop-v0.1.2', midSha),
      tagRef('desktop-v0.1.3', taggedSha),
      tagRef('desktop-v0.1.4', taggedSha),
      tagRef('desktop-v0.1.5', docsSha),
      tagRef('desktop-v0.1.9', preSha),
    ]),
    page1: releases(
      rel('desktop-v0.1.9', false, true),
      rel('desktop-v0.1.4'),
      rel('desktop-v0.1.2'),
      rel('desktop-v0.1.1'),
    ),
  });
  assert.match(
    readFileSync(output, 'utf8'),
    /^version=0\.1\.10$/m,
    'a prerelease on the tip allocates a fresh version above it',
  );
});

test('the decide step diffs shipped sources against the paginated stable-release baseline', async () => {
  const step = workflow.jobs.decide.steps.find((entry) => entry.id === 'decision');
  assert.match(step.run, /scripts\/ops\/release-decide\.mjs "\$RELEASE_SHA" >> "\$GITHUB_OUTPUT"/);
  const { shippedSourcesChanged } = await import('./ops/release-decide.mjs');
  const calls = [];
  const outcome = shippedSourcesChanged({
    lastTag: 'desktop-v0.1.1',
    sha: 'a'.repeat(40),
    git(args) {
      calls.push(args.join(' '));
      return 'apps/desktop/main.js\n';
    },
  });
  assert.equal(outcome.changed, true);
  assert.match(calls[0], /^diff --name-only desktop-v0\.1\.1 a{40} -- /);
  assert.match(calls[0], /apps\/desktop/);
  assert.match(calls[0], /apps\/tsnet-sidecar/);
  assert.match(calls[0], /exclude[^ ]*test/);
  const first = shippedSourcesChanged({
    lastTag: null,
    sha: 'a'.repeat(40),
    git() {
      throw new Error('no baseline means no diff');
    },
  });
  assert.equal(first.changed, true);
});

test('the migration smoke downloads the previous release through the same query', () => {
  const step = workflow.jobs['verify-arm64-post-install'].steps.find(
    (entry) => entry.name === 'Download the previous release for the migration smoke',
  );
  assert.ok(step);
  assert.match(step.run, /scripts\/ops\/last-desktop-release\.mjs/);
  assert.doesNotMatch(step.run, /gh release list|--limit/);
});

test('the baseline script reads every page and returns the highest stable desktop tag', async () => {
  const { fetchLastDesktopRelease } = await import('./ops/last-desktop-release.mjs');
  const calls = [];
  const tag = fetchLastDesktopRelease({
    repo: 'o/r',
    gh(args) {
      calls.push(args[1]);
      if (pageOf(args[1]) === 2) {
        return JSON.stringify([rel('desktop-v0.1.9'), rel('desktop-v0.1.8')]);
      }
      if (pageOf(args[1]) === 1) {
        return JSON.stringify([...filler(99), rel('desktop-v9.9.9', false, true)]);
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(tag, 'desktop-v0.1.9');
  assert.ok(calls.some((url) => pageOf(url) === 2));
});

test('the baseline script picks the highest-version stable release, never list order', async () => {
  const { fetchLastDesktopRelease } = await import('./ops/last-desktop-release.mjs');
  const tag = fetchLastDesktopRelease({
    repo: 'o/r',
    gh(args) {
      if (pageOf(args[1]) === 1) {
        return JSON.stringify([rel('desktop-v0.1.700'), rel('desktop-v0.1.702')]);
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(
    tag,
    'desktop-v0.1.702',
    'a backfilled older release listed first does not lower the baseline',
  );
});

test('the baseline script ignores drafts and prereleases whatever their version', async () => {
  const { fetchLastDesktopRelease } = await import('./ops/last-desktop-release.mjs');
  const calls = [];
  const tag = fetchLastDesktopRelease({
    repo: 'o/r',
    gh(args) {
      calls.push(args[1]);
      if (pageOf(args[1]) === 1) {
        return JSON.stringify([
          rel('desktop-v0.2.0', false, true),
          rel('desktop-v0.1.9'),
          rel('desktop-v0.1.10', true),
        ]);
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(tag, 'desktop-v0.1.9');
  assert.equal(calls.length, 2, 'the read pages until an empty page');
});

test('the baseline script reports no match only when the API returns an empty page', async () => {
  const { fetchLastDesktopRelease } = await import('./ops/last-desktop-release.mjs');
  const calls = [];
  const tag = fetchLastDesktopRelease({
    repo: 'o/r',
    gh(args) {
      calls.push(args[1]);
      if (pageOf(args[1]) === 1) {
        return JSON.stringify([rel('desktop-v0.2.0', true), rel('web-v1')]);
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(tag, null);
  assert.deepEqual(calls.length, 2);
});

test('the flip marks latest only when the version is above the highest existing release', async () => {
  const { versionAboveLatest } = await import('./ops/release-version.mjs');
  assert.equal(
    versionAboveLatest({ version: '0.1.703', highestTag: 'desktop-v0.1.702' }).above,
    true,
  );
  assert.equal(
    versionAboveLatest({ version: '0.1.701', highestTag: 'desktop-v0.1.702' }).above,
    false,
  );
  assert.equal(
    versionAboveLatest({ version: '0.1.702', highestTag: 'desktop-v0.1.702' }).above,
    false,
  );
  assert.match(
    versionAboveLatest({ version: '0.1.702', highestTag: 'desktop-v0.1.702' }).reason,
    /aborts/,
    'a superseded version aborts the publish rather than publishing without latest',
  );
  assert.equal(versionAboveLatest({ version: '0.1.1', highestTag: null }).above, true);
  assert.equal(versionAboveLatest({ version: 'x.y', highestTag: 'desktop-v0.1.1' }).above, false);
});

test('the latest decision reads the highest desktop-v release, not the first listed', async () => {
  const { fetchHighestDesktopRelease } = await import('./ops/last-desktop-release.mjs');
  const calls = [];
  const tag = fetchHighestDesktopRelease({
    repo: 'o/r',
    exclude: 'desktop-v0.1.701',
    gh(args) {
      calls.push(args[1]);
      if (pageOf(args[1]) === 1) {
        return JSON.stringify([rel('desktop-v0.1.700'), rel('desktop-v0.1.702')]);
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(tag, 'desktop-v0.1.702', 'a backfill listed first does not lower the bar');
});

test('the latest decision ignores drafts and prereleases and skips only the decided tag', async () => {
  const { fetchHighestDesktopRelease } = await import('./ops/last-desktop-release.mjs');
  const tag = fetchHighestDesktopRelease({
    repo: 'o/r',
    exclude: 'desktop-v0.1.701',
    gh(args) {
      if (pageOf(args[1]) === 1) {
        return JSON.stringify([
          rel('desktop-v0.1.701', true),
          rel('desktop-v0.1.700'),
          rel('desktop-v0.1.702', false, true),
        ]);
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(
    tag,
    'desktop-v0.1.700',
    'a draft or prerelease never raises the bar; only stable releases count',
  );
  const none = fetchHighestDesktopRelease({
    repo: 'o/r',
    exclude: 'desktop-v0.1.701',
    gh(args) {
      if (pageOf(args[1]) === 1) {
        return JSON.stringify([
          rel('desktop-v0.1.701', true),
          rel('web-v9.9.9'),
          rel('desktop-vbeta'),
        ]);
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(none, null, 'the skipped draft and non-version tags leave the field empty');
});

test('the baseline script keeps paging past ten full pages without a cap', async () => {
  const { fetchLastDesktopRelease } = await import('./ops/last-desktop-release.mjs');
  const calls = [];
  const tag = fetchLastDesktopRelease({
    repo: 'o/r',
    gh(args) {
      calls.push(args[1]);
      if (pageOf(args[1]) === 11) return JSON.stringify([rel('desktop-v0.3.1')]);
      if (pageOf(args[1]) > 11) return JSON.stringify([]);
      return JSON.stringify(filler(100));
    },
  });
  assert.equal(tag, 'desktop-v0.3.1');
  assert.equal(calls.length, 12);
});

const repoRoot = resolve(import.meta.dirname, '..');
const publishScript = workflow.jobs.publish.steps.find(
  (entry) => entry.name === 'Publish the release',
).run;

const greenCi = (sha) => ({
  id: 7,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  head_sha: sha,
  event: 'push',
  head_branch: 'main',
});
const greenJobs = () => [
  { name: 'check', conclusion: 'success' },
  { name: 'pack-smoke', conclusion: 'success' },
  { name: 'e2e-gate', conclusion: 'success' },
];

const publishFixture = (t) => {
  assert.doesNotMatch(publishScript, /\$\{\{/);
  const root = makeTestTempDir('desktop-publish-');
  t.after(() => releaseTestTempDir(root));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const remote = join(root, 'remote.git');
  git('init', '--bare', '--quiet', remote);
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.com');
  git('remote', 'add', 'origin', remote);
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/build.yml'), 'initial workflow');
  git('add', '.github/workflows/build.yml');
  git('commit', '--quiet', '-m', 'Built commit');
  const built = git('rev-parse', 'HEAD');
  writeFileSync(join(root, '.github/workflows/build.yml'), 'newer workflow');
  git('add', '.github/workflows/build.yml');
  git('commit', '--quiet', '-m', 'Main advances during build');
  git('push', '--quiet', 'origin', 'main');
  const tip = git('rev-parse', 'HEAD');

  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$GH_CALLS"',
      'state=$(cat "$RELEASE_STATE" 2>/dev/null || printf \'none\')',
      'if git --git-dir="$TAG_REMOTE" rev-parse --verify --quiet "refs/tags/desktop-v$VERSION" >/dev/null 2>&1; then',
      '  printf \'tag=yes\\n\' >> "$TAG_LOG"',
      'else',
      '  printf \'tag=no\\n\' >> "$TAG_LOG"',
      'fi',
      'release_id() {',
      '  seg=${1#*releases/}',
      '  seg=${seg%%[/?]*}',
      '  case "$seg" in',
      "    ''|*[!0-9]*) return 1 ;;",
      '  esac',
      '  printf \'%s\' "$seg"',
      '}',
      'if [ "$1" = "release" ]; then',
      '  printf \'stub gh: unexpected release call %s\\n\' "$*" >&2',
      '  exit 1',
      'fi',
      'if [ "$1" = "api" ]; then',
      '  shift',
      '  url=""',
      '  tag_name=""',
      '  target=""',
      '  for arg in "$@"; do',
      '    case "$arg" in',
      '      repos/*|https://*) url=$arg ;;',
      '      tag_name=*) tag_name=${arg#tag_name=} ;;',
      '      target_commitish=*) target=${arg#target_commitish=} ;;',
      '    esac',
      '  done',
      '  case "$*" in',
      '    *"-X PATCH"*)',
      '      id=$(release_id "$url") || exit 1',
      '      [ "$id" = "$(cat "$RELEASE_ID" 2>/dev/null)" ] || exit 1',
      '      [ "$state" = "draft" ] || exit 1',
      '      case "$*" in *"-F draft=false"*) ;; *) exit 1 ;; esac',
      '      case "$*" in *"make_latest=true"*) ;; *) exit 1 ;; esac',
      '      [ -z "$tag_name" ] || printf \'%s\' "$tag_name" > "$RELEASE_TAG"',
      '      [ -z "$target" ] || printf \'%s\' "$target" > "$RELEASE_TARGET"',
      '      printf \'public\' > "$RELEASE_STATE"',
      '      git --git-dir="$TAG_REMOTE" tag "$(cat "$RELEASE_TAG")" "$(cat "$RELEASE_TARGET")" || exit 1',
      '      printf \'tag=yes\\n\' >> "$TAG_LOG"',
      '      printf \'{\\"id\\":%s,"draft":false}\\n\' "$id"',
      '      exit 0 ;;',
      '    *"-X POST"*)',
      '      case "$url" in',
      '        */releases/[0-9]*/assets*)',
      '          id=$(release_id "$url") || exit 1',
      '          [ "$id" = "$(cat "$RELEASE_ID" 2>/dev/null)" ] || exit 1',
      '          [ "$state" = "draft" ] || exit 1',
      '          [ -z "$RETARGET_SHA" ] || printf \'%s\' "$RETARGET_SHA" > "$RELEASE_TARGET"',
      '          [ -z "$RETARGET_TAG" ] || printf \'%s\' "$RETARGET_TAG" > "$RELEASE_TAG"',
      '          printf \'{\\"id\\":1,"state":"uploaded"}\\n\'',
      '          exit 0 ;;',
      '        */releases)',
      '          [ "$state" = "none" ] || exit 1',
      '          [ -z "$CREATE_FAIL" ] || exit 1',
      '          case "$*" in *"-F draft=true"*) ;; *) exit 1 ;; esac',
      '          [ -n "$tag_name" ] && [ -n "$target" ] || exit 1',
      '          if [ -f "$DRAFTS_FILE" ] && cut -f2 "$DRAFTS_FILE" | grep -Fqx "$tag_name"; then',
      "            printf 'gh: tag_name is held by an existing draft\\n' >&2",
      '            exit 1',
      '          fi',
      '          id_out=123',
      '          [ -z "$BAD_ID" ] || id_out=RE_abc123',
      '          printf \'%s\' "$id_out" > "$RELEASE_ID"',
      '          printf \'%s\' "$tag_name" > "$RELEASE_TAG"',
      '          printf \'%s\' "$target" > "$RELEASE_TARGET"',
      '          printf \'draft\' > "$RELEASE_STATE"',
      '          case "$*" in',
      '            *"--jq .id"*) printf \'%s\\n\' "$id_out" ;;',
      '            *) printf \'{\\"id\\":\\"%s\\","draft":true}\\n\' "$id_out" ;;',
      '          esac',
      '          exit 0 ;;',
      '      esac',
      '      exit 1 ;;',
      '  esac',
      '  case "$url" in',
      '    *git/ref/tags/*)',
      '      ref=${url##*git/ref/tags/}',
      '      sha=$(git --git-dir="$TAG_REMOTE" rev-parse --verify --quiet "refs/tags/$ref") || {',
      "        printf 'gh: Not Found (HTTP 404)\\n' >&2",
      '        exit 1',
      '      }',
      '      printf \'{\\"ref\\":\\"refs/tags/%s\\",\\"object\\":{\\"sha\\":\\"%s\\",\\"type\\":\\"commit\\"}}\\n\' "$ref" "$sha"',
      '      exit 0 ;;',
      '    *releases/[0-9]*)',
      '      id=$(release_id "$url") || exit 1',
      '      [ "$id" = "$(cat "$RELEASE_ID" 2>/dev/null)" ] || exit 1',
      '      [ -z "$DRAFT_GONE" ] || { printf \'gh: Not Found\\n\' >&2; exit 1; }',
      '      is_draft=false; [ "$state" = "draft" ] && is_draft=true',
      '      [ -z "$STEAL_PUBLISH" ] || is_draft=false',
      '      case "$*" in',
      '        *--jq*) printf \'%s %s %s\\n\' "$is_draft" "$(cat "$RELEASE_TAG")" "$(cat "$RELEASE_TARGET")" ;;',
      '        *) printf \'{\\"id\\":%s,\\"draft\\":%s,\\"tag_name\\":\\"%s\\",\\"target_commitish\\":\\"%s\\"}\\n\' "$id" "$is_draft" "$(cat "$RELEASE_TAG")" "$(cat "$RELEASE_TARGET")" ;;',
      '      esac',
      '      exit 0 ;;',
      '    *"releases?per_page=100&page=1") printf \'%s\\n\' "$RELEASES_PAGE"; exit 0 ;;',
      '    *"releases?per_page=100&page="*) printf \'[]\\n\'; exit 0 ;;',
      '    *page=2*|*page=3*) printf \'%s\\n\' "$EMPTY_PAGE"; exit 0 ;;',
      '    *matching-refs*) printf \'%s\\n\' "$TAGS_READ"; exit 0 ;;',
      '    *attempts/*/jobs*) printf \'%s\\n\' "$JOBS_PAGE"; exit 0 ;;',
      '    *workflows/ci.yml/runs*) printf \'%s\\n\' "$RUNS_PAGE"; exit 0 ;;',
      '    *actions/runs/*)',
      '      if [ -n "$RUN_READ_LATE" ] && [ -f "$RERUN_ARMED" ]; then',
      '        printf \'%s\\n\' "$RUN_READ_LATE"',
      '      else',
      '        printf \'%s\\n\' "$RUN_READ"',
      '      fi',
      '      exit 0 ;;',
      '    *compare/*) printf \'%s\\n\' "$COMPARE_READ"; exit 0 ;;',
      '    *branches/main*)',
      '      [ -z "$RERUN_ARMED" ] || : > "$RERUN_ARMED"',
      '      printf \'%s\\n\' "$BRANCH_READ"',
      '      exit 0 ;;',
      '  esac',
      '  printf \'stub gh: unexpected api %s\\n\' "$*" >&2',
      '  exit 1',
      'fi',
      'printf \'stub gh: unexpected %s\\n\' "$*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const callsFile = join(root, 'gh-calls');
  const stateFile = join(root, 'release-state');
  const idFile = join(root, 'release-id');
  const tagFile = join(root, 'release-tag');
  const targetFile = join(root, 'release-target');
  const tagLogFile = join(root, 'tag-log');
  const draftsFile = join(root, 'leftover-drafts.tsv');
  const releaseDir = join(root, 'apps/desktop/release');
  mkdirSync(releaseDir, { recursive: true });
  for (const name of ASSETS.slice(0, -1)) writeFileSync(join(releaseDir, name), 'fixture bytes');
  writeFileSync(stateFile, 'none');
  const publish = (over = {}) => {
    writeFileSync(callsFile, '');
    writeFileSync(tagLogFile, '');
    const ci = greenCi(built);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', publishScript], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        RELEASE_SHA: built,
        VERSION: '0.1.2',
        PATH: `${bin}:${process.env.PATH}`,
        GH_CALLS: callsFile,
        RELEASE_STATE: stateFile,
        RELEASE_ID: idFile,
        RELEASE_TAG: tagFile,
        RELEASE_TARGET: targetFile,
        TAG_LOG: tagLogFile,
        DRAFTS_FILE: draftsFile,
        TAG_REMOTE: remote,
        GH_TOKEN: 'fixture-token',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_WORKSPACE: repoRoot,
        RUNS_PAGE: JSON.stringify({ workflow_runs: [ci] }),
        RUN_READ: JSON.stringify(ci),
        JOBS_PAGE: JSON.stringify({ jobs: greenJobs() }),
        EMPTY_PAGE: JSON.stringify({ jobs: [], workflow_runs: [] }),
        BRANCH_READ: JSON.stringify({ commit: { sha: built } }),
        COMPARE_READ: JSON.stringify({
          status: 'ahead',
          merge_base_commit: { sha: git('merge-base', built, tip) },
        }),
        RELEASES_PAGE: '[]',
        TAGS_READ: '[]',
        ...over,
      },
    });
    return {
      result,
      calls: readFileSync(callsFile, 'utf8'),
      state: readFileSync(stateFile, 'utf8'),
      tagLog: readFileSync(tagLogFile, 'utf8').trim().split('\n'),
    };
  };
  return { git, publish, built, tip, stateFile, idFile, draftsFile, releaseDir, root };
};

const callIndex = (calls, pattern) =>
  calls
    .trim()
    .split('\n')
    .findIndex((line) => pattern.test(line));

const ASSETS = [
  'Cairn-0.1.2-mac-arm64.dmg',
  'Cairn-0.1.2-mac-x64.dmg',
  'Cairn-0.1.2-mac-arm64.zip',
  'Cairn-0.1.2-mac-x64.zip',
  'Cairn-0.1.2-win-x64.exe',
  'Cairn-0.1.2-win-x64.zip',
  'Cairn-0.1.2-linux-x64.tar.gz',
  'desktop-latest.json',
];

test('the publish step never creates, pushes or adopts a tag', () => {
  const step = workflow.jobs.publish.steps.find((entry) => entry.name === 'Publish the release');
  assert.equal(step.env.RELEASE_REMOTE, undefined);
  assert.doesNotMatch(publishScript, /git push|ls-remote|RELEASE_REMOTE/);
  assert.doesNotMatch(publishScript, /gh release (create|view|upload|edit|delete|list)/);
  assert.match(publishScript, /git\/ref\/tags\/\$tag/, 'the tag probe reads the git ref endpoint');
  const probes = publishScript.match(/require_free_tag$/gm) ?? [];
  assert.equal(probes.length, 2, 'the tag is probed before the draft and again before the flip');
  assert.match(publishScript, /-X POST "repos\/\$GITHUB_REPOSITORY\/releases"/);
  assert.match(publishScript, /-F draft=true/);
  assert.match(publishScript, /-f tag_name="\$tag"/);
  assert.match(publishScript, /-f target_commitish="\$RELEASE_SHA"/);
  assert.match(publishScript, /--jq \.id/);
  assert.match(
    publishScript,
    /uploads\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/\$release_id\/assets\?name=\$asset/,
  );
  assert.match(publishScript, /-X PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$release_id"/);
  assert.match(publishScript, /-F draft=false/);
  const flip = publishScript.slice(publishScript.indexOf('-X PATCH'));
  assert.doesNotMatch(
    flip,
    /tag_name|target_commitish/,
    'the flip PATCH never resends tag or target; they are verified, not rewritten',
  );
  assert.doesNotMatch(publishScript, /-X DELETE/, 'the step never deletes a release or a tag');
  assert.doesNotMatch(publishScript, /cairn-release-draft/, 'no workflow marker exists to copy');
});

test('the publish step stages a draft by its numeric id, uploads the assets and flips it published', (t) => {
  const { git, publish, built } = publishFixture(t);
  const run = publish();
  assert.equal(run.result.status, 0, run.result.stderr);
  const lines = run.calls.trim().split('\n');
  assert.equal(
    lines.filter((line) => /^release /.test(line)).length,
    0,
    'the step never calls a gh release subcommand',
  );
  const tagProbes = lines.flatMap((line, index) =>
    /^api repos\/o\/r\/git\/ref\/tags\/desktop-v0\.1\.2$/.test(line) ? [index] : [],
  );
  const create = callIndex(run.calls, /^api -X POST repos\/o\/r\/releases /);
  const patch = callIndex(run.calls, /^api -X PATCH repos\/o\/r\/releases\/123 /);
  const uploads = lines.flatMap((line, index) =>
    /^api -X POST https:\/\/uploads\.github\.com\/repos\/o\/r\/releases\/123\/assets/.test(line)
      ? [index]
      : [],
  );
  assert.equal(tagProbes.length, 2, 'the tag is probed before the draft and before the flip');
  assert.ok(tagProbes[0] < create, 'the free-tag probe precedes the draft create');
  assert.match(lines[create], /-F draft=true/);
  assert.match(lines[create], /-f tag_name=desktop-v0\.1\.2/);
  assert.match(lines[create], new RegExp(`-f target_commitish=${built}`));
  const createCall = lines.slice(create, uploads[0]).join('\n');
  assert.match(createCall, /--jq \.id/, 'the numeric REST id is read off the create response');
  assert.deepEqual(
    uploads.map((index) => /name=(\S+)/.exec(lines[index])[1]).sort(),
    [...ASSETS].sort(),
    'every asset lands on the numeric release id',
  );
  assert.ok(
    uploads.every((index) => index > create && index < tagProbes[1]),
    'the uploads happen between the create and the last tag probe',
  );
  const tipRead = callIndex(run.calls, /^api .*branches\/main/);
  const gateRead = callIndex(run.calls, /^api .*workflows\/ci\.yml\/runs/);
  const planRead = callIndex(run.calls, /^api .*matching-refs/);
  const draftRead = callIndex(run.calls, /^api repos\/o\/r\/releases\/123 --jq/);
  const lastVersionRead = lines.reduce(
    (last, line, index) => (/^api .*releases\?per_page/.test(line) ? index : last),
    -1,
  );
  assert.ok(
    tipRead > uploads[uploads.length - 1] &&
      planRead > tipRead &&
      lastVersionRead > planRead &&
      draftRead > tagProbes[1] &&
      gateRead > draftRead,
    'the tip, coverage, latest and draft re-reads run after the upload, the ci read last',
  );
  assert.match(
    lines[patch - 1],
    /^api repos\/o\/r\/actions\/runs\//,
    'the ci green re-read is the last call before the flip',
  );
  assert.equal(patch, lines.length - 1, 'the publish flip is the last call of the step');
  assert.match(lines[patch], /draft=false/);
  assert.match(lines[patch], /make_latest=true/);
  assert.doesNotMatch(
    lines[patch],
    /tag_name|target_commitish/,
    'the flip only flips; the decided tag and target were verified, not resent',
  );
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'a clean publish deletes nothing');
  const idCalls = lines.filter((line) => line.includes('/releases/'));
  assert.ok(
    idCalls.every((line) => /releases\/[0-9]+/.test(line)),
    'every release endpoint uses the numeric id',
  );
  const callCount = lines.filter((line) => /^api /.test(line)).length;
  assert.equal(run.tagLog.length, callCount + 1);
  assert.deepEqual(
    run.tagLog.slice(0, callCount),
    run.tagLog.slice(0, callCount).map(() => 'tag=no'),
    'no tag exists at any call up to and including the flip',
  );
  assert.equal(
    run.tagLog[run.tagLog.length - 1],
    'tag=yes',
    'the tag appears only because the publish flip created it',
  );
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2').split(/\s/)[0],
    built,
    'publishing created the tag at the built commit even though main advanced',
  );
  assert.equal(run.state, 'public');
});

test('run 45401517056: main advancing during packaging still publishes its green ancestor', (t) => {
  const { git, publish, tip, built } = publishFixture(t);
  const run = publish({
    BRANCH_READ: JSON.stringify({ commit: { sha: tip } }),
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.state, 'public');
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2').split(/\s/)[0], built);
  assert.equal(callIndex(run.calls, /-X DELETE/), -1);
});

test('a packaged commit outside main never publishes even with green ci', (t) => {
  const { git, publish, tip } = publishFixture(t);
  const run = publish({
    BRANCH_READ: JSON.stringify({ commit: { sha: tip } }),
    COMPARE_READ: JSON.stringify({ status: 'diverged', merge_base_commit: { sha: tip } }),
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /no longer on main/);
  assert.equal(run.state, 'draft');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1);
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a ci attempt that turned during the upload leaves the staged draft behind', (t) => {
  const { git, publish, built } = publishFixture(t);
  const run = publish({
    RUN_READ: JSON.stringify({ ...greenCi(built), conclusion: 'failure' }),
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /publish aborted/);
  assert.equal(run.state, 'draft');
  const create = callIndex(run.calls, /^api -X POST repos\/o\/r\/releases /);
  const tipRead = callIndex(run.calls, /^api .*branches\/main/);
  const gateRead = callIndex(run.calls, /^api .*workflows\/ci\.yml\/runs/);
  assert.ok(
    create >= 0 && tipRead > create && gateRead > tipRead,
    'the gate is re-read after the upload, after the tip check',
  );
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'nothing is deleted');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1);
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a ci rerun that starts during the inventory scans aborts before the flip', (t) => {
  const { git, publish, built, root } = publishFixture(t);
  const run = publish({
    RERUN_ARMED: join(root, 'rerun-armed'),
    RUN_READ_LATE: JSON.stringify({
      ...greenCi(built),
      run_attempt: 2,
      status: 'in_progress',
      conclusion: null,
    }),
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /publish aborted/);
  assert.equal(run.state, 'draft');
  const create = callIndex(run.calls, /^api -X POST repos\/o\/r\/releases /);
  const tipRead = callIndex(run.calls, /^api .*branches\/main/);
  const planRead = callIndex(run.calls, /^api .*matching-refs/);
  const gateRead = callIndex(run.calls, /^api .*workflows\/ci\.yml\/runs/);
  assert.ok(
    create >= 0 && tipRead > create && planRead > tipRead && gateRead > planRead,
    'the rerun began while the scans ran and the final ci read sees it',
  );
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1, 'nothing is published');
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'nothing is deleted');
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a publish-only rerun refuses once another release already covers the commit', (t) => {
  const { git, publish, built } = publishFixture(t);
  git('push', '--quiet', 'origin', `${built}:refs/tags/desktop-v0.1.703`);
  const run = publish({
    VERSION: '0.1.704',
    TAGS_READ: JSON.stringify([
      { ref: 'refs/tags/desktop-v0.1.703', object: { sha: built, type: 'commit' } },
    ]),
    RELEASES_PAGE: releases(rel('desktop-v0.1.703')),
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /already covers/);
  assert.equal(run.state, 'draft');
  const create = callIndex(run.calls, /^api -X POST repos\/o\/r\/releases /);
  const planRead = callIndex(run.calls, /^api .*matching-refs/);
  assert.ok(create >= 0 && planRead > create, 'the coverage re-read runs after the upload');
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'nothing is deleted');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1);
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.704'),
    '',
    'the refused version leaves no tag behind',
  );
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.703').split(/\s/)[0],
    built,
    'the published release tag is never touched',
  );
});

test('a version no longer above the highest published release refuses and leaves the draft', (t) => {
  const { git, publish } = publishFixture(t);
  const run = publish({ RELEASES_PAGE: releases(rel('desktop-v0.1.9')) });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /no longer above/);
  assert.equal(run.state, 'draft');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1);
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'nothing is deleted');
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a superseded version refuses while a version above every release publishes latest', (t) => {
  const { git, publish, built, stateFile } = publishFixture(t);
  const low = publish({
    VERSION: '0.1.701',
    RELEASES_PAGE: releases(rel('desktop-v0.1.700'), rel('desktop-v0.1.702')),
  });
  assert.notEqual(low.result.status, 0);
  assert.match(low.result.stderr, /no longer above/);
  assert.equal(low.state, 'draft');
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.701'),
    '',
    'the refused version leaves no tag behind',
  );
  writeFileSync(stateFile, 'none');
  const high = publish({
    VERSION: '0.1.703',
    RELEASES_PAGE: releases(rel('desktop-v0.1.700'), rel('desktop-v0.1.702')),
  });
  assert.equal(high.result.status, 0, high.result.stderr);
  const patch = callIndex(high.calls, /^api -X PATCH /);
  assert.match(
    high.calls.trim().split('\n')[patch],
    /make_latest=true/,
    'a version above every existing release is marked latest on the flip',
  );
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.703').split(/\s/)[0],
    built,
    'the flip created the tag at the built commit',
  );
});

test('a tag already pinning the release commit is never adopted', (t) => {
  const { git, publish, built } = publishFixture(t);
  git('push', '--quiet', 'origin', `${built}:refs/tags/desktop-v0.1.2`);
  const run = publish();
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /never adopted/);
  assert.equal(callIndex(run.calls, /^api -X POST /), -1, 'no draft is staged');
  assert.equal(callIndex(run.calls, /releases\/[0-9]/), -1, 'nothing touches a release id');
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'nothing is deleted');
  assert.equal(run.state, 'none');
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2').split(/\s/)[0],
    built,
    'the occupied tag is left exactly as found',
  );
});

test('an annotated tag already pinning the release commit is never adopted', (t) => {
  const { git, publish, built } = publishFixture(t);
  git('tag', '-m', 'leftover tag', 'desktop-v0.1.2', built);
  const tagObject = git('rev-parse', 'refs/tags/desktop-v0.1.2');
  assert.notEqual(tagObject, built, 'the fixture tag is annotated');
  git('push', '--quiet', 'origin', 'refs/tags/desktop-v0.1.2');
  const run = publish();
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /never adopted/);
  assert.equal(callIndex(run.calls, /^api -X POST /), -1, 'no draft is staged');
  assert.equal(run.state, 'none');
  const lines = git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2*').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`^${tagObject}`), 'the ref still holds the tag object');
  assert.match(lines[1], new RegExp(`^${built}`), 'the tag still peels to the built commit');
});

test('a tag owned by a different commit refuses before staging', (t) => {
  const { git, publish, tip } = publishFixture(t);
  git('push', '--quiet', 'origin', `${tip}:refs/tags/desktop-v0.1.2`);
  const run = publish();
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /never adopted/);
  assert.equal(callIndex(run.calls, /^api -X POST /), -1, 'no draft is staged');
  assert.equal(run.state, 'none');
  assert.match(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'),
    new RegExp(`^${tip}`),
    'the tag still points at the other commit',
  );
});

test('a leftover draft holding the tag name refuses the create and is never touched', (t) => {
  const { git, publish, draftsFile } = publishFixture(t);
  writeFileSync(draftsFile, '999\tdesktop-v0.1.2\n');
  const run = publish();
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /could not be created/);
  assert.equal(run.state, 'none', 'nothing was staged');
  assert.equal(
    callIndex(run.calls, /releases\/999/),
    -1,
    'the other draft is never read or deleted',
  );
  assert.equal(callIndex(run.calls, /-X DELETE/), -1);
  assert.equal(
    readFileSync(draftsFile, 'utf8').trim(),
    '999\tdesktop-v0.1.2',
    'the leftover draft keeps the name it holds',
  );
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a draft that cannot be staged leaves nothing behind', (t) => {
  const { git, publish } = publishFixture(t);
  const run = publish({ CREATE_FAIL: '1' });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /could not be created/);
  assert.equal(run.state, 'none');
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'no draft existed to delete');
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a nonnumeric create response refuses before any upload', (t) => {
  const { git, publish } = publishFixture(t);
  const run = publish({ BAD_ID: '1' });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /numeric release id/);
  assert.equal(callIndex(run.calls, /assets/), -1, 'nothing uploads against a nonnumeric id');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1);
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a draft retargeted during the upload is refused, never renamed back', (t) => {
  const { git, publish, tip } = publishFixture(t);
  const run = publish({ RETARGET_SHA: tip, RETARGET_TAG: 'desktop-v9.9.9' });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /no longer holds/);
  assert.equal(run.state, 'draft', 'the refused draft is left behind for an operator');
  const draftRead = callIndex(run.calls, /^api repos\/o\/r\/releases\/123 --jq/);
  assert.ok(draftRead >= 0, 'the draft was re-read by numeric id before the flip');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1, 'nothing is published');
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'nothing is deleted');
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v9.9.9'),
    '',
    'no tag is created under the name the draft was retargeted to',
  );
});

test('a draft already published during the upload refuses the flip', (t) => {
  const { git, publish } = publishFixture(t);
  const run = publish({ STEAL_PUBLISH: '1' });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /no longer holds/);
  assert.equal(run.state, 'draft');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1);
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('a draft that vanished during the upload refuses the flip', (t) => {
  const { git, publish } = publishFixture(t);
  const run = publish({ DRAFT_GONE: '1' });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /could not be re-read/);
  assert.equal(run.state, 'draft');
  assert.equal(callIndex(run.calls, /^api -X PATCH /), -1);
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('the version is decided once in decide and stamped into both builds', () => {
  const text = readFileSync(
    new URL('../.github/workflows/desktop-release.yml', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(text, /github\.run_number/);
  assert.equal(workflow.env?.VERSION, undefined);
  assert.equal(
    workflow.jobs.decide.outputs.version,
    `\${{ steps.decision.outputs.version }}`,
    'decide computes the version once',
  );
  const jobText = (name) =>
    new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\w|$(?![\\s\\S]))`, 'm').exec(text)[1];
  for (const name of ['package-arm64', 'package-x64', 'publish']) {
    assert.equal(
      workflow.jobs[name].env?.VERSION,
      `\${{ needs.decide.outputs.version }}`,
      `${name} takes the decided version`,
    );
    assert.doesNotMatch(
      jobText(name),
      /next-desktop-version|matching-refs/,
      `${name} never reads tags after decide`,
    );
  }
  for (const jobName of ['package-arm64', 'package-x64']) {
    const choose = workflow.jobs[jobName].steps.findIndex(
      (step) => step.name === 'Choose the version one above the highest desktop tag',
    );
    assert.equal(choose, -1, `no per-arch version choice remains in ${jobName}`);
  }
});

test('publish refuses archives that disagree with the decided version', () => {
  const steps = workflow.jobs.publish.steps;
  const check = steps.findIndex(
    (step) => step.name === 'Check the packaged builds carry the decided version',
  );
  const manifest = steps.findIndex((step) => step.name === 'Write the update manifest');
  assert.ok(check >= 0, 'publish checks the packaged archives against the decided version');
  assert.ok(manifest > check, 'the manifest is written only for a matching build');
  assert.match(steps[check].run, /\$arm64" != "\$VERSION" \] \|\| \[ "\$x64" != "\$VERSION"/);
  const publish = steps.find((step) => step.name === 'Publish the release').run;
  assert.doesNotMatch(publish, /next-desktop-version/);
});

test('the next desktop version is one above the highest desktop-v tag', async () => {
  const { desktopTagVersion, fetchDesktopTags, nextDesktopVersion } = await import(
    './ops/next-desktop-version.mjs'
  );
  assert.deepEqual(desktopTagVersion('desktop-v1.2.3'), [1, 2, 3]);
  assert.equal(desktopTagVersion('desktop-v1.2'), null);
  assert.equal(desktopTagVersion('web-v1.2.3'), null);
  assert.equal(nextDesktopVersion([]), '0.1.1');
  assert.equal(nextDesktopVersion(['desktop-v0.1.9', 'desktop-v0.1.10']), '0.1.11');
  assert.equal(nextDesktopVersion(['desktop-v0.1.42', 'desktop-v9.9.9']), '9.9.10');
  assert.equal(nextDesktopVersion(['web-v9.9.9', 'desktop-v0.1.2', 'draft']), '0.1.3');
  const calls = [];
  const tags = fetchDesktopTags({
    repo: 'o/r',
    gh(args) {
      calls.push(args[1]);
      return JSON.stringify([{ ref: 'refs/tags/desktop-v0.1.7' }, { ref: 'refs/tags/other' }]);
    },
  });
  assert.deepEqual(tags, ['desktop-v0.1.7', 'other']);
  assert.equal(calls[0], 'repos/o/r/git/matching-refs/tags/desktop-v');
});

test('both architectures are packaged in parallel and arm64 verify starts without waiting for x64', () => {
  const manifest = readFileSync(
    new URL('../apps/desktop/scripts/release-manifest.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(workflow.jobs.package, undefined, 'matrix package job is split by arch');
  assert.match(manifest, /ARCHS = \['arm64', 'x64'\]/);
  for (const [arch, jobName] of [
    ['arm64', 'package-arm64'],
    ['x64', 'package-x64'],
  ]) {
    const job = workflow.jobs[jobName];
    assert.ok(job, `${jobName} exists`);
    assert.deepEqual(job.needs, ['decide']);
    assert.equal(job.strategy, undefined, `${jobName} has no shared fail-fast matrix`);
    assert.equal(job.environment, 'desktop-release');
    assert.equal(job.permissions, undefined);
    assert.equal(job.env?.ARCH, arch);
    assert.equal(job.env?.VERSION, `\${{ needs.decide.outputs.version }}`);
  }
  assert.deepEqual(workflow.jobs.publish.needs, [
    'decide',
    'package-arm64',
    'package-x64',
    'package-win',
    'package-linux',
    'live-verify',
    'verify-arm64-smoke',
    'verify-arm64-journeys',
    'verify-arm64-post-install',
  ]);
  for (const jobName of ['package-win', 'package-linux']) {
    assert.deepEqual(workflow.jobs[jobName].needs, ['decide']);
  }
  for (const jobName of [
    'verify-arm64-smoke',
    'verify-arm64-journeys',
    'verify-arm64-post-install',
  ]) {
    assert.deepEqual(workflow.jobs[jobName].needs, ['decide', 'package-arm64']);
    assert.equal(workflow.jobs[jobName].environment, undefined);
    assert.equal(workflow.jobs[jobName].permissions, undefined);
    assert.equal(workflow.jobs[jobName].env?.VERSION, `\${{ needs.decide.outputs.version }}`);
    const download = workflow.jobs[jobName].steps.find((step) =>
      String(step.uses ?? '').startsWith('actions/download-artifact@'),
    );
    assert.ok(download, `${jobName} downloads the arm64 zip artifact`);
    assert.equal(download.with?.name, 'desktop-arm64-zip');
  }
  const publishDownload = workflow.jobs.publish.steps.find((step) =>
    String(step.uses ?? '').startsWith('actions/download-artifact@'),
  );
  assert.equal(publishDownload?.with?.pattern, 'desktop-*');
  assert.equal(publishDownload?.with?.['merge-multiple'], true);
  assert.deepEqual(workflow.jobs['verify-arm64-journeys'].strategy.matrix.mode, [
    'local-server',
    'remote-server',
  ]);
  assert.equal(workflow.jobs.publish.permissions.contents, 'write');
  assert.equal(workflow.jobs['package-linux']['runs-on'], 'ubuntu-latest');
  assert.equal(workflow.jobs['package-linux'].permissions, undefined);
  const linuxPackageStep = workflow.jobs['package-linux'].steps.find(
    (step) => step.name === 'Package the Linux x64 archive',
  );
  assert.match(linuxPackageStep.run, /set -o pipefail/);
  assert.match(linuxPackageStep.run, /electron-builder --linux dir --x64/);
  assert.match(linuxPackageStep.run, /extraMetadata\.version="\$VERSION"/);
  assert.match(linuxPackageStep.run, /command -v pigz/);
  assert.match(linuxPackageStep.run, /--numeric-owner --owner=0 --group=0/);
  assert.match(linuxPackageStep.run, /Cairn-\$VERSION-linux-x64/);
  const linuxUpload = workflow.jobs['package-linux'].steps.find(
    (step) => step.name === 'Keep the packaged Linux archive for the publish job',
  );
  assert.ok(linuxUpload);
  assert.equal(linuxUpload.with.name, 'desktop-linux-x64');
  assert.equal(linuxUpload.with.overwrite, true);
  assert.match(publishScript, /-f name="Cairn \$VERSION"/);
  assert.doesNotMatch(publishScript, /Cairn for Mac/);
  const versionCheck = workflow.jobs.publish.steps.find(
    (step) => step.name === 'Check the packaged builds carry the decided version',
  );
  assert.match(versionCheck.run, /Cairn-\*-mac-arm64\.zip/);
  assert.match(versionCheck.run, /Cairn-\*-mac-x64\.zip/);
  assert.match(versionCheck.run, /Cairn-\*-linux-x64\.tar\.gz/);
  assert.match(
    publishScript,
    /\| macOS \(Apple Silicon\) \| `Cairn-__VERSION__-mac-arm64\.dmg` \|/,
  );
  assert.match(publishScript, /\| macOS \(Intel\) \| `Cairn-__VERSION__-mac-x64\.dmg` \|/);
  assert.match(
    publishScript,
    /\| Windows \(64-bit Installer\) \| `Cairn-__VERSION__-win-x64\.exe` \|/,
  );
  assert.match(
    publishScript,
    /\| Windows \(64-bit Portable ZIP\) \| `Cairn-__VERSION__-win-x64\.zip` \|/,
  );
  assert.match(publishScript, /\| Linux \(64-bit\) \| `Cairn-__VERSION__-linux-x64\.tar\.gz` \|/);
  assert.match(
    publishScript,
    /`-mac-\*\.zip` and `desktop-latest\.json` are for in-app auto-updates/,
  );
  assert.match(publishScript, /right-click, Open/);
});

test('the package upload overwrites so a rerun replaces only its own architecture', () => {
  const armZip = workflow.jobs['package-arm64'].steps.find(
    (entry) => entry.name === 'Keep the arm64 zip for verification and publish',
  );
  const armDmg = workflow.jobs['package-arm64'].steps.find(
    (entry) => entry.name === 'Keep the arm64 dmg for the publish job',
  );
  const x64Upload = workflow.jobs['package-x64'].steps.find(
    (entry) => entry.name === 'Keep the packaged x64 files for the publish job',
  );
  assert.ok(armZip);
  assert.equal(armZip.with.name, 'desktop-arm64-zip');
  assert.equal(armZip.with.overwrite, true);
  assert.equal(armZip.with['if-no-files-found'], 'error');
  assert.equal(armZip.with['retention-days'], 1);
  assert.match(armZip.with.path, /mac-arm64\.zip/);
  assert.ok(armDmg);
  assert.equal(armDmg.with.name, 'desktop-arm64-dmg');
  assert.equal(armDmg.with.overwrite, true);
  assert.equal(armDmg.with['if-no-files-found'], 'error');
  assert.equal(armDmg.with['retention-days'], 1);
  assert.match(armDmg.with.path, /mac-arm64\.dmg/);
  assert.ok(x64Upload);
  assert.equal(x64Upload.with.name, 'desktop-x64');
  assert.equal(x64Upload.with.overwrite, true);
  assert.equal(x64Upload.with['if-no-files-found'], 'error');
  assert.equal(x64Upload.with['retention-days'], 1);
  assert.match(x64Upload.with.path, /mac-x64\.dmg/);
  assert.match(x64Upload.with.path, /mac-x64\.zip/);
});

const assertPortableTarHeaders = (tgzPath) => {
  const buf = gunzipSync(readFileSync(tgzPath));
  let offset = 0;
  let checked = 0;
  while (offset + 512 <= buf.length) {
    const hdr = buf.subarray(offset, offset + 512);
    if (hdr.every((byte) => byte === 0)) break;
    const name = hdr.subarray(0, 100).toString('ascii').replace(/\0.*$/, '');
    const typeflag = String.fromCharCode(hdr[156]);
    const sizeRaw = hdr.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeRaw ? Number.parseInt(sizeRaw, 8) : 0;
    if (typeflag === '0' || typeflag === '\0' || typeflag === '2' || typeflag === '5') {
      const uid = Number.parseInt(
        hdr.subarray(108, 116).toString('ascii').replace(/\0.*$/, '').trim(),
        8,
      );
      const gid = Number.parseInt(
        hdr.subarray(116, 124).toString('ascii').replace(/\0.*$/, '').trim(),
        8,
      );
      const uname = hdr.subarray(265, 297).toString('ascii').replace(/\0.*$/, '');
      const gname = hdr.subarray(297, 329).toString('ascii').replace(/\0.*$/, '');
      assert.equal(uid, 0, `${name} tar header uid must be 0`);
      assert.equal(gid, 0, `${name} tar header gid must be 0`);
      assert.equal(uname, '', `${name} tar header uname must be empty`);
      assert.equal(gname, '', `${name} tar header gname must be empty`);
      checked += 1;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(checked > 0, 'tar archive contained entries to check');
};

const setupLinuxArchiveFixture = (
  prefix,
  { withUnpacked = true, customTar = false, tarStatusFile = null } = {},
) => {
  const root = makeTestTempDir(prefix);
  const bin = join(root, 'bin');
  const releaseDir = join(root, 'release');
  const extractDir = join(root, 'extracted');
  mkdirSync(bin, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });
  writeFileSync(join(root, 'build.mjs'), 'process.exit(0);\n');
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const tarBin = execFileSync('which', ['tar'], { encoding: 'utf8' }).trim();
  const gzipBin = execFileSync('which', ['gzip'], { encoding: 'utf8' }).trim();
  const rmBin = execFileSync('which', ['rm'], { encoding: 'utf8' }).trim();
  const mvBin = execFileSync('which', ['mv'], { encoding: 'utf8' }).trim();
  const isGnuTar = execFileSync(tarBin, ['--version'], { encoding: 'utf8' }).includes('GNU tar');
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync(rmBin, join(bin, 'rm'));
  symlinkSync(mvBin, join(bin, 'mv'));
  if (!customTar) {
    if (isGnuTar && !tarStatusFile) {
      symlinkSync(tarBin, join(bin, 'tar'));
    } else {
      const translate = isGnuTar
        ? ''
        : [
            'seen_num=0; seen_own=0; seen_grp=0',
            'for a in "$@"; do',
            '  case "$a" in',
            '    --numeric-owner) seen_num=1 ;;',
            '    --owner=0) seen_own=1 ;;',
            '    --group=0) seen_grp=1 ;;',
            '  esac',
            'done',
            '[ "$seen_num" = 1 ] && [ "$seen_own" = 1 ] && [ "$seen_grp" = 1 ] || { echo "missing portable tar flags" >&2; exit 9; }',
            'first=1',
            'for a in "$@"; do',
            '  if [ "$first" = 1 ]; then',
            '    set -- --uid 0 --gid 0 --uname "" --gname ""',
            '    first=0',
            '  fi',
            '  case "$a" in',
            '    --numeric-owner|--owner=0|--group=0) ;;',
            '    *) set -- "$@" "$a" ;;',
            '  esac',
            'done',
          ].join('\n');
      const runTar = tarStatusFile
        ? `"${tarBin}" "$@"\nstatus=$?\nprintf '%s\\n' "$status" > "${tarStatusFile}"\nexit "$status"`
        : `exec "${tarBin}" "$@"`;
      writeFileSync(join(bin, 'tar'), `#!/bin/sh\n${translate}\n${runTar}\n`, { mode: 0o755 });
    }
  }
  if (withUnpacked) {
    const unpacked = join(releaseDir, 'linux-unpacked');
    const resources = join(unpacked, 'resources', 'server');
    mkdirSync(resources, { recursive: true });
    writeFileSync(join(unpacked, 'cairn'), '#!/bin/sh\necho ok\n');
    chmodSync(join(unpacked, 'cairn'), 0o755);
    writeFileSync(join(resources, 'tsnet-sidecar-linux-amd64'), 'bin');
    symlinkSync('tsnet-sidecar-linux-amd64', join(resources, 'sidecar-link'));
  }
  return { root, bin, releaseDir, extractDir, tarBin, gzipBin };
};

test('package-linux packs Cairn-$VERSION-linux-x64 with gzip fallback preserving permissions, symlinks, and portable root ownership', () => {
  const step = workflow.jobs['package-linux'].steps.find(
    (entry) => entry.name === 'Package the Linux x64 archive',
  );
  const fx = setupLinuxArchiveFixture('linux-tar-layout-');
  try {
    symlinkSync(fx.gzipBin, join(fx.bin, 'gzip'));
    const run = spawnSync('/bin/bash', ['--norc', '--noprofile', '-e', '-c', step.run], {
      cwd: fx.root,
      encoding: 'utf8',
      env: {
        PATH: fx.bin,
        VERSION: '0.1.999',
      },
    });
    assert.equal(run.status, 0, run.error?.message || run.stderr || '');
    const tgz = join(fx.releaseDir, 'Cairn-0.1.999-linux-x64.tar.gz');
    assert.equal(existsSync(tgz), true);
    assertPortableTarHeaders(tgz);
    const listed = execFileSync(fx.tarBin, ['-tzf', tgz], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(listed.some((line) => line.startsWith('Cairn-0.1.999-linux-x64/')));
    execFileSync(fx.tarBin, ['-xzf', tgz, '-C', fx.extractDir, '--strip-components=1']);
    assert.equal(
      lstatSync(join(fx.extractDir, 'resources', 'server', 'sidecar-link')).isSymbolicLink(),
      true,
    );
    assert.equal(
      readlinkSync(join(fx.extractDir, 'resources', 'server', 'sidecar-link')),
      'tsnet-sidecar-linux-amd64',
    );
    assert.notEqual(lstatSync(join(fx.extractDir, 'cairn')).mode & 0o111, 0);
  } finally {
    releaseTestTempDir(fx.root);
  }
});

test('package-linux fails the archive step when tar exits non-zero even if the compressor succeeds', () => {
  const step = workflow.jobs['package-linux'].steps.find(
    (entry) => entry.name === 'Package the Linux x64 archive',
  );
  const fx = setupLinuxArchiveFixture('linux-tar-pipefail-', { customTar: true });
  try {
    const catBin = execFileSync('which', ['cat'], { encoding: 'utf8' }).trim();
    symlinkSync(catBin, join(fx.bin, 'cat'));
    writeFileSync(join(fx.bin, 'tar'), '#!/bin/sh\nprintf "partial"\nexit 2\n', { mode: 0o755 });
    writeFileSync(join(fx.bin, 'pigz'), '#!/bin/sh\ncat >/dev/null\nexit 0\n', { mode: 0o755 });
    const run = spawnSync('/bin/bash', ['--norc', '--noprofile', '-e', '-c', step.run], {
      cwd: fx.root,
      encoding: 'utf8',
      env: {
        PATH: fx.bin,
        VERSION: '0.1.999',
      },
    });
    assert.equal(
      run.status,
      2,
      run.error?.message || run.stderr || 'tar exit code 2 must fail the packaging step',
    );
    assert.match(step.run, /set -o pipefail/);
  } finally {
    releaseTestTempDir(fx.root);
  }
});

test('package-linux uses pigz when present, enforces portable root headers, and fails on missing linux-unpacked or compressor errors', () => {
  const step = workflow.jobs['package-linux'].steps.find(
    (entry) => entry.name === 'Package the Linux x64 archive',
  );

  const pigzOk = setupLinuxArchiveFixture('linux-pigz-ok-');
  try {
    const staleDir = join(pigzOk.releaseDir, 'Cairn-0.1.999-linux-x64');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'stale.txt'), 'old');
    const marker = join(pigzOk.root, 'pigz-used');
    writeFileSync(
      join(pigzOk.bin, 'pigz'),
      `#!/bin/sh\n: > "${marker}"\nexec "${pigzOk.gzipBin}" "$@"\n`,
      { mode: 0o755 },
    );
    const run = spawnSync('/bin/bash', ['--norc', '--noprofile', '-e', '-c', step.run], {
      cwd: pigzOk.root,
      encoding: 'utf8',
      env: { PATH: pigzOk.bin, VERSION: '0.1.999' },
    });
    assert.equal(run.status, 0, run.error?.message || run.stderr || '');
    assert.equal(existsSync(marker), true);
    const tgz = join(pigzOk.releaseDir, 'Cairn-0.1.999-linux-x64.tar.gz');
    assertPortableTarHeaders(tgz);
    const listed = execFileSync(pigzOk.tarBin, ['-tzf', tgz], { encoding: 'utf8' })
      .trim()
      .split('\n');
    assert.equal(
      listed.some((line) => line.includes('linux-unpacked')),
      false,
    );
    execFileSync(pigzOk.tarBin, ['-xzf', tgz, '-C', pigzOk.extractDir, '--strip-components=1']);
    assert.equal(existsSync(join(pigzOk.extractDir, 'stale.txt')), false);
    assert.equal(
      lstatSync(join(pigzOk.extractDir, 'resources', 'server', 'sidecar-link')).isSymbolicLink(),
      true,
    );
    assert.notEqual(lstatSync(join(pigzOk.extractDir, 'cairn')).mode & 0o111, 0);
  } finally {
    releaseTestTempDir(pigzOk.root);
  }

  const tarStatus = join(makeTestTempDir('linux-tar-status-'), 'tar-status');
  const pigzFail = setupLinuxArchiveFixture('linux-pigz-fail-', { tarStatusFile: tarStatus });
  try {
    const catBin = execFileSync('which', ['cat'], { encoding: 'utf8' }).trim();
    symlinkSync(catBin, join(pigzFail.bin, 'cat'));
    writeFileSync(join(pigzFail.bin, 'pigz'), '#!/bin/sh\ncat >/dev/null\nexit 3\n', {
      mode: 0o755,
    });
    const run = spawnSync('/bin/bash', ['--norc', '--noprofile', '-e', '-c', step.run], {
      cwd: pigzFail.root,
      encoding: 'utf8',
      env: { PATH: pigzFail.bin, VERSION: '0.1.999' },
    });
    assert.equal(readFileSync(tarStatus, 'utf8').trim(), '0');
    assert.equal(run.status, 3, run.error?.message || run.stderr || '');
  } finally {
    releaseTestTempDir(pigzFail.root);
    releaseTestTempDir(join(tarStatus, '..'));
  }

  const missingUnpacked = setupLinuxArchiveFixture('linux-missing-unpacked-', {
    withUnpacked: false,
  });
  try {
    const run = spawnSync('/bin/bash', ['--norc', '--noprofile', '-e', '-c', step.run], {
      cwd: missingUnpacked.root,
      encoding: 'utf8',
      env: { PATH: missingUnpacked.bin, VERSION: '0.1.999' },
    });
    assert.notEqual(run.status, 0, 'missing release/linux-unpacked fails the packaging step');
    assert.match(run.stderr, /linux-unpacked/);
  } finally {
    releaseTestTempDir(missingUnpacked.root);
  }
});

test('publish never renames or re-versions the decided build', () => {
  const text = readFileSync(
    new URL('../.github/workflows/desktop-release.yml', import.meta.url),
    'utf8',
  );
  const publishJob = /^ {2}publish:\n([\s\S]*?)(?=^ {2}\w|$(?![\s\S]))/m.exec(text)[1];
  assert.doesNotMatch(
    publishJob,
    /\bmv\b|GITHUB_ENV/,
    'nothing in publish renames archives or overrides VERSION',
  );
  for (const jobName of ['package-arm64', 'package-x64']) {
    const packageStep = workflow.jobs[jobName].steps.find(
      (step) => step.name === 'Package the app',
    );
    assert.match(
      packageStep.run,
      /extraMetadata\.version="\$VERSION"/,
      `the app inside ${jobName} archives reports the decided version`,
    );
  }
});

test('a leftover draft holding the decided name refuses the staging instead of a rename', (t) => {
  const { git, publish, draftsFile, releaseDir } = publishFixture(t);
  writeFileSync(draftsFile, '999\tdesktop-v0.1.2\n');
  const page = releases(rel('desktop-v0.1.2', true));
  const run = publish({ RELEASES_PAGE: page });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /could not be created/);
  for (const suffix of ['mac-arm64.dmg', 'mac-x64.dmg', 'mac-arm64.zip', 'mac-x64.zip']) {
    assert.ok(
      existsSync(join(releaseDir, `Cairn-0.1.2-${suffix}`)),
      `the archive keeps the decided version, never a rename: ${suffix}`,
    );
  }
  assert.equal(callIndex(run.calls, /-X PATCH /), -1, 'nothing is published');
  assert.equal(callIndex(run.calls, /-X DELETE/), -1, 'nothing is deleted');
  assert.equal(
    readFileSync(draftsFile, 'utf8').trim(),
    '999\tdesktop-v0.1.2',
    'the leftover draft keeps the name it holds',
  );
  assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2'), '');
});

test('release-manifest labels macOS update zips with -mac- while keeping manifest keys unchanged', (t) => {
  const dir = makeTestTempDir('release-manifest-');
  t.after(() => releaseTestTempDir(dir));
  for (const name of [
    'Cairn-0.1.2-mac-arm64.zip',
    'Cairn-0.1.2-mac-x64.zip',
    'Cairn-0.1.2-win-x64.exe',
  ]) {
    writeFileSync(join(dir, name), `payload-${name}`);
  }
  execFileSync(
    process.execPath,
    [resolve(repoRoot, 'apps/desktop/scripts/release-manifest.mjs'), '0.1.2', dir],
    { encoding: 'utf8' },
  );
  const manifest = JSON.parse(readFileSync(join(dir, 'desktop-latest.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.2');
  assert.deepEqual(Object.keys(manifest.files), ['arm64', 'x64', 'win-x64']);
  assert.equal(manifest.files.arm64.name, 'Cairn-0.1.2-mac-arm64.zip');
  assert.equal(manifest.files.x64.name, 'Cairn-0.1.2-mac-x64.zip');
  assert.equal(manifest.files['win-x64'].name, 'Cairn-0.1.2-win-x64.exe');
});
