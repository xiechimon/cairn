import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  evaluateCapacityPolicy,
  heavyParallelDemand,
  MAX_CI_PARALLEL_RUNNER_DEMAND,
  MAX_CONCURRENT_PREFLIGHT_RUNS,
} from './ci-capacity-gate.mjs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

test('ci capacity gate keeps the clean current shard shape inside the runner slots', () => {
  const demand = heavyParallelDemand(workflow);
  assert.deepEqual(demand, {
    fixed: 5,
    vitestLight: 6,
    vitestIntegration: 2,
    e2e: 6,
    e2eAffected: 6,
    e2ePeak: 6,
    total: 19,
  });
  assert.deepEqual(evaluateCapacityPolicy({ workflowText: workflow }), {
    ok: true,
    demand,
    maxConcurrentPreflightRuns: MAX_CONCURRENT_PREFLIGHT_RUNS,
    maxParallelRunnerDemand: MAX_CI_PARALLEL_RUNNER_DEMAND,
  });
});

test('ci capacity gate goes red on the real 6/8 shard overcapacity mistake', () => {
  const bad = workflow.replace(
    /( {2}e2e:\n(?:.*\n)*? {8}shard: )\[1, 2, 3, 4, 5, 6\]/,
    '$1[1, 2, 3, 4, 5, 6, 7, 8]',
  );
  assert.notEqual(bad, workflow);
  const demand = heavyParallelDemand(bad);
  assert.equal(demand.e2e, 8);
  assert.equal(demand.total, 21);
  const result = evaluateCapacityPolicy({ workflowText: bad });
  assert.equal(result.ok, false);
  assert.match(result.error, /21 > 20/);
  assert.match(result.error, /45584537243|ci-exp-shards-20261125/);
});

test('ci capacity gate refuses a preflight cap above two concurrent runs', () => {
  const result = evaluateCapacityPolicy({ workflowText: workflow, preflightCap: 3 });
  assert.equal(result.ok, false);
  assert.match(result.error, /preflight cap 3 exceeds 2/);
});
