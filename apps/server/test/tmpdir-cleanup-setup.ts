import { afterAll, afterEach, beforeEach } from 'vitest';
import { cleanupTestTempDirs } from '../../../scripts/test-tmpdir.mjs';
import { setGithubCreateGate } from '../src/lib/github.js';
import { installNetworkGuard, takeUnstubbedCalls } from './network-guard.js';

installNetworkGuard();

beforeEach(() => {
  setGithubCreateGate(async () => Date.now());
});

afterEach(() => {
  const calls = takeUnstubbedCalls();
  if (calls.length > 0)
    throw new Error(`server test made unstubbed network calls:\n${calls.join('\n')}`);
});

afterAll(() => {
  cleanupTestTempDirs();
});
