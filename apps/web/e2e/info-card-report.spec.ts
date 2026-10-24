import { expect, type Page, type Route, test } from '@playwright/test';
import { evidencePanelShot, evidenceShot } from './evidence';

const TEAM_ID = 'team-1';
const AGENT_ID = 'agent-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';
const INFO_CARD_ID = 'todo-info';
const CODE_CARD_ID = 'todo-code';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const MERGE_LABEL = '将改动合并到默认分支';
const INFO_NOTE = '信息卡的产出是报告附件，不进合并。';
const REPORT_KEY = `${TEAM_ID}/att-report.md`;
const REPORT_TEXT = [
  '## 登录页轨迹调研',
  '',
  '共抽查 **42** 条轨迹，结论如下：',
  '',
  '- 31 条在第二步重复读取同一文件',
  '- 7 条在测试失败后直接放弃',
  '- 4 条正常收口',
].join('\n');

const CARD_BASE = {
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  spec: '',
  phase: 'review',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  agent: { id: AGENT_ID, displayName: 'live-builder', avatarUrl: null },
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const INFO_CARD = {
  ...CARD_BASE,
  id: INFO_CARD_ID,
  title: '调研登录页 agent 轨迹',
  output: 'info',
};
const CODE_CARD = {
  ...CARD_BASE,
  id: CODE_CARD_ID,
  title: '修复登录按钮圆角',
  hasChanges: true,
  output: 'code',
};

const PROJECT = {
  id: PROJECT_ID,
  name: 'cairn',
  teamId: TEAM_ID,
  repoKind: 'github',
  repoName: null,
  githubRepo: 'octocat/Hello-World',
  localPath: null,
};

const FILE_DIFF = {
  path: 'README.md',
  additions: 1,
  deletions: 0,
  hunks: [{ header: '@@ -1 +1 @@', lines: ['-old', '+new'] }],
};

const AGENT_MEMBER = {
  id: `member-${AGENT_ID}`,
  teamId: TEAM_ID,
  actorId: AGENT_ID,
  memberType: 'agent',
  actor: {
    id: AGENT_ID,
    displayName: 'live-builder',
    description: null,
    status: 'active',
    avatarUrl: null,
    provider: null,
    modelId: 'claude-sonnet-5',
    thinkingLevel: null,
    tools: ['推送分支'],
    secrets: [],
    defaultSkill: null,
    skillsAllowlist: null,
    mcpServers: [],
  },
};

const REPORT_ROW = {
  id: `info-report-${BUILD_ID}`,
  role: 'system',
  content: JSON.stringify({
    kind: 'info-report',
    attachmentId: 'att-report',
    attachmentToken: `![report.md](attachment:${REPORT_KEY})`,
    content: REPORT_TEXT,
  }),
  createdAt: 2000,
};

const TASK_ROW = { id: 'msg-task', role: 'user', content: '调研登录页 agent 轨迹', createdAt: 1000 };

async function stubSurface(page: Page, card: typeof INFO_CARD | typeof CODE_CARD) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    route.fulfill({
      json: [
        { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
        AGENT_MEMBER,
      ],
    }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [card] }));
  await page.route(`**/api/todos/${card.id}`, (route) => route.fulfill({ json: card }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route(`**/api/builds/${BUILD_ID}`, (route) =>
    route.fulfill({
      json: {
        id: BUILD_ID,
        todoId: card.id,
        withPlan: false,
        prevPhase: null,
        triggerSource: 'user',
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        diffHash: null,
        createdAt: 0,
      },
    }),
  );
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/plans`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/usage`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) =>
    route.fulfill({
      json: card.output === 'code' ? { files: [FILE_DIFF], reported: true } : { files: [] },
    }),
  );
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route) =>
    route.fulfill({
      json: {
        messages: card.output === 'info' ? [TASK_ROW, REPORT_ROW] : [TASK_ROW],
        chips: null,
        historyEpoch: 0,
        steerPending: [],
        activeRun: null,
        nextCursor: null,
      },
    }),
  );
}

async function useTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

async function openCompleteDialogFromDetail(page: Page, cardId: string, theme: string) {
  await page.goto(`/app/todo/${cardId}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const action = page.locator('.detail-head-action');
  await expect(action).toBeVisible();
  await action.click();
  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const theme of ['light', 'dark'] as const) {
  test(`info card transcript shows the report text and its attachment reference (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await stubSurface(page, INFO_CARD);
    await page.goto(`/app/todo/${INFO_CARD_ID}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const report = page.getByTestId('info-report');
    await expect(report).toBeVisible();
    await expect(report.getByText('登录页轨迹调研')).toBeVisible();
    await expect(report.getByText('31 条在第二步重复读取同一文件')).toBeVisible();
    await expect(report.getByText('4 条正常收口')).toBeVisible();
    await expect(report).not.toContainText('info-report');
    const attachment = report.getByRole('link', { name: 'report.md' });
    await expect(attachment).toHaveAttribute('href', '/api/attachments/att-report');
    const reportBox = await report.boundingBox();
    const attachmentBox = await attachment.boundingBox();
    expect(reportBox).not.toBeNull();
    expect(attachmentBox).not.toBeNull();
    expect(attachmentBox?.x).toBeGreaterThanOrEqual(reportBox?.x ?? 0);
    expect((attachmentBox?.x ?? 0) + (attachmentBox?.width ?? 0)).toBeLessThanOrEqual(
      (reportBox?.x ?? 0) + (reportBox?.width ?? 0) + 1,
    );

    await evidenceShot(page, `transcript-report-${theme}.png`);
    if (theme === 'light') {
      const reportRow = page.locator('[data-row="agent"]').filter({ has: report });
      await evidencePanelShot(page, 'transcript-report-closeup.png', reportRow, 48);
    }
  });

  test(`info card completion dialog offers no merge and completes without one (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await stubSurface(page, INFO_CARD);
    let merges = 0;
    let donePhase: string | null = null;
    await page.route(`**/api/builds/${BUILD_ID}/merge`, (route) => {
      merges += 1;
      return route.fulfill({ status: 202, json: { delegated: true } });
    });
    await page.route(`**/api/todos/${INFO_CARD_ID}`, async (route: Route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const body = route.request().postDataJSON() as { phase?: string };
      donePhase = body.phase ?? null;
      return route.fulfill({ json: { ...INFO_CARD, phase: body.phase ?? 'done' } });
    });

    const dialog = await openCompleteDialogFromDetail(page, INFO_CARD_ID, theme);
    await expect(dialog.getByText(MERGE_LABEL)).toHaveCount(0);
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog.getByText(INFO_NOTE)).toBeVisible();
    await evidenceShot(page, `complete-dialog-info-${theme}.png`);

    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(merges).toBe(0);
    expect(donePhase).toBe('done');
  });
}

test('code card completion dialog keeps its merge row', async ({ page }) => {
  await useTheme(page, 'dark');
  await stubSurface(page, CODE_CARD);
  const dialog = await openCompleteDialogFromDetail(page, CODE_CARD_ID, 'dark');
  await expect(dialog.getByText(MERGE_LABEL)).toBeVisible();
  await expect(dialog.getByText(INFO_NOTE)).toHaveCount(0);
});
