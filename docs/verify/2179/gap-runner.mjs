import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';

const [mainTestPath, workflowPath] = process.argv.slice(2);
assert.ok(
  mainTestPath && workflowPath,
  'Usage: node gap-runner.mjs <main-test-path> <workflow-path>',
);
const root = resolve(dirname(workflowPath), '../..');
const workflow = readFileSync(workflowPath, 'utf8');
const currentTests = readFileSync(resolve(root, 'scripts/release-config.test.mjs'), 'utf8');
const fixtureSource = currentTests.match(/^const workflowFixtures = \[[\s\S]*?^\];/m)?.[0];
assert.ok(fixtureSource, 'The current release tests must define workflowFixtures');
const fixtures = runInNewContext(`${fixtureSource}\nworkflowFixtures;`);
let mainTests = readFileSync(mainTestPath, 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
for (const [before, after] of [
  ["const root = resolve(import.meta.dirname, '..');", `const root = ${JSON.stringify(root)};`],
  [
    "const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');",
    'const workflow = candidateWorkflow;',
  ],
]) {
  assert.equal(
    mainTests.split(before).length - 1,
    1,
    `Runner replacement must match once: ${before}`,
  );
  mainTests = mainTests.replace(before, after);
}
const runAssertions = (candidateWorkflow) => {
  const failures = [];
  let count = 0;
  runInNewContext(mainTests, {
    assert,
    candidateWorkflow,
    isDeepStrictEqual,
    readdirSync,
    readFileSync,
    resolve,
    test(name, body) {
      count++;
      try {
        body();
      } catch {
        failures.push(name);
      }
    },
  });
  assert.ok(count > 0, 'The supplied main test file must execute assertions');
  return { count, failures };
};

const baseline = runAssertions(workflow);
assert.deepEqual(baseline.failures, [], 'The unchanged workflow must pass main assertions');
console.log(`Unchanged workflow: ACCEPT (${baseline.count} main tests)`);
let accepted = 0;
for (const { name, before, after } of fixtures) {
  assert.equal(
    workflow.split(before).length - 1,
    1,
    `Fixture replacement must match once: ${name}`,
  );
  const { count, failures } = runAssertions(workflow.replace(before, after));
  if (failures.length === 0) accepted++;
  console.log(`Fixture ${name}: ${failures.length ? 'REJECT' : 'ACCEPT'} (${count} main tests)`);
  for (const failure of failures) console.log(`  Failed: ${failure}`);
}
console.log(
  `Main accepted ${accepted}/${fixtures.length} fixtures; rejected ${fixtures.length - accepted}/${fixtures.length}.`,
);
