#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GITHUB_HOSTED_RUNNER_SLOTS = 20;
export const MAX_CI_PARALLEL_RUNNER_DEMAND = GITHUB_HOSTED_RUNNER_SLOTS;
export const MAX_CONCURRENT_PREFLIGHT_RUNS = 2;

const FIXED_HEAVY_JOBS = ['check-core', 'tsnet-sidecar', 'pack-smoke', 'gates', 'eval'];
const MATRIX_JOBS = {
  vitestLight: 'vitest-light',
  vitestIntegration: 'vitest-integration',
  e2e: 'e2e',
  e2eAffected: 'e2e-affected',
};

function jobBlocks(workflowText) {
  const part = workflowText.split('\njobs:\n')[1] ?? '';
  return new Map(
    part
      .split(/\n(?= {2}[a-z][\w-]*:)/)
      .map((block) => [/^ {2}([\w-]+):/.exec(block)?.[1], block])
      .filter(([name]) => name),
  );
}

function shardCount(block, jobName) {
  const match = /shard:\s*\[([^\]]+)\]/.exec(block);
  if (!match) throw new Error(`ci.yml job ${jobName} has no shard matrix`);
  return match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean).length;
}

export function heavyParallelDemand(workflowText) {
  const jobs = jobBlocks(workflowText);
  for (const name of [...FIXED_HEAVY_JOBS, ...Object.values(MATRIX_JOBS)]) {
    if (!jobs.has(name)) throw new Error(`ci.yml has no job ${name}`);
  }
  const counts = Object.fromEntries(
    Object.entries(MATRIX_JOBS).map(([key, name]) => [key, shardCount(jobs.get(name), name)]),
  );
  const e2ePeak = Math.max(counts.e2e, counts.e2eAffected);
  const fixed = FIXED_HEAVY_JOBS.length;
  return {
    fixed,
    ...counts,
    e2ePeak,
    total: fixed + counts.vitestLight + counts.vitestIntegration + e2ePeak,
  };
}

export function evaluateCapacityPolicy({
  workflowText,
  preflightCap = MAX_CONCURRENT_PREFLIGHT_RUNS,
  maxParallelRunnerDemand = MAX_CI_PARALLEL_RUNNER_DEMAND,
}) {
  const demand = heavyParallelDemand(workflowText);
  if (preflightCap > MAX_CONCURRENT_PREFLIGHT_RUNS) {
    return {
      ok: false,
      demand,
      maxConcurrentPreflightRuns: preflightCap,
      maxParallelRunnerDemand,
      error: `preflight cap ${preflightCap} exceeds ${MAX_CONCURRENT_PREFLIGHT_RUNS} concurrent runs`,
    };
  }
  if (demand.total > maxParallelRunnerDemand) {
    return {
      ok: false,
      demand,
      maxConcurrentPreflightRuns: preflightCap,
      maxParallelRunnerDemand,
      error:
        `ci parallel runner demand ${demand.total} > ${maxParallelRunnerDemand}; ` +
        'the real 6/8 shard experiment ci-exp-shards-20261125 / run 45584537243 queued jobs for runners',
    };
  }
  return {
    ok: true,
    demand,
    maxConcurrentPreflightRuns: preflightCap,
    maxParallelRunnerDemand,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = evaluateCapacityPolicy({
      workflowText: readFileSync('.github/workflows/ci.yml', 'utf8'),
    });
    if (!result.ok) {
      console.error(`[ci-capacity-gate] ${result.error}`);
      process.exit(1);
    }
    console.log(
      `[ci-capacity-gate] PASS: peak heavy demand ${result.demand.total}/${result.maxParallelRunnerDemand}, preflight cap ${result.maxConcurrentPreflightRuns}`,
    );
  } catch (error) {
    console.error(`[ci-capacity-gate] ${error.message}`);
    process.exit(1);
  }
}
