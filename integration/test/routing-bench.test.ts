import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { benchTaskProblems, CAIRN_BENCH_TASKS, seedWorkdir } from '../eval/routing/bench.mts';
import { runOracle } from '../eval/routing/oracle.mts';
import { REFERENCE_FILES } from './routing-reference.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-routing-fixture-'));
  directories.push(directory);
  return directory;
}

describe('#1984 routing benchmark fixtures', () => {
  test('at least twenty tasks are valid, unique, and independently covered', () => {
    expect(CAIRN_BENCH_TASKS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CAIRN_BENCH_TASKS.map((task) => task.id)).size).toBe(CAIRN_BENCH_TASKS.length);
    expect(Object.keys(REFERENCE_FILES).sort()).toEqual(
      CAIRN_BENCH_TASKS.map((task) => task.id).sort(),
    );
    for (const task of CAIRN_BENCH_TASKS) expect(benchTaskProblems(task), task.id).toEqual([]);
  });

  test('every untouched throwing stub fails the actual oracle', () => {
    for (const task of CAIRN_BENCH_TASKS) {
      const directory = workspace();
      seedWorkdir(directory, task);
      expect(readdirSync(directory, { recursive: true }).sort()).toEqual(
        [
          ...new Set(Object.keys(task.seedFiles).flatMap((path) => [path.split('/')[0], path])),
        ].sort(),
      );
      for (const path of Object.keys(task.oracle.files)) {
        expect(() => readFileSync(join(directory, path))).toThrow();
      }
      const result = runOracle(directory, task);
      expect(result.pass, `${task.id}: ${result.output}`).toBe(false);
      expect(result.output).toContain('not implemented');
      for (const [path, content] of Object.entries(task.oracle.files)) {
        expect(readFileSync(join(directory, path), 'utf8')).toBe(content);
      }
    }
  });

  test('independent references pass every actual oracle subprocess', () => {
    for (const task of CAIRN_BENCH_TASKS) {
      const directory = workspace();
      seedWorkdir(directory, task);
      const references = REFERENCE_FILES[task.id];
      if (!references) throw new Error(`Missing reference: ${task.id}`);
      for (const [path, content] of Object.entries(references))
        writeFileSync(join(directory, path), content);
      const result = runOracle(directory, task);
      expect(result.pass, `${task.id}: ${result.output}`).toBe(true);
    }
  });

  test('word-wrap checks width four and preserves the exact width-five fit', () => {
    const task = CAIRN_BENCH_TASKS.find((entry) => entry.id === 'word-wrap');
    if (!task) throw new Error('Missing word-wrap');
    const oracle = Object.values(task.oracle.files).join('\n');
    expect(oracle).toContain("assert.equal(wrapText('a b c', 4), 'a b\\nc');");
    expect(oracle).toContain("assert.equal(wrapText('a b c', 5), 'a b c');");
    expect(task.prompt).toContain('wrapText("a b c", 4)');
    expect(task.prompt).toContain('wrapText("a b c", 5)');
  });
});
