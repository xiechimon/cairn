import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';
import { evidencePanelShot, evidenceShot } from './evidence.js';

const NOW = Date.UTC(2026, 10, 25, 15, 0);

const MIXED_USAGE = {
  rows: [
    {
      buildId: THREAD.id,
      model: 'anthropic-ultra/claude-haiku-5-5',
      input: 1200,
      output: 400,
      cacheRead: 12_000,
      cacheWrite: 300,
      costInput: 0.01,
      costOutput: 0.02,
      costCacheRead: 0.01,
      costCacheWrite: 0.01,
      costTotal: 0.05,
    },
    {
      buildId: THREAD.id,
      model: 'anthropic-ultra/claude-opus-5-5',
      input: 800,
      output: 300,
      cacheRead: 8_000,
      cacheWrite: 200,
      costInput: 0.02,
      costOutput: 0.03,
      costCacheRead: 0.01,
      costCacheWrite: 0.01,
      costTotal: 0.07,
    },
    {
      buildId: THREAD.id,
      model: 'claude-code/claude-opus-5-5',
      input: 900,
      output: 350,
      cacheRead: 9_000,
      cacheWrite: 150,
      costInput: 0.02,
      costOutput: 0.03,
      costCacheRead: 0.01,
      costCacheWrite: 0.01,
      costTotal: 0.07,
    },
    {
      buildId: THREAD.id,
      model: 'domestic-proxy/MiniMax-M3',
      input: 500,
      output: 200,
      cacheRead: 0,
      cacheWrite: 0,
      costInput: 0.005,
      costOutput: 0.005,
      costCacheRead: 0,
      costCacheWrite: 0,
      costTotal: 0.01,
    },
    {
      buildId: THREAD.id,
      model: 'workbuddy/deepseek-v4.1-flash',
      input: 600,
      output: 250,
      cacheRead: 0,
      cacheWrite: 0,
      costInput: 0.002,
      costOutput: 0.003,
      costCacheRead: 0,
      costCacheWrite: 0,
      costTotal: 0.005,
    },
    {
      buildId: THREAD.id,
      model: 'swe-2-1-medium',
      input: 1500,
      output: 600,
      cacheRead: 22_000,
      cacheWrite: 400,
      costInput: 0.03,
      costOutput: 0.04,
      costCacheRead: 0.01,
      costCacheWrite: 0.01,
      costTotal: 0.09,
    },
  ],
  durationSeconds: 94,
  engines: ['Claude Code', 'Devin'],
  machines: ['xmonsMac-3574.local', 'Ians-Mac-mini'],
  turns: 8,
  latest: {
    engine: 'Devin',
    engineRuntime: 'devin',
    model: {
      raw: 'swe-2-1-medium',
      provider: 'devin',
      providerLabel: 'Devin',
      modelId: 'swe-2-1-medium',
      modelName: 'SWE-2.1',
      runtime: 'devin',
    },
    machine: {
      id: 'm-mini',
      name: 'Ians-Mac-mini',
      osPlatform: 'darwin',
    },
  },
  models: [
    {
      raw: 'swe-2-1-medium',
      provider: 'devin',
      providerLabel: 'Devin',
      modelId: 'swe-2-1-medium',
      modelName: 'SWE-2.1',
      runtime: 'devin',
    },
    {
      raw: 'anthropic-ultra/claude-haiku-5-5',
      provider: 'anthropic-ultra',
      providerLabel: 'Anthropic Ultra',
      modelId: 'claude-haiku-5-5',
      modelName: 'Claude Haiku 5.5',
      runtime: 'pi',
    },
    {
      raw: 'anthropic-ultra/claude-opus-5-5',
      provider: 'anthropic-ultra',
      providerLabel: 'Anthropic Ultra',
      modelId: 'claude-opus-5-5',
      modelName: 'Claude Opus 5.5',
      runtime: 'pi',
    },
    {
      raw: 'claude-code/claude-opus-5-5',
      provider: 'claude-code',
      providerLabel: 'Claude Code',
      modelId: 'claude-opus-5-5',
      modelName: 'Claude Opus 5.5',
      runtime: 'claude-code',
    },
    {
      raw: 'domestic-proxy/MiniMax-M3',
      provider: 'domestic-proxy',
      providerLabel: 'Domestic Proxy',
      modelId: 'MiniMax-M3',
      modelName: 'MiniMax-M3',
      runtime: 'pi',
    },
    {
      raw: 'workbuddy/deepseek-v4.1-flash',
      provider: 'workbuddy',
      providerLabel: 'WorkBuddy',
      modelId: 'deepseek-v4.1-flash',
      modelName: 'DeepSeek V4.1 Flash',
      runtime: 'pi',
    },
  ],
  machineDetails: [
    { id: 'm-mini', name: 'Ians-Mac-mini', osPlatform: 'darwin' },
    { id: 'm-mac', name: 'xmonsMac-3574.local', osPlatform: 'darwin' },
  ],
};

async function setupCoordinator(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-theme', value);
    let menuListener: ((cmd: string) => void) | null = null;
    (
      window as Window & {
        cairnDesktop?: unknown;
        __emitMenu?: (cmd: string) => void;
      }
    ).cairnDesktop = {
      menu: {
        subscribe: (fn: (cmd: string) => void) => {
          menuListener = fn;
          return () => {
            menuListener = null;
          };
        },
      },
    };
    (window as Window & { __emitMenu?: (cmd: string) => void }).__emitMenu = (cmd: string) => {
      menuListener?.(cmd);
    };
  }, theme);

  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        { id: 'm1', role: 'user', content: 'Inspect context usage', createdAt: NOW - 10_000 },
        { id: 'm2', role: 'assistant', content: 'Ready.', createdAt: NOW - 5_000 },
      ],
      machines: [
        {
          id: 'm-mini',
          name: 'Ians-Mac-mini',
          online: true,
          capabilities: { osPlatform: 'darwin' },
        },
        {
          id: 'm-mac',
          name: 'xmonsMac-3574.local',
          online: true,
          capabilities: { osPlatform: 'darwin' },
        },
      ],
    },
    (path, _route, json) => {
      if (path === '/api/teams/t1/chief') {
        return json({
          chief: {
            id: 'chief-u1-t1',
            userId: 'u1',
            teamId: 't1',
            agent: { agentId: 'agent-1' },
            lastTurnAt: NOW - 5_000,
            createdAt: 0,
            tz: null,
          },
          agentActor: {
            id: 'agent-1',
            displayName: 'r5-scribe',
            description: null,
            status: 'active',
            avatarUrl: null,
            provider: 'devin',
            modelId: 'swe-2-1-medium',
            thinkingLevel: null,
            tools: [],
            secrets: [],
            defaultSkill: null,
            skillsAllowlist: null,
            mcpServers: [],
          },
          context: {
            tokens: 48_000,
            contextWindow: 200_000,
            compactAt: 150_000,
            resume: 'warm',
            resumeExpiresAt: NOW + 300_000,
            cache: { read: 22_000, write: 400, input: 1500 },
          },
          usage: MIXED_USAGE,
          watches: [],
          wakes: [],
        });
      }
      if (path === '/api/teams/t1/model-sources') {
        return json({
          sources: [
            {
              runtime: 'devin',
              installed: true,
              hostname: 'Ians-Mac-mini',
              machineId: 'm-mini',
              models: [{ id: 'swe-2-1-medium', name: 'SWE-2.1' }],
            },
          ],
        });
      }
      if (path === '/api/teams/t1/usage/daily') {
        return json({
          days: [
            {
              date: '2026-11-25',
              coordinator: 50_000,
              tasks: 20_000,
              input: 5_000,
              output: 2_000,
              cacheRead: 62_000,
              cacheWrite: 1_000,
              models: {
                'swe-2-1-medium': 40_000,
                'anthropic-ultra/claude-opus-5-5': 30_000,
              },
              projects: {},
              todos: [],
              cost: 0.3,
            },
          ],
          models: [
            { key: 'swe-2-1-medium', name: 'SWE-2.1', provider: 'Devin' },
            {
              key: 'anthropic-ultra/claude-opus-5-5',
              name: 'Claude Opus 5.5',
              provider: 'Anthropic Ultra',
            },
          ],
          projects: [],
        });
      }
      return undefined;
    },
  );
}

for (const theme of ['light', 'dark'] as const) {
  test(`coordinator usage popover separates current vs history with icons and dismisses on settings (${theme})`, async ({
    page,
  }) => {
    await setupCoordinator(page, theme);
    await page.goto('/app');
    const meter = page.getByTestId('home-c').getByTestId('composer-context-meter');
    await expect(meter).toBeVisible();
    await meter.click();
    const channelUsage = page.getByTestId('channel-usage');
    await expect(channelUsage).toBeVisible();

    const popover = channelUsage.locator('..');
    await expect(page.getByTestId('usage-current-engine')).toContainText('Devin');
    await expect(page.getByTestId('usage-current-engine').locator('svg')).toHaveCount(1);
    await expect(page.getByTestId('usage-current-model')).toContainText('SWE-2.1');
    await expect(page.getByTestId('usage-current-model').locator('svg')).toHaveCount(1);
    await expect(page.getByTestId('usage-current-runner')).toContainText('Ians-Mac-mini');
    await expect(page.getByTestId('usage-current-runner').locator('svg')).toHaveCount(1);

    await expect(channelUsage).not.toContainText('swe-2-1-medium');
    await expect(channelUsage).not.toContainText('Claude Code · Devin');
    await expect(channelUsage).not.toContainText('xmonsMac-3574.local · Ians-Mac-mini');

    await evidencePanelShot(page, `after-coordinator-popover-collapsed-${theme}.png`, popover);

    const toggle = page.getByTestId('usage-history-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    const history = page.getByTestId('usage-history-list');
    await expect(history).toBeVisible();
    await expect(history).toContainText('Claude Code');
    await expect(history).toContainText('Claude Haiku 5.5');
    await expect(history).toContainText('MiniMax-M3');
    await expect(history).toContainText('DeepSeek V4.1 Flash');
    await expect(history).toContainText('xmonsMac-3574.local');
    expect(await history.locator('svg').count()).toBeGreaterThanOrEqual(7);

    await evidencePanelShot(page, `after-coordinator-popover-expanded-${theme}.png`, popover);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const violations = (
      await new AxeBuilder({ page })
        .include('[data-testid="channel-usage"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations;
    expect(violations.map((v) => v.id)).toEqual([]);

    await page.evaluate(() => {
      (window as unknown as { __emitMenu?: (cmd: string) => void }).__emitMenu?.('settings');
    });
    await expect(page.getByTestId('settings-title')).toBeVisible();
    await expect(page.getByTestId('channel-usage')).toHaveCount(0);
    await evidenceShot(page, `after-settings-opened-${theme}.png`);
  });
}

test('usage page and routing settings render brand icons for models', async ({ page }) => {
  await setupCoordinator(page, 'light');
  await page.goto('/app/usage');
  const models = page.getByTestId('usage-models');
  await expect(models).toBeVisible();
  await expect(models).toContainText('SWE-2.1');
  expect(await models.locator('svg').count()).toBeGreaterThanOrEqual(2);
  await evidencePanelShot(page, 'after-usage-page-models.png', models);

  await page.goto('/app/settings/model');
  const defaultHint = page.getByTestId('routing-coordinator-default');
  if (await defaultHint.isVisible()) {
    await expect(defaultHint.locator('svg')).toHaveCount(1);
  }
});

test('narrow phone composer menu renders clean usage rows without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupCoordinator(page, 'light');
  await page.goto('/app');
  await page.getByTestId('home-c').getByTestId('composer-plus').click();
  const channelUsage = page.getByTestId('channel-usage');
  await expect(channelUsage).toBeVisible();
  await expect(channelUsage.getByTestId('usage-current-model')).toContainText('SWE-2.1');
  await expect(channelUsage.getByTestId('usage-current-engine')).toContainText('Devin');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBe(0);
});
