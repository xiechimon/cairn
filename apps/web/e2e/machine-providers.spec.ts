import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const NOW = Date.now();

test('live: machine detail toggles a runtime through enabledRuntimes', async ({ page }) => {
  const patches: unknown[] = [];
  const machine = {
    id: 'm1',
    name: 'omarchy',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['pi', 'claude-code'],
    providers: [
      {
        runtime: 'claude-code',
        login: 'logged-in',
        plan: 'Max',
        version: '2.1.289',
        loginCommand: null,
        enabled: true,
        observedAt: NOW,
      },
      {
        runtime: 'codex',
        login: 'logged-out',
        plan: null,
        version: '0.98.0',
        loginCommand: 'codex login',
        enabled: false,
        observedAt: NOW,
      },
    ],
  };
  await mockLive(page, { threads: [], messages: [], machines: [machine] }, (path, route, json) => {
    if (path === '/api/machines/m1' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      patches.push(body);
      return json({ ...machine, ...body });
    }
    return undefined;
  });
  await page.goto('/app/resources/machines/m1');
  const section = page.getByTestId('machine-providers');
  const claudeCode = section.locator('[data-runtime="claude-code"]');
  const codex = section.locator('[data-runtime="codex"]');
  await expect(codex.getByTestId('provider-login-command')).toHaveText('codex login');
  await expect(codex.getByTestId('provider-toggle')).toBeDisabled();
  await claudeCode.getByTestId('provider-toggle').click();
  await expect.poll(() => patches).toEqual([{ enabledRuntimes: ['pi'] }]);
});

test('fixture: machine detail lists providers with login command', async ({ page }) => {
  await page.goto('/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=model-routing');
  const section = page.getByTestId('machine-providers');
  await expect(section.locator('[data-testid="provider-row"]')).toHaveCount(3);
  await expect(section.locator('[data-runtime="codex"]')).toContainText('ChatGPT Pro');
  await page.goto('/app/resources/machines/TlZ2sSD4EJCxjNJqVhdo_?scenario=model-routing');
  await expect(
    page.getByTestId('machine-providers').locator('[data-runtime="claude-code"]').getByTestId('provider-login-command'),
  ).toHaveText('claude /login');
});
