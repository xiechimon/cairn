import { fileURLToPath } from 'node:url';
import { afterAll, afterEach } from 'vitest';
import {
  installNetworkGuard,
  takeUnstubbedNetworkCalls,
} from '../../scripts/test-network-guard.mjs';
import { cleanupTestTempDirs } from '../../scripts/test-tmpdir.mjs';

installNetworkGuard({ suite: 'integration' });
process.env.CAIRN_AGENT_IMPORT_HOME = fileURLToPath(new URL('./no-agent-config', import.meta.url));

afterEach(() => {
  const calls = takeUnstubbedNetworkCalls();
  if (calls.length > 0) {
    throw new Error(`integration test made unstubbed network calls:\n${calls.join('\n')}`);
  }
});

afterAll(() => {
  try {
    const calls = takeUnstubbedNetworkCalls();
    if (calls.length > 0) {
      throw new Error(`integration test made unstubbed network calls:\n${calls.join('\n')}`);
    }
  } finally {
    cleanupTestTempDirs();
  }
});
