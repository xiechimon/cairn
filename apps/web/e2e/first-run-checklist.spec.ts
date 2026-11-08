import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT } from './chief-home-mock';

interface World {
  providers: unknown[];
  connections?: unknown[];
  machines: { id: string; name: string; online: boolean }[];
  bound: boolean;
  teamPaths: string[];
}

const BOUND_AGENT = { id: 'agent-1', displayName: 'scribe', modelId: 'm', tools: [] };

async function open(page: Page, world: World) {
  await mockLive(
    page,
    { threads: [], messages: [], projects: [PROJECT], todos: [] },
    (path, route, json) => {
      if (path.startsWith('/api/teams/')) world.teamPaths.push(path);
      if (path === '/api/teams/t1/providers') {
        return json({ presets: [], providers: world.providers });
      }
      if (path === '/api/teams/t1/model-routing') {
        return json({ edges: [], connections: world.connections ?? [], quota: [], settings: {} });
      }
      if (path === '/api/teams/t1/machines') return json(world.machines);
      if (path === '/api/teams/t1/chief' && route.request().method() === 'GET') {
        return json({
          chief: {
            id: 'chief-u1-t1',
            userId: 'u1',
            teamId: 't1',
            agent: world.bound ? { agentId: 'agent-1' } : null,
            charter: null,
            lastTurnAt: null,
            createdAt: 0,
            tz: null,
          },
          agentActor: world.bound ? BOUND_AGENT : null,
          context: null,
          watches: [],
          wakes: [],
        });
      }
      if (path === '/api/teams/t1/chief/threads' && route.request().method() === 'POST') {
        return json(
          { error: 'chief agent not bound', reason: 'coordinator-not-ready' },
          409,
        );
      }
      return undefined;
    },
  );
  await page.goto('/app');
}

const chip = (page: Page) => page.getByTestId('composer-setup-chip');
const hint = (page: Page) => page.getByTestId('composer-setup-hint');

const fresh = (): World => ({ providers: [], machines: [], bound: false, teamPaths: [] });
const ONLINE = { id: 'm1', name: 'omarchy', online: true };
const LOCAL_LOGIN = {
  id: 'machine:m1',
  vendor: 'anthropic',
  kind: 'subscription',
  models: ['claude-sonnet-5'],
  available: true,
};

test('a fresh install shows one chip for the first missing step and no card', async ({ page }) => {
  await open(page, fresh());
  await expect(chip(page)).toHaveCount(1);
  await expect(chip(page)).toHaveAttribute('data-step', 'model-source');
  await expect(chip(page)).toHaveText('接入模型来源');
  await expect(chip(page)).toHaveAttribute('href', /\/app\/settings\/providers/);
  await expect(hint(page)).toContainText('Claude Code');
  await expect(page.getByTestId('first-run-checklist')).toHaveCount(0);
  await expect(page.getByTestId('chief-gate')).toHaveCount(0);
});

test('with a model source the chip asks for a machine and the hint shows the start command', async ({
  page,
}) => {
  await open(page, { ...fresh(), providers: [{ id: 'p1', name: 'gw' }] });
  await expect(chip(page)).toHaveAttribute('data-step', 'machine');
  await expect(chip(page)).toHaveAttribute('href', /\/app\/settings\/machines/);
  await expect(hint(page).locator('code')).toHaveText(/ start$/);
});

test('with a source and a machine the chip opens the Coordinator settings', async ({ page }) => {
  await open(page, { ...fresh(), providers: [{ id: 'p1', name: 'gw' }], machines: [ONLINE] });
  await expect(chip(page)).toHaveAttribute('data-step', 'coordinator');
  await expect(chip(page)).toHaveText('设置 Coordinator');
  await chip(page).click();
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(0);
});

test('a machine going offline only advances the chip when it is the first gap', async ({
  page,
}) => {
  const world: World = {
    providers: [{ id: 'p1', name: 'gw' }],
    machines: [{ ...ONLINE, online: false }],
    bound: false,
    teamPaths: [],
  };
  await open(page, world);
  await expect(chip(page)).toHaveAttribute('data-step', 'machine');
  world.machines = [ONLINE];
  await page.evaluate(() => {
    for (const es of window.__es) es.emit({ type: 'machine_presence', machineId: 'm1', online: true });
  });
  await expect(chip(page)).toHaveAttribute('data-step', 'coordinator');
});

test('the chip and hint are gone once the provider, a machine and the Coordinator are ready', async ({
  page,
}) => {
  await open(page, {
    providers: [{ id: 'p1', name: 'gw' }],
    machines: [ONLINE],
    bound: true,
    teamPaths: [],
  });
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  await expect(hint(page)).toHaveCount(0);
});

test('every status read is scoped to the current team', async ({ page }) => {
  const world = fresh();
  await open(page, world);
  await expect(chip(page)).toBeVisible();
  expect(world.teamPaths).toEqual(
    expect.arrayContaining(['/api/teams/t1/providers', '/api/teams/t1/machines', '/api/teams/t1/chief']),
  );
});

test('nothing shows until every status read has loaded', async ({ page }) => {
  await mockLive(
    page,
    { threads: [], messages: [], projects: [PROJECT], todos: [] },
    (path, route, json) => {
      if (path === '/api/teams/t1/machines') return new Promise(() => undefined);
      return undefined;
    },
  );
  await page.goto('/app');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
});

test('sending before the Coordinator is ready shows an actionable translated message, not the raw error', async ({
  page,
}) => {
  await open(page, fresh());
  const composer = page.getByTestId('chief-composer-input');
  await expect(page.getByTestId('loading-composer')).toHaveCount(0);
  await composer.fill('hello');
  await composer.press('Enter');
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toContainText('Coordinator 还不能回答');
  await expect(toast).toContainText('输入框下方的按钮');
  await expect(page.locator('[data-sonner-toast]')).not.toContainText('chief agent not bound');
});

test('a machine-local Claude Code login completes the model step with no provider record', async ({
  page,
}) => {
  await open(page, { ...fresh(), connections: [LOCAL_LOGIN], machines: [ONLINE] });
  await expect(chip(page)).toHaveAttribute('data-step', 'coordinator');
});

test('an unavailable local login does not complete the model step', async ({ page }) => {
  await open(page, {
    ...fresh(),
    connections: [{ ...LOCAL_LOGIN, available: false }],
    machines: [ONLINE],
  });
  await expect(chip(page)).toHaveAttribute('data-step', 'model-source');
});
