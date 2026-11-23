#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const MAIN_REF = 'main';

export function fetchMainTip({ repo, gh }) {
  const branch = JSON.parse(gh(['api', `repos/${repo}/branches/${MAIN_REF}`]));
  return branch?.commit?.sha ?? null;
}

export function tipDecision({ tip, sha }) {
  if (tip === sha) return { isTip: true };
  return {
    isTip: false,
    reason: `main moved past ${sha.slice(0, 9)}; the tip is now ${String(tip).slice(0, 9)} and a later run evaluates whatever tip is current then`,
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
    const tip = fetchMainTip({ repo, gh });
    if (tip === null) {
      console.error('[release-tip] the branches/main read returned no commit sha');
      process.exit(2);
    }
    const decision = tipDecision({ tip, sha });
    if (decision.isTip) {
      console.error(`[release-tip] ${sha.slice(0, 9)} is still the main tip`);
      console.log('tip=true');
    } else {
      console.error(`[release-tip] ${decision.reason}; skipping`);
      console.log('tip=false');
    }
    process.exit(0);
  } catch (error) {
    console.error(
      `[release-tip] could not read the main tip for ${sha.slice(0, 9)}: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
