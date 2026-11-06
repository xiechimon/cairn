import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { settleTransitions } from '../e2e/helpers.js';
import { runRules } from './rules.js';

export const OUT = process.env.PR_SCREENS_OUT ?? 'pr-screens-out';
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const FROZEN_AT = new Date('2026-10-31T14:00:00+08:00');
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export const ONLY = process.env.PR_SCREENS_PAGES
  ? new Set(process.env.PR_SCREENS_PAGES.split(','))
  : undefined;

export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

mkdirSync(OUT, { recursive: true });

export async function prepare(page: Page, theme: Theme) {
  await page.clock.setFixedTime(FROZEN_AT);
  await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

export async function record(page: Page, key: string, theme: Theme, ready: Locator) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(ready).toBeVisible();
  await settleTransitions(page);
  await page.screenshot({
    path: join(OUT, `${key}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  const found = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.map((n) => n.target.join(' ')),
  }));
  writeFileSync(join(OUT, `${key}.axe.json`), `${JSON.stringify(found, null, 1)}\n`);
  try {
    const rules = await runRules(page);
    writeFileSync(join(OUT, `${key}.rules.json`), `${JSON.stringify(rules, null, 1)}\n`);
  } catch (error) {
    writeFileSync(join(OUT, `${key}.rules-error.txt`), `${String(error).slice(0, 600)}\n`);
  }
}

export function recordError(key: string, error: unknown) {
  writeFileSync(join(OUT, `${key}.error.txt`), `${String(error).slice(0, 600)}\n`);
}
