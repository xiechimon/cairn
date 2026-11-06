import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  fullCrossProduct,
  fullSize,
  NAMED_CELLS,
  pairwiseCells,
  randomCells,
} from './fixtures/legacy-oracle/cells.js';
import { releaseMatrixTemplate, runMatrix } from './fixtures/legacy-oracle/matrix.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});
afterAll(releaseMatrixTemplate);

function report(failures: ReturnType<typeof runMatrix>): string {
  return failures
    .slice(0, 40)
    .map((f) => `cell ${f.index} ${JSON.stringify(f.cell)}\n${f.message}`)
    .join('\n---\n');
}

function run(cells: Parameters<typeof runMatrix>[0]) {
  const dir = makeTestTempDir('migration-0115-oracle-');
  dirs.push(dir);
  return runMatrix(cells, dir);
}

describe('the boot data migration against the legacy routing code as the oracle', () => {
  test('every cell a Codex finding named', { timeout: 120_000 }, () => {
    const failures = run(Object.values(NAMED_CELLS));
    expect(failures.length, report(failures)).toBe(0);
  });

  test('every pair of factor values', { timeout: 120_000 }, () => {
    const failures = run(pairwiseCells(20260611));
    expect(failures.length, report(failures)).toBe(0);
  });

  test('5000 fixed-seed random cells from the full axis space', { timeout: 120_000 }, () => {
    const failures = run(randomCells(5000, 20260612));
    expect(failures.length, report(failures)).toBe(0);
  });
});

describe.skipIf(process.env.MIGRATION_ORACLE_FULL === undefined)('full cross product', () => {
  test('the cross product agrees with the legacy oracle', { timeout: 3_600_000 }, () => {
    const limit = Number(process.env.MIGRATION_ORACLE_N ?? fullSize());
    const failures = run(fullCrossProduct(limit, 20260613));
    process.stdout.write(
      `oracle full: ${Math.min(limit, fullSize())} cells, ${failures.length} failures\n`,
    );
    expect(failures.length, report(failures)).toBe(0);
  });
});
