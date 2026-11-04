import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/ops/eval-weekly.sh');
const day = new Date().toISOString().slice(0, 10);

function runWeekly(env, args = [], extraEnv = {}) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: env.home,
      CAIRN_EVAL_STATE_DIR: env.state,
      CAIRN_EVAL_RELAY_URL: 'https://relay.example/v1',
      CAIRN_EVAL_RELAY_KEY: 'relay-key',
      CAIRN_EVAL_REPO: env.repo,
      ...extraEnv,
    },
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eval-weekly-ops-'));
  const home = join(root, 'home');
  const state = join(root, 'state');
  const repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(repo, { recursive: true });
  return { root, home, state, repo };
}

function writeExecutable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

test('same-day re-run exits before flows when the review directory already exists', () => {
  const env = fixture();
  try {
    const review = join(env.state, 'reviews', day);
    mkdirSync(review, { recursive: true });
    writeFileSync(join(review, 'review.json'), '{"week":"already"}\n');
    const result = runWeekly(env, [], {
      CAIRN_LABELER_BASE_URL: 'https://labeler.example/v1',
      CAIRN_LABELER_API_KEY: 'labeler-key',
      CAIRN_LABELER_MODEL: 'gpt-5-mini',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(`${result.stdout}${result.stderr}`, /review already exists/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /eval-weekly: chief-dispatch start/);
    assert.equal(readFileSync(join(review, 'review.json'), 'utf8'), '{"week":"already"}\n');
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('labeler environment unset fails before a zero-pack review', () => {
  const env = fixture();
  try {
    const result = runWeekly(env);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /labeler environment is unset/);
    assert.equal(
      spawnSync('bash', ['-c', `test ! -e "${join(env.state, 'reviews', day)}"`]).status,
      0,
    );
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('weekly script exports packs by default and echoes sampler trace hit counts', () => {
  const source = readFileSync(script, 'utf8');
  const reviewCheck = source.indexOf('REVIEW_OUT=');
  const reviewExists = source.indexOf('review already exists');
  const labelerCheck = source.indexOf('labeler environment is unset');
  const packHelper = source.indexOf('export_and_label_packs()');
  const packCall = source.search(/export_and_label_packs "\$\{PACKS_DIR\}"/);
  const sampleStep = source.indexOf('eval-sample-failures.mjs');
  const firstFlow = source.indexOf('run_flow chief-dispatch');
  assert.ok(reviewExists >= 0, 'same-day review message missing');
  assert.ok(reviewCheck >= 0 && reviewCheck < firstFlow, 'review-dir check must precede flows');
  assert.ok(labelerCheck >= 0 && labelerCheck < firstFlow, 'labeler check must precede flows');
  assert.ok(packHelper >= 0, 'export_and_label_packs helper missing');
  assert.ok(packCall > firstFlow, 'pack export/label call must follow flows');
  assert.ok(sampleStep > packCall, 'sampler must follow labeled packs');
  assert.match(source, /rm -f "\$\{packs_export\}" "\$\{packs_labeled\}"/);
  assert.match(source, /traces\.hit|traces hit/);
});

test('week window uses portable UTC arithmetic without GNU date -d', () => {
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /date\s+-u\s+-d|date\s+-d\s/);
  const env = fixture();
  try {
    const bin = join(env.root, 'bin');
    mkdirSync(bin);
    writeExecutable(join(bin, 'date'), '#!/bin/sh\necho "date: illegal option -- d" >&2\nexit 1\n');
    const result = runWeekly(env, ['--week-window', '2026-10-28'], {
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /since=2026-10-21T00:00:00\.000Z/);
    assert.match(result.stdout, /until=2026-10-29T00:00:00\.000Z/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('export success then label failure leaves no stuck artifacts that block retry', () => {
  const env = fixture();
  try {
    const packsDir = join(env.state, 'packs');
    const bin = join(env.root, 'bin');
    mkdirSync(bin);
    const marker = join(env.root, 'label-fail');
    writeFileSync(marker, '1');
    writeExecutable(
      join(bin, 'pnpm'),
      `#!/bin/sh
set -e
cmd="$1"; shift
case "$cmd" in
  traj:export)
    out=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--out" ]; then out="$2"; shift 2; continue; fi
      shift
    done
    if [ -e "$out" ]; then echo "OutputExists: $out" >&2; exit 1; fi
    printf '%s\\n' '{"buildId":"b1"}' > "$out"
    echo "exported=1 out=$out"
    ;;
  traj:label)
    out=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--out" ]; then out="$2"; shift 2; continue; fi
      shift
    done
    if [ -e "$out" ]; then echo "OutputExists: $out" >&2; exit 1; fi
    if [ -f "${marker}" ]; then
      rm -f "${marker}"
      echo "label failed" >&2
      exit 1
    fi
    printf '%s\\n' '{"buildId":"b1","attribution":{"where":"runtime","why":"wrong_tool"}}' > "$out"
    echo "labeled=1 out=$out"
    ;;
  *)
    echo "unexpected pnpm $cmd" >&2
    exit 2
    ;;
esac
`,
    );
    const labeler = {
      PATH: `${bin}:${process.env.PATH}`,
      CAIRN_LABELER_BASE_URL: 'https://labeler.example/v1',
      CAIRN_LABELER_API_KEY: 'labeler-key',
      CAIRN_LABELER_MODEL: 'gpt-5-mini',
    };
    const first = runWeekly(env, ['--packs', packsDir, '--week', '2026-10-28'], labeler);
    assert.notEqual(first.status, 0, first.stdout + first.stderr);
    assert.match(`${first.stdout}${first.stderr}`, /label failed|labeling/);
    assert.equal(existsSync(join(packsDir, 'export.jsonl')), false);
    assert.equal(existsSync(join(packsDir, 'labeled.jsonl')), false);
    const second = runWeekly(env, ['--packs', packsDir, '--week', '2026-10-28'], labeler);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(existsSync(join(packsDir, 'labeled.jsonl')), true);
    assert.match(readFileSync(join(packsDir, 'labeled.jsonl'), 'utf8'), /buildId/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('pack helper stdout is only the labeled path when CLI prints summaries', () => {
  const env = fixture();
  try {
    const packsDir = join(env.state, 'packs');
    const bin = join(env.root, 'bin');
    mkdirSync(bin);
    writeExecutable(
      join(bin, 'pnpm'),
      `#!/bin/sh
set -e
cmd="$1"; shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--out" ]; then out="$2"; shift 2; continue; fi
  shift
done
case "$cmd" in
  traj:export)
    printf '%s\\n' '{"buildId":"b1"}' > "$out"
    echo "exported=1 out=$out"
    ;;
  traj:label)
    printf '%s\\n' '{"buildId":"b1","attribution":{"where":"runtime","why":"wrong_tool"}}' > "$out"
    echo "labeled=1 out=$out"
    ;;
  *)
    echo "unexpected pnpm $cmd" >&2
    exit 2
    ;;
esac
`,
    );
    const result = runWeekly(env, ['--packs', packsDir, '--week', '2026-10-28'], {
      PATH: `${bin}:${process.env.PATH}`,
      CAIRN_LABELER_BASE_URL: 'https://labeler.example/v1',
      CAIRN_LABELER_API_KEY: 'labeler-key',
      CAIRN_LABELER_MODEL: 'gpt-5-mini',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lines = result.stdout.replace(/\n$/, '').split('\n');
    assert.deepEqual(lines, [join(packsDir, 'labeled.jsonl')]);
    assert.match(result.stderr, /exported=1/);
    assert.match(result.stderr, /labeled=1/);
    const captured = spawnSync(
      'bash',
      [
        '-c',
        'set -euo pipefail; PACKS_LABELED="$(bash "$1" --packs "$2" --week 2026-10-28)"; printf "%s" "$PACKS_LABELED"',
        'capture',
        script,
        packsDir,
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: env.home,
          CAIRN_EVAL_STATE_DIR: env.state,
          CAIRN_EVAL_RELAY_URL: 'https://relay.example/v1',
          CAIRN_EVAL_RELAY_KEY: 'relay-key',
          CAIRN_EVAL_REPO: env.repo,
          CAIRN_LABELER_BASE_URL: 'https://labeler.example/v1',
          CAIRN_LABELER_API_KEY: 'labeler-key',
          CAIRN_LABELER_MODEL: 'gpt-5-mini',
        },
      },
    );
    assert.equal(captured.status, 0, captured.stdout + captured.stderr);
    assert.equal(captured.stdout, join(packsDir, 'labeled.jsonl'));
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('weekly script does not capture pack helper stdout into PACKS_LABELED', () => {
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /PACKS_LABELED="\$\(export_and_label_packs/);
  assert.match(source, /export_and_label_packs "\$\{PACKS_DIR\}"/);
  assert.match(source, /PACKS_LABELED="\$\{PACKS_DIR\}\/labeled\.jsonl"/);
  assert.match(source, /pnpm traj:export[^\n]*>&2/);
  assert.match(source, /pnpm traj:label[^\n]*>&2/);
});
