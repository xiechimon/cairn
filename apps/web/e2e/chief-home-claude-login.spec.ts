import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const DAY = 24 * 60 * 60 * 1000;
const YESTERDAY_BASE = new Date().setHours(0, 0, 0, 0) - 10 * 60 * 60 * 1000;
const YESTERDAY_HISTORY = HISTORY.map((row, i) => ({
  ...row,
  createdAt: YESTERDAY_BASE + i * 60_000,
}));
const SITE = { ...PROJECT, id: 'proj-2', name: 'cairn-site', repoName: 'cairn-site' };
const DAY_TASKS = [
  TASK,
  {
    ...TASK,
    id: 'todo-2',
    seqNum: 12,
    title: '首页问候语对齐原型',
    phase: 'review',
    phaseAt: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    ...TASK,
    id: 'todo-3',
    projectId: 'proj-2',
    seqNum: 4,
    title: '官网作品区换成真实截图',
    phase: 'done',
    phaseAt: Date.now() - 3 * 60 * 60 * 1000,
  },
];

const MACHINES = [
  {
    id: 'machine-omarchy',
    name: 'omarchy',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'local',
    enabledRuntimes: ['pi', 'claude-code'],
    claudeLogin: { state: 'expiring', expiresAt: Date.now() + 2 * DAY },
  },
  {
    id: 'machine-ghost',
    name: 'ghost',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['claude-code'],
    claudeLogin: { state: 'expired', expiresAt: Date.now() - 60 * 60 * 1000 },
  },
  {
    id: 'machine-steady',
    name: 'steady',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['claude-code'],
    claudeLogin: { state: 'ok', expiresAt: Date.now() + 30 * DAY },
  },
  {
    id: 'machine-mystery',
    name: 'mystery',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['claude-code'],
    claudeLogin: { state: 'unknown', expiresAt: Date.now() - 60 * 60 * 1000 },
  },
];

test('daily brief warns for expiring and expired Claude Code logins', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: YESTERDAY_HISTORY,
    todos: DAY_TASKS,
    projects: [PROJECT, SITE],
    machines: MACHINES,
  });
  await page.goto('/app');
  const today = page.getByTestId('chief-home-today');
  await expect(today.getByTestId('chief-brief')).toBeVisible();
  const warnings = today.getByTestId('claude-login-warning');
  await expect(warnings).toHaveCount(2);
  await expect(warnings.nth(0)).toHaveAttribute('data-login', 'expiring');
  await expect(warnings.nth(0)).toHaveText(
    'omarchy 上的 Claude Code 登录将在 2 天后过期。在该机器上运行 `claude auth login` 重新登录。',
  );
  await expect(warnings.nth(1)).toHaveAttribute('data-login', 'expired');
  await expect(warnings.nth(1)).toHaveText(
    'ghost 上的 Claude Code 登录已过期。在该机器上运行 `claude auth login` 重新登录。',
  );
  await expect(today.getByText('steady', { exact: true })).toHaveCount(0);
  await expect(today.getByText('mystery', { exact: true })).toHaveCount(0);
});
