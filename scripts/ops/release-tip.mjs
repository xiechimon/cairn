#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const MAIN_REF = 'main';

export function fetchMainTip({ repo, gh }) {
  const branch = JSON.parse(gh(['api', `repos/${repo}/branches/${MAIN_REF}`]));
  return branch?.commit?.sha ?? null;
}

export function mainDecision({ repo, sha, gh }) {
  const tip = fetchMainTip({ repo, gh });
  if (tip === null) throw new Error('the branches/main read returned no commit sha');
  if (tip === sha) return { onMain: true };
  const comparison = JSON.parse(gh(['api', `repos/${repo}/compare/${sha}...${tip}`]));
  if (comparison.status === 'ahead' && comparison.merge_base_commit?.sha === sha) {
    return { onMain: true };
  }
  return {
    onMain: false,
    reason: `${sha.slice(0, 9)} is not an ancestor of main ${tip.slice(0, 9)}`,
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
    const decision = mainDecision({ repo, sha, gh });
    if (decision.onMain) {
      console.error(`[release-tip] ${sha.slice(0, 9)} is still on main`);
      console.log('on_main=true');
    } else {
      console.error(`[release-tip] ${decision.reason}; skipping`);
      console.log('on_main=false');
    }
    process.exit(0);
  } catch (error) {
    console.error(
      `[release-tip] could not read the main tip for ${sha.slice(0, 9)}: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
