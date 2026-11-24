#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fetchDesktopReleases, highestBaselineRelease } from './last-desktop-release.mjs';
import { evaluate, fetchGateEvidence } from './release-gate.mjs';
import { fetchDesktopTagTargets, planRelease } from './release-plan.mjs';

const SHIPPED_PATHS = [
  'apps/web',
  'apps/server',
  'apps/daemon',
  'apps/desktop',
  'apps/tsnet-sidecar',
  'packages/shared',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  ':(exclude)apps/*/test/*',
  ':(exclude)packages/*/test/*',
  ':(exclude)apps/web/e2e/*',
  ':(exclude)*.md',
];

export function shippedSourcesChanged({ lastTag, sha, git }) {
  if (lastTag === null || lastTag === undefined) {
    return {
      changed: true,
      files: [],
      reason: 'no published desktop-v* release exists to diff against',
    };
  }
  const diff = git(['diff', '--name-only', lastTag, sha, '--', ...SHIPPED_PATHS]);
  const files = diff.split('\n').filter((line) => line.length > 0);
  if (files.length === 0) {
    return { changed: false, files, reason: `nothing the app ships changed since ${lastTag}` };
  }
  return {
    changed: true,
    files,
    reason: `${files.length} shipped path(s) moved since ${lastTag}: ${files.slice(0, 20).join(', ')}`,
  };
}

export function decideRelease({ plan, verdict, changed }) {
  if (plan?.released === true) {
    return {
      release: false,
      reason: `desktop-v${plan.version} already publishes the main tip`,
    };
  }
  if (verdict?.action !== 'release') {
    return {
      release: false,
      reason: `the candidate's required ci is not green: ${verdict?.reason ?? 'no ci verdict'}`,
    };
  }
  if (changed !== true) {
    return {
      release: false,
      reason: 'nothing the app ships changed since the highest published stable desktop-v* release',
    };
  }
  return {
    release: true,
    reason:
      'the candidate is green, its shipped sources moved and no published desktop-v* release covers it',
  };
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const repo = process.env.GATE_REPO ?? process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const sha =
    process.argv[2] ??
    process.env.RELEASE_SHA ??
    process.env.GITHUB_SHA ??
    git(['rev-parse', 'HEAD']).trim();
  try {
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const releases = fetchDesktopReleases({ repo, gh });
    const targets = fetchDesktopTagTargets({ repo, gh });
    const lastTag = highestBaselineRelease(releases);
    const candidates = function* () {
      yield sha;
      const args = ['rev-list', '--topo-order', '--skip=1', sha];
      if (lastTag !== null) args.push('--not', lastTag);
      yield* git(args).trim().split('\n').filter(Boolean);
    };
    let version = null;
    let selected = null;
    for (const candidate of candidates()) {
      const plan = planRelease({ sha: candidate, targets, releases });
      version = plan.version;
      if (plan.released) break;
      const evidence = fetchGateEvidence({ repo, sha: candidate, gh });
      const verdict = evaluate({ ...evidence, sha: candidate, repo });
      const sources =
        verdict.action === 'release'
          ? shippedSourcesChanged({ lastTag, sha: candidate, git })
          : null;
      const decision = decideRelease({ plan, verdict, changed: sources?.changed });
      console.error(`[release-decide] ${candidate.slice(0, 9)}: ${decision.reason}`);
      if (decision.release) {
        selected = candidate;
        break;
      }
    }
    console.log(`release=${selected !== null}`);
    console.log(`sha=${selected ?? ''}`);
    console.log(`version=${version ?? ''}`);
    process.exit(0);
  } catch (error) {
    console.error(
      `[release-decide] could not judge the main tip ${sha.slice(0, 9)}: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
