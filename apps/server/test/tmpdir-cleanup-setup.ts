import { afterAll, afterEach } from 'vitest';
import { cleanupTestTempDirs } from '../../../scripts/test-tmpdir.mjs';
import { installNetworkGuard, takeUnstubbedCalls } from './network-guard.js';

installNetworkGuard();

afterEach(() => {
  const calls = takeUnstubbedCalls();
  if (calls.length > 0)
    throw new Error(`server test made unstubbed network calls:\n${calls.join('\n')}`);
});

afterAll(() => {
  cleanupTestTempDirs();
});
