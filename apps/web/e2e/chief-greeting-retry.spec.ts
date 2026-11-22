import { expect, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock';

test('a failed initial greeting retries once without sending an owner message', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  const channel = {
    ...THREAD,
    id: 'chief-project-opening',
    projectId: PROJECT.id,
    lastTurnAt: 12,
    retryGreetingStepId: 'failed-opening-2' as string | null,
  };
  const state = {
    threads: [channel],
    messages: [],
    channels: {
      [PROJECT.id]: [11, 12].map((at) => ({
        id: `error-${at}`,
        role: 'system',
        content: JSON.stringify({ kind: 'chief_turn_error', message: 'Connection error: EHOSTUNREACH' }),
        createdAt: at,
      })),
    },
    todos: [],
    tasks: [],
  };
  let retries = 0;
  const sent = await mockLive(page, state, (path, route, json) => {
    if (path.endsWith(`/retry-greeting/${channel.retryGreetingStepId}`)) {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({});
      retries++;
      state.threads = [{ ...channel, retryGreetingStepId: null }];
      return json(state.threads[0], 201);
    }
    return undefined;
  });
  await page.goto(`/app?project=${PROJECT.id}&chat=1`);
  await expect(page.getByTestId('chief-turn-error')).toHaveText(['Not finished']);
  await expect(page.getByTestId('chief-turn-retry')).toHaveCount(1);
  await expect(page.getByTestId('chief-stream')).not.toContainText('EHOSTUNREACH');
  await page.getByTestId('chief-turn-retry').click();
  await expect.poll(() => retries).toBe(1);
  await expect(page.getByTestId('chief-turn-retry')).toHaveCount(0);
  expect(sent).toEqual([]);
  state.channels[PROJECT.id] = [
    ...state.channels[PROJECT.id],
    { id: 'opening-reply', role: 'assistant', content: 'What would you like to build in cairn?', createdAt: 14 },
  ];
  await page.reload();
  await expect(page.getByTestId('chief-stream')).toContainText('What would you like to build in cairn?');
  await expect(page.getByTestId('chief-turn-retry')).toHaveCount(0);
  expect(sent).toEqual([]);
});
