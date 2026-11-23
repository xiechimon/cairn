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

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const repo = process.env.GATE_REPO ?? process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  const version = process.argv[2] ?? process.env.VERSION;
  try {
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const check = versionAboveLatest({
      version,
      highestTag: fetchHighestDesktopRelease({ repo, gh }),
    });
    console.error(`[release-version] ${check.reason}`);
    console.log(`latest=${check.above}`);
    process.exit(0);
  } catch (error) {
    console.error(
      `[release-version] could not read the desktop-v* releases for desktop-v${version}: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
