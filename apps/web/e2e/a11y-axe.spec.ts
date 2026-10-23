import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressUntil, settleTransitions } from './helpers.js';

// #1442: axe-core (WCAG 2.1 A/AA) over the main pages, light and dark. Any
// violation fails the test with its rule id, impact and first targets.
//
// Failure modes this file pins:
//  1. A control loses its accessible name (button-name, label, link-name):
//     agent detail's four settings selects and machine detail's evacuate
//     select had none before #1442.
//  2. A colour change drops text below 4.5:1 (color-contrast) in either theme.
//  3. ARIA misuse (aria-allowed-attr, aria-required-children, …) on any of
//     these pages.
//  4. A false green: the scan runs before the page renders. Each page waits
//     for its own body content (`ready`), not the shell heading, first.
//  5. A false dark run: the stored theme does not take. The test checks
//     <html data-theme> before scanning.
//
// axe does not check `::placeholder` contrast, so native placeholders on
// --secondary (composer, chief composer) are held by DESIGN.md, not here.

// Every test opens its own page, so the file runs in parallel (the config
// default is one worker per file).
test.describe.configure({ mode: 'parallel' });

interface AuditPage {
  name: string;
  url: string;
  /** Body content that proves the page rendered (failure mode 4). */
  ready: (page: Page) => Locator;
  open?: (page: Page) => Promise<void>;
}

const row = (page: Page) => page.getByTestId('resource-row').first();
const card = (page: Page) => page.getByTestId('page-col').locator('.settings-card').first();
const phaseChip = (page: Page) => page.getByTestId('phase-chip');
const searchDialog = (page: Page) => page.getByRole('dialog', { name: '搜索' });

const PAGES: AuditPage[] = [
  { name: 'board', url: '/app?scenario=board-drag-matrix', ready: (p) => p.locator('[data-todo-id]').first() },
  {
    name: 'board search',
    url: '/app?scenario=01',
    open: async (page) => {
      await pressUntil(page, 'Meta+k', searchDialog(page));
      await page.keyboard.type('probe');
    },
    ready: (p) => searchDialog(p).locator('[data-row-kind="todo"]').first(),
  },
  {
    name: 'new task dialog',
    url: '/app?scenario=01',
    open: (page) => page.locator('.sidebar-new-task').click(),
    ready: (p) => p.getByRole('dialog', { name: '新建任务' }),
  },
  { name: 'detail fresh', url: '/app/todo/fresh-probe?scenario=23', ready: phaseChip },
  { name: 'detail confirm', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b', ready: phaseChip },
  { name: 'detail review', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27', ready: phaseChip },
  {
    name: 'detail tool calls',
    url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=28',
    ready: (p) => p.getByTestId('tool-pill').first(),
  },
  { name: 'chief window', url: '/app?scenario=100', ready: (p) => p.locator('.chief-drawer') },
  { name: 'schedules list', url: '/app/schedules?scenario=r3-93', ready: (p) => p.locator('.sched-card').first() },
  { name: 'schedules form', url: '/app/schedules?scenario=r3-92', ready: (p) => p.getByRole('dialog', { name: '新建定时' }) },
  {
    name: 'project tasks',
    url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks',
    ready: (p) => p.getByTestId('task-row').first(),
  },
  {
    name: 'project settings',
    url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c',
    ready: (p) => p.locator('.prj-set-avatar'),
  },
  { name: 'team', url: '/app/team?scenario=12', ready: (p) => p.getByTestId('team-agent-card').first() },
  {
    name: 'agent detail',
    url: '/app/resources/agents/r3-builder?scenario=agent-detail',
    ready: (p) => p.locator('.agent-skill-select'),
  },
  { name: 'machines', url: '/app/resources/machines?scenario=06', ready: row },
  {
    name: 'machine detail',
    url: '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06',
    ready: (p) => p.getByTestId('team-agent-grid'),
  },
  { name: 'skills', url: '/app/resources/skills?scenario=06', ready: row },
  {
    name: 'providers',
    url: '/app/resources/providers?scenario=01',
    ready: (p) => p.getByTestId('runtime-empty'),
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

for (const theme of ['light', 'dark'] as const) {
  for (const p of PAGES) {
    test(`axe: ${p.name} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
      // Reduced motion ends the dialog fade/zoom keyframes at once (motion.css),
      // so color-contrast reads final colours; settleTransitions below covers
      // the transitions it leaves alone.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(p.url);
      if (p.open) await p.open(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(p.ready(page)).toBeVisible();
      await settleTransitions(page);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const found = violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
      expect(found, `axe violations on ${p.name} (${theme})`).toEqual([]);
    });
  }
}
