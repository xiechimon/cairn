#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { compareVersions, desktopTagVersion } from './next-desktop-version.mjs';

const PAGE = 100;
const RELEASE_PREFIX = 'desktop-v';

export function isBaselineRelease(release) {
  return (
    release?.tag_name?.startsWith(RELEASE_PREFIX) === true &&
    release.draft !== true &&
    release.prerelease !== true
  );
}

export function fetchDesktopReleases({ repo, gh }) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const batch = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=${PAGE}&page=${page}`]));
    if (!Array.isArray(batch))
      throw new Error(`releases page ${page} is not a list; the inventory is unknown`);
    releases.push(...batch);
    if (batch.length === 0) return releases;
  }
}

export function highestBaselineRelease(releases, { exclude } = {}) {
  let highest = null;
  for (const release of releases ?? []) {
    if (!isBaselineRelease(release) || release.tag_name === exclude) continue;
    const version = desktopTagVersion(release.tag_name);
    if (version === null) continue;
    if (highest === null || compareVersions(version, highest.version) > 0) {
      highest = { tag: release.tag_name, version };
    }
  }
  return highest?.tag ?? null;
}

export function fetchLastDesktopRelease({ repo, gh }) {
  return highestBaselineRelease(fetchDesktopReleases({ repo, gh }));
}

export function fetchHighestDesktopRelease({ repo, gh, exclude }) {
  return highestBaselineRelease(fetchDesktopReleases({ repo, gh }), { exclude });
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const repo = process.argv[2] ?? process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  try {
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const tag = fetchLastDesktopRelease({ repo, gh });
    if (tag !== null) console.log(tag);
  } catch (error) {
    console.error(
      `[last-desktop-release] could not read releases: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
