import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, PROJECT, THREAD } from './chief-home-mock';

interface World {
  providers: unknown[];
  connections?: unknown[];
  machines: {
    id: string;
    name: string;
    online: boolean;
    starting?: boolean;
    kind?: 'local' | 'remote';
    lastSeenAt?: number;
  }[];
  bound: boolean;
  teamPaths: string[];
}

const BOUND_AGENT = { id: 'agent-1', displayName: 'scribe', modelId: 'm', tools: [] };

async function open(page: Page, world: World, history = false) {
  await mockLive(
    page,
    history
      ? { threads: [THREAD], messages: HISTORY, projects: [PROJECT], todos: [] }
      : { threads: [], messages: [], projects: [PROJECT], todos: [] },
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

const prompt = (page: Page) => page.getByTestId('setup-prompt');
const action = (page: Page) => page.getByTestId('setup-prompt-action');
const label = (page: Page) => page.getByTestId('setup-prompt-label');
const hint = (page: Page) => page.getByTestId('setup-prompt-hint');

const fresh = (): World => ({ providers: [], machines: [], bound: false, teamPaths: [] });
const ONLINE = { id: 'm1', name: 'omarchy', online: true };
const SUBSCRIPTION = {
  id: 'sub-1',
  vendor: 'anthropic',
  kind: 'subscription',
  models: ['claude-sonnet-5'],
  available: true,
};

test('a fresh install puts one centered model-source prompt on the empty home instead of the starters', async ({
  page,
}) => {
  await open(page, fresh());
  await expect(prompt(page)).toHaveCount(1);
  await expect(prompt(page)).toHaveAttribute('data-step', 'models');
  await expect(prompt(page)).toHaveAttribute('data-variant', 'empty');
  await expect(prompt(page)).toContainText('先接入一个模型来源，Coordinator 才能回复你');
  await expect(prompt(page)).toContainText('Claude 订阅');
  await expect(action(page)).toHaveText('接入模型来源');
  await expect(action(page)).toHaveAttribute('href', /\/app\/settings\/routing/);
  await expect(page.getByTestId('chief-composer-placeholder')).toHaveText('接入模型来源后就能发消息');
  await expect(page.getByTestId('chief-quick-replies')).toHaveCount(0);
  await expect(page.getByTestId('first-run-checklist')).toHaveCount(0);
  await expect(page.getByTestId('chief-gate')).toHaveCount(0);
});

test('with a conversation already there the model-source prompt is one notice line after it', async ({
  page,
}) => {
  await open(page, fresh(), true);
  await expect(page.getByText('这条和 #9 是同一处，已经补给它了。')).toBeVisible();
  await expect(prompt(page)).toHaveCount(1);
  await expect(prompt(page)).toHaveAttribute('data-variant', 'line');
  await expect(prompt(page)).toHaveText(/Coordinator 现在没有模型可用/);
  await expect(action(page)).toHaveAttribute('href', /\/app\/settings\/routing/);
});

test('with models on both sides one notice line asks for a machine and shows the start command', async ({
  page,
}) => {
  await open(page, { ...fresh(), providers: [{ id: 'p1', name: 'gw' }], bound: true });
  await expect(prompt(page)).toHaveAttribute('data-step', 'machine');
  await expect(prompt(page)).toHaveAttribute('data-variant', 'line');
  await expect(label(page)).toHaveText('连接一台执行机');
  await expect(action(page)).toHaveAttribute('href', /\/app\/settings\/machines/);
  await expect(hint(page).locator('code')).toHaveText(/ start$/);
  await expect(hint(page)).toContainText('在要干活的电脑上运行');
});

test('a model source the Coordinator cannot use still asks for a provider', async ({ page }) => {
  await open(page, { ...fresh(), providers: [{ id: 'p1', name: 'gw' }], machines: [ONLINE] });
  await expect(prompt(page)).toHaveAttribute('data-step', 'models');
  await expect(prompt(page)).toContainText('Coordinator 还缺模型');
  await expect(action(page)).toHaveAttribute('href', /\/app\/settings\/routing/);
  await expect(prompt(page)).toContainText('Coordinator 能用的服务商');
});

test('a machine coming back online clears the notice', async ({ page }) => {
  const world: World = {
    providers: [{ id: 'p1', name: 'gw' }],
    machines: [{ ...ONLINE, online: false }],
    bound: true,
    teamPaths: [],
  };
  await open(page, world);
  await expect(prompt(page)).toHaveAttribute('data-step', 'machine');
  await expect(label(page)).toHaveText('omarchy 离线');
  await expect(hint(page)).toHaveText(/^在 omarchy 上运行 .+ start 让它重新上线$/);
  world.machines = [ONLINE];
  await page.evaluate(() => {
    for (const es of window.__es) es.emit({ type: 'machine_presence', machineId: 'm1', online: true });
  });
  await expect(prompt(page)).toHaveCount(0);
});

async function openDesktop(page: Page, world: World) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      __reconnects: calls,
      cairnDesktop: { localRunner: { reconnect: async () => void calls.push('reconnect') } },
    });
  });
  const machinesRead = page.waitForResponse((res) => res.url().endsWith('/api/teams/t1/machines'));
  await open(page, world);
  await machinesRead;
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
}

const OWN_OFFLINE = { id: 'm1', name: 'xmonsMac', online: false, kind: 'local' as const, lastSeenAt: 1 };

test('a re-registering Runner counts as a Runner already, so its startup shows no notice, and one reported offline again shows at once', async ({
  page,
}) => {
  const world: World = {
    ...fresh(),
    providers: [{ id: 'p1', name: 'gw' }],
    bound: true,
    machines: [{ ...OWN_OFFLINE, starting: true }],
  };
  const machinesRead = page.waitForResponse((res) => res.url().endsWith('/api/teams/t1/machines'));
  await open(page, world);
  await machinesRead;
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
  await expect(hint(page)).toHaveCount(0);
  world.machines = [OWN_OFFLINE];
  await page.evaluate(() => {
    for (const es of window.__es)
      es.emit({ type: 'machine_presence', machineId: 'm1', online: false });
  });
  await expect(label(page)).toHaveText('xmonsMac 离线');
  await expect(hint(page)).toHaveText(/^在 xmonsMac 上运行 .+ start 让它重新上线$/);
});

test('opening the desktop app shows no Runner hint while its own Runner re-registers, and a reported offline state shows at once', async ({
  page,
}) => {
  const world: World = {
    ...fresh(),
    providers: [{ id: 'p1', name: 'gw' }],
    bound: true,
    machines: [{ ...OWN_OFFLINE, online: true }],
  };
  await openDesktop(page, world);
  await expect(prompt(page)).toHaveCount(0);
  await expect(hint(page)).toHaveCount(0);
  world.machines = [OWN_OFFLINE];
  await page.evaluate(() => {
    for (const es of window.__es)
      es.emit({ type: 'machine_presence', machineId: 'm1', online: false });
  });
  await expect(label(page)).toHaveText('xmonsMac 离线');
  world.machines = [{ ...OWN_OFFLINE, online: true }];
  await page.evaluate(() => {
    for (const es of window.__es) es.emit({ type: 'machine_presence', machineId: 'm1', online: true });
  });
  await expect(prompt(page)).toHaveCount(0);
});

test('in the desktop app its own offline machine reconnects instead of asking for cairn start', async ({
  page,
}) => {
  await openDesktop(page, {
    ...fresh(),
    providers: [{ id: 'p1', name: 'gw' }],
    bound: true,
    machines: [OWN_OFFLINE],
  });
  await expect(label(page)).toHaveText('xmonsMac 离线');
  await expect(hint(page)).toHaveText('Cairn 会在这台电脑唤醒后自动重连');
  await expect(hint(page).locator('code')).toHaveCount(0);
  await page.getByTestId('setup-prompt-reconnect').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __reconnects: string[] }).__reconnects))
    .toEqual(['reconnect']);
});

test('outside the desktop app an offline local machine still shows the start command', async ({
  page,
}) => {
  await open(page, {
    ...fresh(),
    providers: [{ id: 'p1', name: 'gw' }],
    bound: true,
    machines: [{ id: 'm1', name: 'xmonsMac', online: false, kind: 'local', lastSeenAt: 1 }],
  });
  await expect(hint(page)).toHaveText(/^在 xmonsMac 上运行 .+ start 让它重新上线$/);
  await expect(page.getByTestId('setup-prompt-reconnect')).toHaveCount(0);
});

test('with several runners all offline the notice counts them instead of asking to connect one', async ({
  page,
}) => {
  await open(page, {
    ...fresh(),
    providers: [{ id: 'p1', name: 'gw' }],
    bound: true,
    machines: [
      { ...ONLINE, online: false },
      { id: 'm2', name: 'mac', online: false },
    ],
  });
  await expect(label(page)).toHaveText('2 台执行机都离线');
  await expect(hint(page)).toContainText('在其中一台上运行');
});

test('the notice is gone once the Coordinator, a model source and a machine are ready', async ({
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
  await expect(prompt(page)).toHaveCount(0);
  await expect(hint(page)).toHaveCount(0);
});

test('every status read is scoped to the current team', async ({ page }) => {
  const world = fresh();
  await open(page, world);
  await expect(prompt(page)).toBeVisible();
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
  await expect(prompt(page)).toHaveCount(0);
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
  await expect(toast).toContainText('先接入模型来源');
  await expect(page.locator('[data-sonner-toast]')).not.toContainText('chief agent not bound');
});

test('a Claude subscription the Coordinator cannot run yet leaves it without a model', async ({
  page,
}) => {
  await open(page, { ...fresh(), connections: [SUBSCRIPTION], machines: [ONLINE] });
  await expect(prompt(page)).toHaveAttribute('data-step', 'models');
  await expect(prompt(page)).toContainText('Coordinator 还缺模型');
});

test('an expired subscription does not count as a model source', async ({ page }) => {
  await open(page, {
    ...fresh(),
    connections: [{ ...SUBSCRIPTION, available: false }],
    machines: [ONLINE],
  });
  await expect(prompt(page)).toHaveAttribute('data-step', 'models');
  await expect(action(page)).toHaveText('接入模型来源');
});
