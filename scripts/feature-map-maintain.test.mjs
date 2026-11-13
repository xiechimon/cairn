import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  aggregateChecks,
  buildIssueBody,
  checkVerifyFeaturesIndex,
  decideIssueAction,
  fileMaintainIssue,
  ISSUE_LABELS,
  ISSUE_MARKER,
  ISSUE_TITLE,
  parseArgs,
  renderReport,
  runMaintain,
} from './feature-map-maintain.mjs';
import { makeTestTempDir } from './test-tmpdir.mjs';

test('daily workflow files an issue with github.token and no refresh secret', () => {
  const yaml = readFileSync(
    new URL('../.github/workflows/feature-map-daily-check.yml', import.meta.url),
    'utf8',
  );
  assert.match(yaml, /issues:\s*write/);
  assert.match(yaml, /feature-map-maintain\.mjs --file-issue/);
  assert.match(yaml, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(yaml, /FEATURE_MAP_REFRESH_TOKEN/);
});

test('parseArgs accepts the maintain flags', () => {
  assert.deepEqual(parseArgs(['--file-issue', '--dry-run']), {
    fileIssue: true,
    dryRun: true,
    help: false,
  });
});

test('parseArgs rejects the retired ticket-register flag', () => {
  assert.throws(() => parseArgs(['--skip-ticket-register']), /unknown argument/);
});

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--boom']), /unknown argument/);
});

test('checkVerifyFeaturesIndex is green when README links every feature file', () => {
  const dir = makeTestTempDir('fm-index-ok-');
  writeFileSync(
    join(dir, 'README.md'),
    '# map\n\n- [Theme](./theme.md)\n- [Search](./search.md)\n',
  );
  writeFileSync(join(dir, 'theme.md'), '# Theme\n');
  writeFileSync(join(dir, 'search.md'), '# Search\n');
  const result = checkVerifyFeaturesIndex(dir);
  assert.equal(result.ok, true);
  assert.match(result.summary, /2 feature files/);
});

test('checkVerifyFeaturesIndex reports missing README links and dangling links', () => {
  const dir = makeTestTempDir('fm-index-bad-');
  writeFileSync(join(dir, 'README.md'), '# map\n\n- [Gone](./gone.md)\n');
  writeFileSync(join(dir, 'theme.md'), '# Theme\n');
  const result = checkVerifyFeaturesIndex(dir);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((line) => line.includes('does not link ./theme.md')));
  assert.ok(result.findings.some((line) => line.includes('links ./gone.md')));
});

test('aggregateChecks and renderReport surface failed ids', () => {
  const aggregated = aggregateChecks([
    { id: 'feature-map', ok: true, summary: 'ok', findings: [] },
    { id: 'verify-features-index', ok: false, summary: 'gap', findings: ['missing link'] },
  ]);
  assert.equal(aggregated.ok, false);
  assert.equal(aggregated.failed.length, 1);
  const report = renderReport(aggregated.checks);
  assert.match(report, /verify-features-index: FAIL/);
  assert.match(report, /missing link/);
});

test('decideIssueAction comments on an existing open title match', () => {
  assert.deepEqual(decideIssueAction({ openIssues: [{ number: 42, title: ISSUE_TITLE }] }), {
    action: 'comment',
    number: 42,
  });
  assert.deepEqual(decideIssueAction({ openIssues: [] }), {
    action: 'create',
    title: ISSUE_TITLE,
    labels: ISSUE_LABELS,
  });
});

test('buildIssueBody carries the maintain marker and dual-map hint', () => {
  const body = buildIssueBody({ report: '# report\n', runUrl: 'https://example.test/run/1' });
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.match(body, /verify-cairn\/feature-map\.json/);
  assert.match(body, /verify-cairn\/features/);
  assert.match(body, /https:\/\/example\.test\/run\/1/);
});

test('fileMaintainIssue dry-run creates without calling gh writes', () => {
  const filed = fileMaintainIssue({
    report: '# report\n',
    dryRun: true,
    listOpenIssues: () => [],
    spawn() {
      throw new Error('spawn should not run in dry-run with listOpenIssues');
    },
  });
  assert.equal(filed.action, 'create');
  assert.equal(filed.dryRun, true);
  assert.match(filed.body, new RegExp(ISSUE_MARKER));
});

function passingRun(t, { args, openIssues }) {
  const dir = makeTestTempDir('fm-pass-');
  writeFileSync(join(dir, 'README.md'), '# map\n\n- [Theme](./theme.md)\n');
  writeFileSync(join(dir, 'theme.md'), '# Theme\n');
  const previousRunUrl = process.env.GITHUB_RUN_URL;
  process.env.GITHUB_RUN_URL = 'https://example.test/run/7';
  t.after(() => {
    if (previousRunUrl === undefined) delete process.env.GITHUB_RUN_URL;
    else process.env.GITHUB_RUN_URL = previousRunUrl;
  });
  const calls = [];
  const aggregated = runMaintain(args, {
    featuresDir: dir,
    runFeatureMapCheck: () => ({ id: 'feature-map', ok: true, summary: 'ok', findings: [] }),
    listOpenIssues: () => openIssues,
    spawn(bin, argv) {
      calls.push([bin, ...argv]);
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  return { aggregated, calls };
}

test('a passing run closes the open maintain issue and leaves other issues alone', (t) => {
  const { aggregated, calls } = passingRun(t, {
    args: { fileIssue: true, dryRun: false, help: false },
    openIssues: [
      { number: 3272, title: ISSUE_TITLE },
      { number: 3273, title: `${ISSUE_TITLE} (manual follow-up)` },
    ],
  });
  assert.equal(aggregated.ok, true);
  assert.equal(calls.length, 1);
  const [bin, ...argv] = calls[0];
  assert.equal(bin, 'gh');
  assert.deepEqual(argv.slice(0, 3), ['issue', 'close', '3272']);
  assert.equal(argv[argv.indexOf('--reason') + 1], 'completed');
  assert.match(argv[argv.indexOf('--comment') + 1], /passed.*https:\/\/example\.test\/run\/7/s);
});

test('a passing run with no open maintain issue, a dry run, or no --file-issue writes nothing', (t) => {
  for (const [args, openIssues] of [
    [{ fileIssue: true, dryRun: false, help: false }, []],
    [{ fileIssue: true, dryRun: true, help: false }, [{ number: 3272, title: ISSUE_TITLE }]],
    [{ fileIssue: false, dryRun: false, help: false }, [{ number: 3272, title: ISSUE_TITLE }]],
  ]) {
    const { aggregated, calls } = passingRun(t, { args, openIssues });
    assert.equal(aggregated.ok, true);
    assert.deepEqual(calls, [], JSON.stringify(args));
  }
});

test('runMaintain fails on a broken features index and can dry-file', () => {
  const dir = makeTestTempDir('fm-run-');
  writeFileSync(join(dir, 'README.md'), '# empty index\n');
  writeFileSync(join(dir, 'theme.md'), '# Theme\n');
  const aggregated = runMaintain(
    { fileIssue: true, dryRun: true, help: false },
    {
      featuresDir: dir,
      runFeatureMapCheck: () => ({ id: 'feature-map', ok: true, summary: 'ok', findings: [] }),
      listOpenIssues: () => [{ number: 9, title: ISSUE_TITLE }],
      spawn() {
        throw new Error('unexpected spawn');
      },
    },
  );
  assert.equal(aggregated.ok, false);
  assert.equal(aggregated.failed[0].id, 'verify-features-index');
});
