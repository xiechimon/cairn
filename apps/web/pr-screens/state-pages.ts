import type { Locator, Page } from '@playwright/test';

export interface LiveState {
  teamId: string;
  projectId: string;
  todoIds: Record<string, string>;
}

export interface StatePage {
  name: string;
  url: (state: LiveState) => string;
  world: 'empty' | 'seeded';
  mock?: (page: Page) => Promise<() => Promise<void>>;
  open?: (page: Page) => Promise<void>;
  ready: (page: Page) => Locator;
}

const PROVIDERS_API = '**/api/teams/*/providers*';
const waitForHits = (hits: () => number, wanted: number) => async () => {
  const deadline = Date.now() + 15_000;
  while (hits() < wanted) {
    if (Date.now() > deadline) throw new Error(`providers API was hit ${hits()} of ${wanted} times`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const pageColumn = (page: Page) => page.getByTestId('page-col');

export const STATE_PAGES: StatePage[] = [
  {
    name: 'first run home',
    url: () => '/app',
    world: 'empty',
    ready: (page) => page.getByText('0 台在线'),
  },
  {
    name: 'pending question',
    url: () => '/app',
    world: 'seeded',
    open: (page) => page.getByTestId('chief-question-entry').click(),
    ready: (page) => page.getByTestId('chief-question-panel').getByText('PR #42 只改了 README'),
  },
  {
    name: 'failed thread',
    url: (state) => `/app?thread=${state.todoIds.failed}`,
    world: 'seeded',
    ready: (page) => page.getByRole('button', { name: '重试' }),
  },
  {
    name: 'offline machine',
    url: () => '/app/resources/machines',
    world: 'seeded',
    ready: (page) => page.getByTestId('resource-row').filter({ hasText: 'xmons-mac' }).getByText('离线'),
  },
  {
    name: 'settings loading',
    url: () => '/app/resources/providers',
    world: 'seeded',
    mock: async (page) => {
      let hits = 0;
      await page.route(PROVIDERS_API, () => {
        hits += 1;
        return new Promise(() => undefined);
      });
      return waitForHits(() => hits, 1);
    },
    ready: pageColumn,
  },
  {
    name: 'settings error',
    url: () => '/app/resources/providers',
    world: 'seeded',
    mock: async (page) => {
      let hits = 0;
      await page.route(PROVIDERS_API, (route) => {
        hits += 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
      });
      return waitForHits(() => hits, 2);
    },
    ready: (page) => page.getByTestId('page-col').getByText('尚未添加服务商'),
  },
];
