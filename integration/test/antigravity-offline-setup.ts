import { vi } from 'vitest';

vi.mock('../../apps/daemon/src/backend/antigravity-managed.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../apps/daemon/src/backend/antigravity-managed.js')
  >()),
  createAntigravityManaged: () => ({
    current: () => null,
    ensure: async () => null,
    probe: async () => null,
  }),
}));
