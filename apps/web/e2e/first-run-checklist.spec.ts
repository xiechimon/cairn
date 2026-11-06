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

const checklist = (page: Page) => page.getByTestId('first-run-checklist');
const step = (page: Page, id: string) => page.getByTestId(`first-run-step-${id}`);

const fresh = (): World => ({ providers: [], machines: [], bound: false, teamPaths: [] });

test('a fresh install shows the three steps open, each with a link to where it is fixed', async ({
  page,
}) => {
  await open(page, fresh());
  await expect(checklist(page)).toBeVisible();
  for (const id of ['model-source', 'machine', 'coordinator']) {
    await expect(step(page, id)).toHaveAttribute('data-done', 'false');
  }
  await expect(step(page, 'model-source').getByRole('link', { name: '去添加' })).toHaveAttribute(
    'href',
    /\/app\/settings\/providers/,
  );
  await expect(step(page, 'machine').getByRole('link', { name: '去连接' })).toHaveAttribute(
    'href',
    /\/app\/settings\/machines/,
  );
  await expect(step(page, 'coordinator').getByRole('button', { name: '去设置' })).toBeVisible();
  await expect(page.getByTestId('chief-gate')).toHaveCount(0);
});

test('a machine coming online ticks its step without a reload', async ({ page }) => {
  const world: World = {
    providers: [{ id: 'p1', name: 'gw' }],
    machines: [{ id: 'm1', name: 'omarchy', online: false }],
    bound: false,
    teamPaths: [],
  };
  await open(page, world);
  await expect(step(page, 'model-source')).toHaveAttribute('data-done', 'true');
  await expect(step(page, 'machine')).toHaveAttribute('data-done', 'false');
  world.machines = [{ id: 'm1', name: 'omarchy', online: true }];
  await page.evaluate(() => {
    for (const es of window.__es) es.emit({ type: 'machine_presence', machineId: 'm1', online: true });
  });
  await expect(step(page, 'machine')).toHaveAttribute('data-done', 'true');
  await expect(step(page, 'coordinator')).toHaveAttribute('data-done', 'false');
});

test('the checklist is gone once the provider, a machine and the Coordinator are all ready', async ({
  page,
}) => {
  await open(page, {
    providers: [{ id: 'p1', name: 'gw' }],
    machines: [{ id: 'm1', name: 'omarchy', online: true }],
    bound: true,
    teamPaths: [],
  });
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
});

test('every status read is scoped to the current team', async ({ page }) => {
  const world = fresh();
  await open(page, world);
  await expect(checklist(page)).toBeVisible();
  expect(world.teamPaths).toEqual(
    expect.arrayContaining(['/api/teams/t1/providers', '/api/teams/t1/machines', '/api/teams/t1/chief']),
  );
});

test('sending before the Coordinator is ready shows an actionable translated message, not the raw error', async ({
  page,
}) => {
  await open(page, fresh());
  await page.getByRole('textbox').first().fill('hello');
  await page.keyboard.press('Enter');
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toContainText('Coordinator 还不能回答');
  await expect(toast).toContainText('首页清单');
  await expect(page.locator('[data-sonner-toast]')).not.toContainText('chief agent not bound');
});

const LOCAL_LOGIN = {
  id: 'machine:m1',
  vendor: 'anthropic',
  kind: 'subscription',
  models: ['claude-sonnet-5'],
  available: true,
};

test('a machine-local Claude Code login completes the model step with no provider record', async ({
  page,
}) => {
  await open(page, {
    providers: [],
    connections: [LOCAL_LOGIN],
    machines: [{ id: 'm1', name: 'omarchy', online: true }],
    bound: false,
    teamPaths: [],
  });
  await expect(step(page, 'model-source')).toHaveAttribute('data-done', 'true');
  await expect(step(page, 'machine')).toHaveAttribute('data-done', 'true');
  await expect(step(page, 'coordinator')).toHaveAttribute('data-done', 'false');
});

test('an unavailable local login does not complete the model step', async ({ page }) => {
  await open(page, {
    providers: [],
    connections: [{ ...LOCAL_LOGIN, available: false }],
    machines: [{ id: 'm1', name: 'omarchy', online: true }],
    bound: false,
    teamPaths: [],
  });
  await expect(step(page, 'model-source')).toHaveAttribute('data-done', 'false');
});
