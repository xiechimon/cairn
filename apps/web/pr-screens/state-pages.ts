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
  mock?: (page: Page) => Promise<void>;
  open?: (page: Page) => Promise<void>;
  ready: (page: Page) => Locator;
}

const PROVIDERS_API = '**/api/teams/*/providers*';
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
    mock: (page) => page.route(PROVIDERS_API, () => new Promise(() => undefined)),
    ready: pageColumn,
  },
  {
    name: 'settings error',
    url: () => '/app/resources/providers',
    world: 'seeded',
    mock: (page) =>
      page.route(PROVIDERS_API, (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
      ),
    ready: pageColumn,
  },
];
