import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock.js';

test('an unpaired browser waiting on a machine enrollment link is not reloaded by the enrollment poll', async ({
  page,
}) => {
  let polls = 0;
  let documents = 0;
  page.on('load', () => {
    documents += 1;
  });
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/machine/enroll/poll') {
      polls += 1;
      return json({ status: 'pending', name: 'studio' });
    }
    if (path.startsWith('/api/remote/')) return undefined;
    return json({ error: 'unauthorized' }, 401);
  });
  await page.goto('/app/machines/authorize?enroll=enr_123');
  await expect.poll(() => polls, { timeout: 10_000 }).toBeGreaterThan(3);
  expect(documents).toBe(1);
});
