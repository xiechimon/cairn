#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fetchHighestDesktopRelease } from './last-desktop-release.mjs';
import { compareVersions, desktopTagVersion } from './next-desktop-version.mjs';

export function versionAboveLatest({ version, highestTag }) {
  const decided = desktopTagVersion(`desktop-v${version}`);
  if (decided === null) {
    return {
      above: false,
      reason: `desktop-v${version} is not a desktop-v<major>.<minor>.<patch> version`,
    };
  }
  if (highestTag === null || highestTag === undefined) {
    return {
      above: true,
      reason: `no published stable desktop-v* release exists; desktop-v${version} becomes the first`,
    };
  }
  const highest = desktopTagVersion(highestTag);
  if (highest !== null && compareVersions(decided, highest) <= 0) {
    return {
      above: false,
      reason: `${highestTag} exists at or above desktop-v${version}; the publish aborts and the next poll allocates a fresh version`,
    };
  }
  return {
    above: true,
    reason: `desktop-v${version} is above ${highestTag}, the highest published stable desktop-v* release`,
  };
}

export function publishBaseline({ version, sha, repo, gh }) {
  const highestTag = fetchHighestDesktopRelease({ repo, gh });
  const check = versionAboveLatest({ version, highestTag });
  if (!check.above) throw new Error(`the version is no longer above stable: ${check.reason}`);
  if (highestTag === null) throw new Error('no published stable release for the migration smoke');
  const comparison = JSON.parse(gh(['api', `repos/${repo}/compare/${highestTag}...${sha}`]));
  if (comparison.status !== 'ahead') {
    throw new Error(`the candidate is not a strict successor of ${highestTag}`);
  }
  return highestTag;
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const repo = process.env.GATE_REPO ?? process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  const [, , version, sha] = process.argv;
  try {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('invalid release SHA');
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    console.log(`baseline=${publishBaseline({ version, sha, repo, gh })}`);
  } catch (error) {
    console.error(
      `[release-version] could not read the desktop-v* releases for desktop-v${version}: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
