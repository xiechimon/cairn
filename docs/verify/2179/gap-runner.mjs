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
const fixtureSource = currentTests.match(/^export const workflowFixtures = \[[\s\S]*?^\];/m)?.[0];
assert.ok(fixtureSource, 'The current release tests must define workflowFixtures');
const fixtures = runInNewContext(`${fixtureSource.replace(/^export /, '')}\nworkflowFixtures;`);
assert.equal(fixtures.length, 22, 'Fixture extraction must return exactly 22 fixtures');
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
  mainTests = mainTests.replace(before, () => after);
}
const runAssertions = async (candidateWorkflow) => {
  const failures = [];
  const errors = [];
  const tests = [];
  try {
    runInNewContext(mainTests, {
      assert,
      candidateWorkflow,
      isDeepStrictEqual,
      readdirSync,
      readFileSync,
      resolve,
      test(name, body) {
        tests.push({ name, body });
      },
    });
    assert.ok(tests.length > 0, 'The supplied main test file must execute assertions');
  } catch (error) {
    errors.push({ name: 'test registration', error });
  }
  for (const { name, body } of tests) {
    try {
      await body();
    } catch (error) {
      if (error instanceof assert.AssertionError) failures.push(name);
      else errors.push({ name, error });
    }
  }
  return { count: tests.length, failures, errors };
};

const baseline = await runAssertions(workflow);
for (const { name, error } of baseline.errors) console.error(`ERROR: ${name}: ${error}`);
assert.deepEqual(baseline.errors, [], 'The unchanged workflow must run without errors');
assert.deepEqual(baseline.failures, [], 'The unchanged workflow must pass main assertions');
console.log(`Unchanged workflow: ACCEPT (${baseline.count} main tests)`);
let accepted = 0;
let rejected = 0;
let errored = 0;
for (const { name, before, after } of fixtures) {
  assert.equal(
    workflow.split(before).length - 1,
    1,
    `Fixture replacement must match once: ${name}`,
  );
  const { count, failures, errors } = await runAssertions(workflow.replace(before, () => after));
  let result;
  if (errors.length > 0) {
    result = 'ERROR';
    errored++;
    process.exitCode = 1;
  } else if (failures.length > 0) {
    result = 'REJECT';
    rejected++;
  } else {
    result = 'ACCEPT';
    accepted++;
  }
  console.log(`Fixture ${name}: ${result} (${count} main tests)`);
  for (const failure of failures) console.log(`  Failed: ${failure}`);
  for (const { name, error } of errors) console.error(`  ERROR: ${name}: ${error}`);
}
console.log(
  `Main accepted ${accepted}/${fixtures.length} fixtures; rejected ${rejected}/${fixtures.length}; errors ${errored}/${fixtures.length}.`,
);
