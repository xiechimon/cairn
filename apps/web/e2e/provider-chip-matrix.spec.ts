import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const providers = [
  { path: 'claude', id: 'claude', label: 'Claude 订阅', kind: 'claude-subscription', model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { path: 'antigravity', id: 'agy', label: 'Antigravity', kind: 'antigravity-subscription', model: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
  { path: 'devin', id: 'devin', label: 'Devin 订阅', kind: 'devin-subscription', model: 'swe-2-flash', name: 'SWE-2 Flash' },
  { path: 'providers', id: 'endpoint', label: 'anthropic-ultra', kind: 'custom', model: 'claude-opus-5-5-long-context-preview-2026-11-28', name: 'Claude Opus 5.5 Long Context Preview' },
  { path: 'providers', id: 'chatgpt', label: 'ChatGPT', kind: 'custom', model: 'gpt-6.2', name: 'GPT-6.2' },
] as const;

const passing = { status: 'ok', failure: null, reason: null, detail: null, httpStatus: null, latencyMs: 317 };
const failing = { status: 'failed', failure: 'upstream', reason: 'upstream', detail: null, httpStatus: null, latencyMs: null };

for (const [width, colorScheme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']] as const) {
  test(`model chip matrix (${width}, ${colorScheme})`, async ({ page }, info) => {
    const before = process.env.MODEL_CHIP_MATRIX_BEFORE === '1';
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.addInitScript((theme) => localStorage.setItem('cairn-theme', theme), colorScheme);
    let complete: ((value: object) => void) | undefined;
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path === '/api/teams/t1/providers') return json({
        presets: [], canTestConnection: true,
        providers: providers.filter((p) => p.path === 'providers').map((p) => ({
          ...p, createdAt: 1, updatedAt: 1, createdBy: 'u1',
          baseUrl: p.id === 'chatgpt' ? 'https://chatgpt.com/backend-api' : 'https://api.anthropic.com',
          api: p.id === 'chatgpt' ? 'openai-codex-responses' : 'anthropic-messages',
          providerId: p.id === 'chatgpt' ? 'openai-codex' : 'anthropic-ultra',
          compat: {}, authHeader: true, models: [{ id: p.model, name: p.name }],
        })),
      });
      if (path.endsWith('/test')) return new Promise<object>((resolve) => { complete = resolve; }).then(json);
      const account = providers.find((p) => path === `/api/teams/t1/${p.path}-subscriptions`);
      if (account) return json([{
        id: account.id, kind: account.kind, label: account.label, expiresAt: null, enabled: true, enabledAt: 1,
        createdAt: 1, lastUsedAt: null, stepsLast24h: 2, hasToken: true,
        models: [{ id: before && account.id === 'devin' ? 'swe-2-flash-medium' : account.model, name: account.name }],
      }]);
      if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
      return undefined;
    });
    for (const provider of providers) {
      const team = provider.path === 'providers';
      await page.goto(`/app/resources/providers?item=${team ? 'provider' : 'subscription'}:${provider.id}`);
      const detail = page.getByTestId(team ? 'provider-editor' : 'subscription-detail');
      const chipId = before && provider.id === 'devin' ? 'swe-2-flash-medium' : provider.model;
      const chip = detail.locator(`[data-model-id="${chipId}"]`);
      await expect(chip).toBeVisible();
      await chip.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath(`${provider.id}.png`) });
      if (before) continue;
      if (provider.id === 'devin') {
        await expect(chip).toContainText('SWE-2 Flash');
        await expect(chip).not.toContainText('medium');
      }
      const play = chip.getByRole('button', { name: `测试 ${provider.model}` });
      await expect(play).toBeVisible();
      await expect(detail.getByRole('button', { name: '全部测试' })).toBeVisible();
      if (provider.id !== 'agy') continue;
      const report = page.getByTestId('model-test-result');
      for (const [phase, result] of [['passed', passing], ['failed', failing]] as const) {
        complete = undefined;
        await play.click();
        await expect(report).toHaveAttribute('data-phase', 'checking');
        await expect.poll(() => typeof complete).toBe('function');
        if (phase === 'passed') await page.screenshot({ path: info.outputPath('running.png') });
        (complete as ((value: object) => void) | undefined)?.(result);
        await expect(report).toHaveAttribute('data-phase', phase);
        await page.screenshot({ path: info.outputPath(`${phase}.png`) });
        await page.keyboard.press('Escape');
        await expect(report).toHaveCount(0);
      }
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}
