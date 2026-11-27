#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { baselineSurfaceId } from '../visual-baseline-gate.mjs';
import { localLane } from './push-queue.mjs';

const WORKFLOW_FILE = 'visual-baselines.yml';
const REGISTRY_REL = 'apps/web/e2e/visual-surfaces.json';
const SNAPSHOTS_REL = 'apps/web/e2e/visual-baseline.spec.ts-snapshots';

export function parseArgs(argv) {
  const surfaces = [];
  let apply = true;
  let keepRef = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-apply') {
      apply = false;
    } else if (arg === '--keep-ref') {
      keepRef = true;
    } else if (arg === '--surfaces') {
      const start = i + 1;
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        i += 1;
        for (const id of argv[i].split(/[\s,]+/).filter(Boolean)) surfaces.push(id);
      }
      if (i < start || surfaces.length === 0) {
        return {
          ok: false,
          error: '[visual-baselines] --surfaces requires one or more surface IDs',
        };
      }
    } else if (arg.startsWith('--surfaces=')) {
      const items = arg
        .slice('--surfaces='.length)
        .split(/[\s,]+/)
        .filter(Boolean);
      if (items.length === 0) {
        return {
          ok: false,
          error: '[visual-baselines] --surfaces requires one or more surface IDs',
        };
      }
      surfaces.push(...items);
    } else {
      return { ok: false, error: `[visual-baselines] unknown option: ${arg}` };
    }
  }
  return { ok: true, surfaces, apply, keepRef };
}

export function resolveRequestedSurfaces(requested, registrySurfaces) {
  const known = new Set(registrySurfaces.map((surface) => surface.id));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`[visual-baselines] unknown surface ID(s): ${unknown.join(', ')}`);
  }
  return [...new Set(requested)];
}

export function baselineRef(lane, token = randomBytes(6).toString('hex')) {
  return `refs/heads/baselines/${lane}/${token}`;
}

export function matchDispatchedRun(runs, { sha, ref }) {
  const expectedTitle = `visual-baselines ${sha} ${ref}`;
  return (
    (runs ?? []).find(
      (run) => run.event === 'workflow_dispatch' && run.display_title === expectedTitle,
    ) ?? null
  );
}

export function validateRenderedBaselines(pngs, expectedIds) {
  if (!expectedIds || expectedIds.length === 0) {
    throw new Error('[visual-baselines] no expected surface IDs to validate');
  }
  const present = new Set(pngs.map((entry) => (typeof entry === 'string' ? entry : entry.name)));
  const missing = [];
  for (const id of expectedIds) {
    for (const theme of ['light', 'dark']) {
      const expectedFile = `${id}-${theme}-linux.png`;
      if (!present.has(expectedFile)) missing.push(expectedFile);
    }
  }
  if (missing.length > 0) {
    throw new Error(`[visual-baselines] missing rendered baseline PNG(s): ${missing.join(', ')}`);
  }
}

export function computeChangedSurfaces(paths) {
  const ids = new Set();
  for (const file of paths) {
    const parsed = baselineSurfaceId(file);
    if (parsed !== null) ids.add(parsed.id);
  }
  return [...ids].sort();
}

function targetSnapshotPaths(targetIds, registryCount) {
  if (targetIds.length < registryCount) {
    return targetIds.flatMap((id) => [
      `${SNAPSHOTS_REL}/${id}-light-linux.png`,
      `${SNAPSHOTS_REL}/${id}-dark-linux.png`,
    ]);
  }
  return [SNAPSHOTS_REL];
}

function assertNoUncommittedPaths(repoRoot, paths, context) {
  const dirty = execFileSync('git', ['status', '--porcelain=v1', '--', ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (dirty !== '') {
    throw new Error(`[visual-baselines] ${context}; commit or stash changes first:\n${dirty}`);
  }
}

function listPngFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listPngFiles(full));
    else if (entry.name.endsWith('.png')) found.push({ name: entry.name, full });
  }
  return found;
}

function runCommand(cmd, args, { cwd, inherit = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
  if (res.status !== 0) {
    const detail = (res.stderr ?? res.stdout ?? '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return (res.stdout ?? '').trim();
}

function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function waitForDispatchedRun({ repo, sha, ref, cwd, pollSeconds }) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const raw = runCommand(
      'gh',
      [
        'api',
        `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`,
      ],
      { cwd },
    );
    const data = JSON.parse(raw);
    const matched = matchDispatchedRun(data.workflow_runs, { sha, ref });
    if (matched) return matched;
    sleep(pollSeconds);
  }
  throw new Error(
    `[visual-baselines] timed out waiting for ${WORKFLOW_FILE} run for ${sha.slice(0, 9)}`,
  );
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 1;
  }
  const cwd = process.cwd();
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const registry = JSON.parse(readFileSync(join(repoRoot, REGISTRY_REL), 'utf8')).surfaces;
  const requested = resolveRequestedSurfaces(parsed.surfaces, registry);
  const expectedIds = requested.length > 0 ? requested : registry.map((surface) => surface.id);
  const snapshotPaths = targetSnapshotPaths(expectedIds, registry.length);

  assertNoUncommittedPaths(
    repoRoot,
    ['apps/web/src', REGISTRY_REL, ...(parsed.apply ? snapshotPaths : [])],
    'uncommitted changes detected',
  );

  const startedAt = Date.now();
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const lane = localLane(repoRoot);
  const ref = baselineRef(lane);
  const pollSeconds = Number(process.env.VISUAL_BASELINES_POLL_SECONDS ?? 3);
  const downloadRoot = mkdtempSync(join(tmpdir(), 'cairn-visual-baselines-'));
  let pushed = false;

  try {
    execFileSync('git', ['push', 'origin', `${headSha}:${ref}`], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    pushed = true;

    runCommand(
      'gh',
      [
        'workflow',
        'run',
        WORKFLOW_FILE,
        '--ref',
        'main',
        '-f',
        `ref=${ref}`,
        '-f',
        `sha=${headSha}`,
        '-f',
        `surfaces=${requested.join(',')}`,
      ],
      { cwd: repoRoot },
    );

    const run = waitForDispatchedRun({ repo, sha: headSha, ref, cwd: repoRoot, pollSeconds });
    console.log(
      `[visual-baselines] watching ${WORKFLOW_FILE} run ${run.id} (${run.html_url ?? ''})`,
    );
    runCommand('gh', ['run', 'watch', String(run.id), '--exit-status', '--interval', '10'], {
      cwd: repoRoot,
      inherit: true,
    });

    runCommand(
      'gh',
      ['run', 'download', String(run.id), '-n', `visual-baselines-${headSha}`, '-D', downloadRoot],
      { cwd: repoRoot },
    );

    const targetSet = new Set(expectedIds);
    const pngs = listPngFiles(downloadRoot).filter(({ name }) => {
      const parsedName = baselineSurfaceId(name);
      return parsedName !== null && targetSet.has(parsedName.id);
    });
    validateRenderedBaselines(pngs, expectedIds);

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (!parsed.apply) {
      console.log(
        `[visual-baselines] rendered ${pngs.length} PNG(s) in ${elapsedSeconds}s (--no-apply: working tree untouched)`,
      );
      return 0;
    }

    assertNoUncommittedPaths(
      repoRoot,
      snapshotPaths,
      'uncommitted snapshot edits appeared while waiting for CI',
    );

    const snapshotsDir = join(repoRoot, SNAPSHOTS_REL);
    for (const file of pngs) {
      copyFileSync(file.full, join(snapshotsDir, file.name));
    }

    const statusOut = execFileSync('git', ['status', '--porcelain=v1', '--', SNAPSHOTS_REL], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const changedFiles = statusOut
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim());
    const changedSurfaces = computeChangedSurfaces(changedFiles);
    console.log(
      `[visual-baselines] applied ${pngs.length} PNG(s) in ${elapsedSeconds}s; ${changedFiles.length} file(s) changed`,
    );
    for (const file of changedFiles) console.log(`  ${file}`);
    if (changedSurfaces.length > 0) {
      console.log(`Visual-Surfaces: ${changedSurfaces.join(' ')}`);
    } else {
      console.log('[visual-baselines] rendered PNGs match committed baselines (0 pixel diffs)');
    }
    return 0;
  } finally {
    rmSync(downloadRoot, { recursive: true, force: true });
    if (pushed && !parsed.keepRef) {
      spawnSync('git', ['push', 'origin', `:${ref}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exit(1);
  }
}
