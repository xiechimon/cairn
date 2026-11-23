#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const TAG_PREFIX = 'desktop-v';
const FIRST_VERSION = [0, 1, 0];

export function desktopTagVersion(tag) {
  const match = /^desktop-v(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? '');
  if (match === null) return null;
  return match.slice(1, 4).map(Number);
}

export const compareVersions = (a, b) => {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

export function nextDesktopVersion(tags) {
  let highest = FIRST_VERSION;
  for (const tag of tags ?? []) {
    const version = desktopTagVersion(tag);
    if (version !== null && compareVersions(version, highest) > 0) highest = version;
  }
  const [major, minor, patch] = highest;
  return `${major}.${minor}.${patch + 1}`;
}

export function freeDesktopVersion({ names, occupied }) {
  let version = desktopTagVersion(`desktop-v${nextDesktopVersion(names)}`);
  while (occupied.has(`desktop-v${version.join('.')}`)) {
    version = [version[0], version[1], version[2] + 1];
  }
  return version.join('.');
}

export function fetchDesktopTags({ repo, gh }) {
  const refs = JSON.parse(gh(['api', `repos/${repo}/git/matching-refs/tags/${TAG_PREFIX}`])) ?? [];
  return refs
    .map((entry) => String(entry?.ref ?? ''))
    .filter((ref) => ref.startsWith('refs/tags/'))
    .map((ref) => ref.slice('refs/tags/'.length));
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const repo = process.argv[2] ?? process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  try {
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    console.log(nextDesktopVersion(fetchDesktopTags({ repo, gh })));
  } catch (error) {
    console.error(
      `[next-desktop-version] could not read the desktop tags: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
