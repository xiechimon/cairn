import { expect, test, vi } from 'vitest';
import { createCiPoller } from '../src/services/ci-loop.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer } from './helpers.js';

vi.mock('../src/services/ci-loop.js', () => ({
  CI_POLL_INTERVAL_MS: 60_000,
  createCiPoller: vi.fn(() => ({ sweep: async () => {} })),
}));

test('the scheduler passes its configured attachment storage to the product gate poller', () => {
  const s = bootServer();
  try {
    const logger = { info: vi.fn(), debug: vi.fn() };
    createScheduler(
      s.svc,
      { tickMs: 60_000 },
      { attachmentsDir: s.attachmentsDir, logger },
      { githubFetch: vi.fn(), logger },
    );
    expect(vi.mocked(createCiPoller).mock.calls.at(-1)?.[0].attachmentsDir).toBe(s.attachmentsDir);
  } finally {
    s.dispose();
  }
});
