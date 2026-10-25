import { expect, type Page, test } from '@playwright/test';

const BRIEF_ID = 'todo-brief-1';
const BRIEF_EMPTY_ID = 'todo-brief-empty';
const TEAM_ID = 'team-1';

const SPEC_MD = [
  '# 任务目标',
  '',
  '把圆角改成 **8px**：',
  '',
  '- 悬停态加过渡',
  '- 移动端全宽',
  '',
  '1. first step',
  '2. second step',
  '10. tenth step',
  '',
  '```css',
  '.login-btn { border-radius: 8px; }',
  '```',
  '',
  '![设计稿.png](attachment:team-1/att-img-1.png)',
  '![说明文档.pdf](attachment:team-1/att-doc-7.pdf)',
].join('\n');

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: 'Xmon Dai', avatarUrl: null };

function wireTodo(id: string, title: string, spec: string, seqNum: number) {
  return {
    id,
    teamId: TEAM_ID,
    projectId: 'proj-1',
    title,
    spec,
    phase: 'todo',
    phaseAt: 0,
    seqNum,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
}

const WIRE_BRIEF = wireTodo(BRIEF_ID, '登录按钮圆角与悬停过渡', SPEC_MD, 1);
const WIRE_BRIEF_EMPTY = wireTodo(BRIEF_EMPTY_ID, '空描述任务', '', 2);

async function stubWorld(page: Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/**', (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/teams') return route.fulfill(json([TEAM]));
      if (path === '/api/user/me') return route.fulfill(json(USER));
      if (path === '/api/projects') {
        return route.fulfill(
          json([{ id: 'proj-1', name: 'alpha', teamId: TEAM_ID, repoKind: 'hosted' }]),
        );
      }
      if (path === '/api/todos') return route.fulfill(json([WIRE_BRIEF, WIRE_BRIEF_EMPTY]));
      if (path === `/api/todos/${BRIEF_ID}`) return route.fulfill(json(WIRE_BRIEF));
      if (path === `/api/todos/${BRIEF_EMPTY_ID}`) return route.fulfill(json(WIRE_BRIEF_EMPTY));
      return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
    }
    return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
  });
}

test('1. spec block-level markdown rendering: headings/lists/fences become elements, literal markers do not leak', async ({ page }) => {
  await stubWorld(page);
  await page.goto(`/app/todo/${BRIEF_ID}`);
  const block = page.locator('.spec-block');
  await expect(block).toBeVisible();
  await expect(block.locator('.chat-md-head--1')).toHaveText('任务目标');
  await expect(block.locator('.chat-md-item--bullet')).toHaveCount(2);
  await expect(block.locator('.chat-md-code')).toContainText('border-radius: 8px');
  await expect(block).not.toContainText('# 任务目标');
  await expect(block).not.toContainText('```');
});

test('2. attachment token rows render as chips: images with thumbnail constraints, files with name and endpoint link', async ({ page }) => {
  await stubWorld(page);
  await page.goto(`/app/todo/${BRIEF_ID}`);
  const block = page.locator('.spec-block');
  await expect(block).not.toContainText('attachment:');
  const imageChip = block.locator('a.spec-chip--image');
  await expect(imageChip).toHaveAttribute('href', '/api/attachments/att-img-1');
  await expect(imageChip.locator('img.spec-chip-img')).toHaveAttribute('alt', '设计稿.png');
  const fileChip = block.locator('a.spec-chip', { hasText: '说明文档.pdf' });
  await expect(fileChip).toHaveAttribute('href', '/api/attachments/att-doc-7');
});

test('3. image attachments constrained by thumbnails — no longer naked original-size images breaking the page', async ({ page }) => {
  await stubWorld(page);
  await page.goto(`/app/todo/${BRIEF_ID}`);
  const img = page.locator('.spec-block img.spec-chip-img');
  const maxHeight = await img.evaluate((el) => getComputedStyle(el).maxHeight);
  expect(maxHeight).toBe('160px');
  const maxWidth = await img.evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxWidth).toBe('100%');
});

test('4. brief-card recipe = framed content box (1px border / rounded-lg / surface-secondary background)', async ({
  page,
}) => {
  await stubWorld(page);
  await page.goto(`/app/todo/${BRIEF_ID}`);
  const card = page.locator('.spec-block');
  const cs = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      borderTop: s.borderTopWidth,
      borderColor: s.borderTopColor,
      radius: s.borderRadius,
      bg: s.backgroundColor,
      fontSize: s.fontSize,
    };
  });
  expect(cs.borderTop).toBe('1px');

  expect(cs.radius).toBe('10px');

  expect(cs.bg).toBe('rgb(60, 55, 50)');
  expect(cs.borderColor).toBe('rgb(62, 58, 52)');
  expect(cs.fontSize).toBe('14px');
});

test('4b. wide screens line length takes the 68ch cap (same law as the 60–75 character band in #470)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await stubWorld(page);
  await page.goto(`/app/todo/${BRIEF_ID}`);
  const capped = await page.locator('.spec-block .chat-md-head--1').evaluate((block) => {
    const cs = getComputedStyle(block);
    const probe = document.createElement('span');
    probe.style.font = cs.font;
    probe.style.visibility = 'hidden';
    probe.textContent = '0';
    document.body.appendChild(probe);
    const zero = probe.getBoundingClientRect().width;
    probe.remove();
    return { maxWidth: Number.parseFloat(cs.maxWidth), zero68: zero * 68 };
  });
  expect(Math.abs(capped.maxWidth - capped.zero68)).toBeLessThanOrEqual(2);
});

test('5. live tasks with a spec no longer show `尚无描述`; empty spec keeps the placeholder', async ({ page }) => {
  await stubWorld(page);
  await page.goto(`/app/todo/${BRIEF_ID}`);
  await expect(page.locator('.spec-block')).toBeVisible();
  await expect(page.locator('.fresh-nodesc')).toHaveCount(0);
  await page.goto(`/app/todo/${BRIEF_EMPTY_ID}`);
  await expect(page.locator('.fresh-nodesc')).toBeVisible();
  await expect(page.locator('.spec-block')).toHaveCount(0);
});

test('6. ordered-list numerals distinguished from body text, aligned with the first-line baseline, two-digit numbers do not jog the content column (#814 rework)', async ({
  page,
}) => {
  await stubWorld(page);
  await page.goto(`/app/todo/${BRIEF_ID}`);
  const rows = page.locator('.spec-block .chat-md-item--ordered');
  await expect(rows).toHaveCount(3);
  const pins = await rows.evaluateAll((els) =>
    els.map((row) => {
      const ord = row.querySelector('.chat-md-ordinal') as HTMLElement;
      const content = row.querySelector('.chat-md-content') as HTMLElement;
      const ordRect = ord.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        rowAlign: getComputedStyle(row).alignItems,
        ordColor: getComputedStyle(ord).color,
        contentColor: getComputedStyle(content).color,
        ordTop: ordRect.top,
        contentTop: contentRect.top,
        contentLeft: contentRect.left,
      };
    }),
  );

  for (const pin of pins) {
    expect(pin.rowAlign).toBe('baseline');
    expect(pin.ordColor).not.toBe(pin.contentColor);
    expect(Math.abs(pin.ordTop - pin.contentTop)).toBeLessThanOrEqual(1);
  }

  const lefts = pins.map((pin) => pin.contentLeft);
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
});
