import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, onTestFinished, test } from 'vitest';
import { testTempDir } from './test-temp-dir.js';

describe('test temporary directory lifetime', () => {
  let directory: string;
  const directories: string[] = [];

  afterAll(() => {
    for (const path of directories) expect(existsSync(path)).toBe(false);
  });

  afterEach(() => {
    expect(existsSync(join(directory, 'fixture'))).toBe(true);
  });

  test('keeps fixtures through teardown and releases them before the test finishes', () => {
    onTestFinished(() => {
      expect(existsSync(directory)).toBe(false);
    });
    directory = testTempDir('daemon-lifetime-');
    directories.push(directory);
    writeFileSync(join(directory, 'fixture'), 'owned');
  });

  test.fails('releases fixtures even when an assertion fails', () => {
    onTestFinished(() => {
      expect(existsSync(directory)).toBe(false);
    });
    directory = testTempDir('daemon-failure-');
    directories.push(directory);
    writeFileSync(join(directory, 'fixture'), 'owned');
    expect('failure').toBe('success');
  });
});
