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
const searchInput = (page: Page) => searchDialog(page).getByLabel('搜索');
export const composerInput = (page: Page) =>
  page.getByTestId('home-c').getByTestId('chief-composer-input');

export async function expectTypedInFull(field: Locator, text: string): Promise<void> {
  await expect(field, `the capture must show "${text}" typing complete`).toHaveValue(text);
}

export async function typeIntoField(page: Page, field: Locator, text: string): Promise<void> {
  await expect(field).toBeVisible();
  if (!(await field.evaluate((node) => node === document.activeElement))) await field.click();
  await expect(field, 'typing starts in the focused field').toBeFocused();
  await expect(field, 'typing starts from an empty field').toHaveValue('');
  await page.keyboard.type(text);
  await expectTypedInFull(field, text);
}

export const PAGES: AuditPage[] = [
  {
    name: 'search',
    url: '/app?scenario=01&pane=tasks&tab=scheduled',
    open: async (page) => {
      await page.waitForSelector('.board-sidebar', { state: 'attached' });
      await pressAndExpect(page, 'Meta+k', searchDialog(page));
      await typeIntoField(page, searchInput(page), 'probe');
    },
    ready: (p) => searchDialog(p).locator('[data-row-kind="todo"]').first(),
  },
  {
    name: 'new task home composer',
    url: '/app?scenario=01&pane=tasks&tab=scheduled',
    open: async (page) => {
      await page.getByTestId('sidebar-reopen').click();
      await page.mouse.move(700, 400);
      await page
        .getByRole('complementary')
        .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })
        .click();
    },
    ready: (p) => p.getByTestId('home-c').getByTestId('chief-composer-input'),
  },
  {
    name: 'new task home composer filled',
    url: '/app?scenario=01&pane=tasks&tab=scheduled',
    open: async (page) => {
      await page.getByTestId('sidebar-reopen').click();
      await page.mouse.move(700, 400);
      await page
        .getByRole('complementary')
        .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })
        .click();
      await typeIntoField(page, composerInput(page), 'probe');
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
  {
    name: 'schedules list',
    url: '/app?scenario=r3-93&pane=tasks&tab=scheduled',
    ready: (p) => p.locator('[data-slot="schedule-row"]').first(),
  },
  {
    name: 'schedules form',
    url: '/app?scenario=r3-93&pane=tasks&tab=scheduled',
    open: (page) => page.locator('[data-slot="schedule-row"]').first().click(),
    ready: (p) => p.getByTestId('schedule-popover'),
  },
  {
    name: 'project settings',
    url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c',
    ready: (p) => p.getByTestId('project-icon-trigger'),
  },
  {
    name: 'machines',
    url: '/app/settings/machines?scenario=06',
    ready: (p) => p.getByTestId('machine-item').first(),
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
  {
    name: 'usage',
    url: '/app/usage?scenario=home-c',
    ready: (p) => p.locator('[data-day]').first(),
  },
  {
    name: 'settings routing',
    url: '/app/settings/routing?scenario=model-routing',
    ready: (p) => p.locator('[data-instance-id]').first(),
  },
  {
    name: 'settings im',
    url: '/app/settings/im?scenario=01',
    ready: (p) => p.getByTestId('page-col'),
  },
  {
    name: 'project new',
    url: '/app/project/new?scenario=01',
    ready: (p) => p.locator('#prj-new-repo'),
  },
  {
    name: 'todo detail',
    url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27',
    ready: (p) => p.getByTestId('composer-card'),
  },
  {
    name: 'machines authorize',
    url: '/app/machines/authorize?scenario=06',
    ready: (p) => p.getByRole('region', { name: '授权执行机' }),
  },
  {
    name: 'tray',
    url: '/tray?scenario=home-c',
    ready: (p) => p.locator('body'),
  },
];
