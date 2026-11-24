import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';
import { findLowContrast } from './contrast-probe';

const NOW = Date.UTC(2026, 10, 16, 16);
const MODELS = [{ id: 'current-model', name: 'Current model' }];
const LONG_NAME = 'Claude subscription — International Design and Engineering Workspace';
const ACCOUNTS = [
  { id: 'weekly', label: LONG_NAME, state: 'ok', utilization: 0.7 },
  { id: 'low', label: 'Claude low quota', state: 'ok', utilization: 0.93 },
  { id: 'cooling', label: 'Claude cooling', state: 'cooling' },
  { id: 'exhausted', label: 'Claude exhausted', state: 'exhausted' },
  { id: 'expired', label: 'Claude expired', state: 'expired' },
  { id: 'update', label: 'Claude model update', state: 'ok' },
].map(({ id, label, state, utilization }) => ({
  id,
  label,
  state,
  kind: 'claude-subscription',
  expiresAt: state === 'expired' ? NOW - 1 : null,
  createdAt: NOW,
  models: id === 'update' ? [{ id: 'new-model', name: 'New model' }] : MODELS,
  windows: utilization === undefined ? [] : [{
    name: 'seven_day', utilization, resetsAt: null, observedAt: NOW,
  }],
}));
const PROVIDERS = ['unchecked', 'failed'].map((id) => ({
  id,
  label: `Team ${id}`,
  kind: 'custom',
  providerId: 'relay-fixture',
  baseUrl: 'https://models.example.test/v1',
  api: 'openai-completions',
  authHeader: false,
  compat: {},
  models: MODELS,
  configurationFingerprint: id.repeat(8),
  createdBy: 'fixture-owner',
  createdAt: NOW,
  updatedAt: NOW,
}));

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`A3 R1 V29: every status at once, fixture screenshots (${width}px, ${theme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
        if (path === '/api/teams/t1/claude-subscriptions') return json(ACCOUNTS);
        if (path === '/api/teams/t1/devin-subscriptions') return json([{
          id: 'devin', kind: 'devin-subscription', label: 'Devin without quota',
          expiresAt: null, createdAt: NOW, models: [{ id: 'swe-2', name: 'SWE-2' }],
        }]);
        if (path === '/api/teams/t1/antigravity-subscriptions') return json([]);
        if (path === '/api/teams/t1/providers')
          return json({ presets: [], providers: PROVIDERS, canTestConnection: true });
        if (path === '/api/teams/t1/model-sources') return json({ sources: [{
          runtime: 'claude-code', installed: true, hostname: 'fixture-runner',
          models: [{ id: 'new-model', name: 'New model', updateRequired: {
            runtime: 'claude-code', current: '2.0.0', required: '2.1.0',
          } }],
        }] });
        if (path === '/api/teams/t1/model-routing') return json({ edges: [], connections: [], quota: [] });
        if (path === '/api/teams/t1/providers/failed/test') return json({
          configurationFingerprint: PROVIDERS[1]!.configurationFingerprint,
          status: 'failed', failure: 'network', reason: null,
          detail: null, httpStatus: null, latencyMs: null,
        });
        return undefined;
      });
      await page.goto('/app/resources/providers');
      const list = page.getByTestId('provider-list');
      const row = (id: string) => list.locator(`[data-instance-id="${id}"]`);
      await row('provider:failed').getByRole('button').first().click();
      await page.getByTestId('provider-editor').getByRole('button', { name: '测试 current-model' }).click();
      await expect(page.getByTestId('model-test-result')).toHaveAttribute('data-phase', 'failed');
      await page.keyboard.press('Escape');
      await row('subscription:weekly').getByRole('button').first().click();
      const marks = list.getByTestId('provider-status-mark');
      await expect(marks).toHaveCount(9);
      const expectedStatuses = ['cooling', 'exhausted', 'expired', 'fail', 'off', 'ok', 'warn'];
      expect(await marks.evaluateAll((elements) => [...new Set(elements.map((element) => element.getAttribute('data-status')))].sort())).toEqual(expectedStatuses);
      const glyphs = await marks.evaluateAll((elements) => elements.map((element) => ({
        status: element.getAttribute('data-status'),
        glyph: [...element.querySelector('svg')!.classList].find((name) => name.startsWith('lucide-')),
        name: element.getAttribute('aria-label'),
      })));
      expect(new Set(glyphs.map(({ glyph }) => glyph)).size, 'A3: seven statuses have seven glyphs').toBe(7);
      expect(glyphs.every(({ glyph, name }) => glyph !== undefined && Boolean(name))).toBe(true);
      for (const instance of await list.getByTestId('provider-instance').all()) {
        await expect(instance.getByTestId('provider-subtitle')).not.toContainText(/更新|新版|最近使用|尚未使用/);
        const box = await instance.boundingBox();
        const mark = await instance.getByTestId('provider-status-mark').boundingBox();
        if (box === null || mark === null) throw new Error('V29: row and status need measurable geometry');
        expect(mark.width, 'V29: the status glyph uses the 16px slot').toBe(16);
        expect(mark.x, 'V29: the status stays on the right of the row').toBeGreaterThan(box.x + box.width / 2);
      }
      const available = row('subscription:low');
      for (const state of ['normal', 'hover', 'selected'] as const) {
        if (state === 'normal') await row('subscription:weekly').hover();
        if (state === 'hover') await available.hover();
        if (state === 'selected') {
          await available.getByRole('button').first().click();
          await row('subscription:weekly').hover();
        }
        await expect(available.getByTestId('provider-status-mark')).toHaveAttribute('data-status', 'ok');
        expect(await findLowContrast(page, '[data-instance-id="subscription:low"]'), `A3: Available glyph reaches 3:1 on ${state} rows (${theme})`).toEqual([]);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'R1: no horizontal overflow').toBeLessThanOrEqual(width);
      const prefix = `/tmp/tidy-r17-shots/statuses-${width}-${theme}`;
      await page.screenshot({ path: `${prefix}-page.png`, fullPage: true });
      await list.screenshot({ path: `${prefix}-list.png` });
      for (const id of ['weekly', 'low', 'devin', 'update']) {
        await row(`subscription:${id}`).getByRole('button').first().click();
        const detail = page.getByTestId('subscription-detail');
        await expect(detail).toHaveAttribute('data-account-id', id);
        if (id === 'weekly' || id === 'low') {
          const badge = row(`subscription:${id}`).getByTestId('subscription-quota-mini');
          await expect(badge).toHaveText(id === 'weekly' ? '剩 30%' : '剩 7%');
          await expect(detail.getByTestId('subscription-quota-remaining')).toHaveText((await badge.textContent())!);
        }
        if (id === 'devin') {
          await expect(row('subscription:devin').getByTestId('subscription-quota-mini')).toHaveCount(0);
          await expect(detail.getByTestId('subscription-usage-note')).toHaveText('Devin 不提供剩余用量');
        }
        if (id === 'update') await expect(detail).toContainText('1 个模型需要新版 Cairn');
        await detail.screenshot({ path: `${prefix}-${id}-detail.png` });
      }
    });
  }
}
