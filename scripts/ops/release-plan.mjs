#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fetchDesktopReleases } from './last-desktop-release.mjs';
import { desktopTagVersion, freeDesktopVersion } from './next-desktop-version.mjs';

const TAG_PREFIX = 'desktop-v';
const REF_PREFIX = 'refs/tags/';

export function fetchDesktopTagTargets({ repo, gh }) {
  const refs = JSON.parse(gh(['api', `repos/${repo}/git/matching-refs/tags/${TAG_PREFIX}`])) ?? [];
  const targets = [];
  for (const entry of refs) {
    const ref = String(entry?.ref ?? '');
    if (!ref.startsWith(`${REF_PREFIX}${TAG_PREFIX}`)) continue;
    let sha = entry?.object?.sha ?? null;
    if (entry?.object?.type === 'tag' && sha !== null) {
      sha = JSON.parse(gh(['api', `repos/${repo}/git/tags/${sha}`]))?.object?.sha ?? null;
    }
    if (sha !== null) targets.push({ tag: ref.slice(REF_PREFIX.length), sha });
  }
  return targets;
}

const occupiedTagBase = (name) => {
  if (desktopTagVersion(name) !== null) return name;
  const match = /^desktop-v\d+\.\d+\.\d+[/-]/.exec(name ?? '');
  return match === null ? null : match[0].slice(0, -1);
};

export function planRelease({ sha, targets, releases }) {
  const names = [];
  const occupied = new Set();
  const stableTags = new Set();
  for (const release of releases ?? []) {
    const base = occupiedTagBase(release?.tag_name);
    if (base === null) continue;
    occupied.add(base);
    if (release.tag_name !== base || release.draft === true) continue;
    names.push(release.tag_name);
    if (release.prerelease !== true) {
      stableTags.add(release.tag_name);
    }
  }
  for (const target of targets ?? []) {
    const base = occupiedTagBase(target?.tag);
    if (base === null) continue;
    occupied.add(base);
    if (target.tag === base) names.push(target.tag);
  }
  const covered = (targets ?? []).find(
    (target) => target?.sha === sha && stableTags.has(target?.tag),
  );
  if (covered !== undefined) {
    return {
      released: true,
      version: desktopTagVersion(covered.tag).join('.'),
      reason: `${covered.tag} points at ${sha.slice(0, 9)} and its release is published; the candidate is already released`,
    };
  }
  return {
    released: false,
    version: freeDesktopVersion({ names, occupied }),
    reason: null,
  };
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const repo = process.env.GATE_REPO ?? process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  const sha =
    process.argv[2] ??
    process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  try {
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const plan = planRelease({
      sha,
      targets: fetchDesktopTagTargets({ repo, gh }),
      releases: fetchDesktopReleases({ repo, gh }),
    });
    if (plan.reason !== null) console.error(`[release-plan] ${plan.reason}`);
    console.log(`released=${plan.released}`);
    console.log(`version=${plan.version}`);
  } catch (error) {
    console.error(
      `[release-plan] could not read the desktop tags or releases: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
