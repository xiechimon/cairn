import { expect, type Locator, type Page } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

export interface AuditPage {
  name: string;
  url: string;
  ready: (page: Page) => Locator;
  open?: (page: Page) => Promise<void>;
}

const row = (page: Page) => page.getByTestId('resource-row').first();
const card = (page: Page) => page.getByTestId('page-col').locator('.settings-card').first();
const sideChat = (page: Page) => page.getByTestId('side-chat');
const searchDialog = (page: Page) => page.getByRole('dialog', { name: '搜索' });

export const PAGES: AuditPage[] = [
  {
    name: 'search',
    url: '/app/schedules?scenario=01',
    open: async (page) => {
      await pressAndExpect(page, 'Meta+k', searchDialog(page));
      await page.keyboard.type('probe');
    },
    ready: (p) => searchDialog(p).locator('[data-row-kind="todo"]').first(),
  },
  {
    name: 'new task home composer',
    url: '/app/schedules?scenario=01',
    open: (page) =>
      page.getByRole('complementary').locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' }).click(),
    ready: (p) => p.getByTestId('home-c').getByTestId('chief-composer-input'),
  },
  {
    name: 'new task home composer filled',
    url: '/app/schedules?scenario=01',
    open: async (page) => {
      await page
        .getByRole('complementary')
        .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })
        .click();
      const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
      await expect(input).toBeVisible();
      await page.keyboard.type('probe');
      await expect(input).toBeFocused();
    },
    ready: (p) => p.getByTestId('home-c').getByTestId('chief-composer-input'),
  },
  { name: 'side chat fresh', url: '/app?scenario=23&thread=fresh-probe', ready: sideChat },
  {
    name: 'side chat confirm',
    url: '/app?scenario=17b&thread=7ve0iOkQ-JBpSL98zSiGc',
    ready: sideChat,
  },
  {
    name: 'side chat review',
    url: '/app?scenario=27&thread=7ve0iOkQ-JBpSL98zSiGc',
    ready: sideChat,
  },
  {
    name: 'side chat tool calls',
    url: '/app?scenario=28&thread=7ve0iOkQ-JBpSL98zSiGc',
    open: async (p) => {
      await p.mouse.move(0, 0);
      await p.waitForTimeout(500);
    },
    ready: (p) => p.getByTestId('work-call').first(),
  },
  { name: 'schedules list', url: '/app/schedules?scenario=r3-93', ready: (p) => p.locator('.sched-card').first() },
  { name: 'schedules form', url: '/app/schedules?scenario=r3-92', ready: (p) => p.getByRole('dialog', { name: '新建定时' }) },
  {
    name: 'project tasks',
    url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX/files?scenario=prj-tasks&tab=tasks',
    ready: (p) => p.getByTestId('task-row').first(),
  },
  {
    name: 'project settings',
    url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c',
    ready: (p) => p.locator('.prj-set-avatar'),
  },
  { name: 'team', url: '/app/team?scenario=12', ready: (p) => p.getByTestId('team-agents-removed') },
  {
    name: 'machines',
    url: '/app/settings/machines?scenario=06',
    ready: (p) => p.getByTestId('machine-item').first(),
  },
  {
    name: 'machine detail',
    url: '/app/settings/machines?scenario=06&machine=Kd8fG2hJ4mN9pQ1rStUvWx3',
    ready: (p) => p.getByTestId('machine-detail'),
  },
  { name: 'skills', url: '/app/resources/skills?scenario=06', ready: row },
  {
    name: 'providers',
    url: '/app/resources/providers?scenario=01',
    ready: (p) => p.getByTestId('provider-editor'),
  },
  {
    name: 'secrets',
    url: '/app/resources/secrets?scenario=01',
    ready: (p) => p.getByTestId('resource-empty'),
  },
  { name: 'mcp servers', url: '/app/resources/mcp-servers?scenario=07', ready: row },
  { name: 'api keys', url: '/app/api-keys?scenario=api-keys-created', ready: card },
  { name: 'account', url: '/app/account?scenario=13', ready: card },
];
