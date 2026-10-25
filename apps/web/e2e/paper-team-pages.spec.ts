import { expect, test } from '@playwright/test';

const ROSTER = '/app/team?scenario=team-roster';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.teamMembersLayout', 'grid'));
});

test('agent card is a Paper card: 20px corner, white, 1px ring plus a lift', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto(ROSTER);
  const card = page.getByTestId('team-agent-card').first();
  const face = await card.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, shadow: cs.boxShadow };
  });
  expect(face.radius).toBe('20px');
  expect(face.bg).toBe('rgb(255, 253, 246)');
  expect(face.shadow).toContain('0px 0px 0px 1px');
  expect(face.shadow).toContain('0px 1px 2px');
});

test('card status is icon + colour + label for each home-machine state', async ({ page }) => {
  await page.goto(ROSTER);
  const status = (name: string) =>
    page
      .getByTestId('team-agent-card')
      .filter({ hasText: name })
      .getByTestId('team-card-status');
  const expected = [
    ['r3-builder', 'online', '在线'],
    ['r7-reviewer', 'offline', '离线'],
    ['r9-scout', 'unassigned', '未设归属机'],
  ] as const;
  const colors = new Set<string>();
  for (const [name, state, label] of expected) {
    const s = status(name);
    await expect(s).toHaveAttribute('data-status', state);
    await expect(s).toHaveText(label);
    await expect(s.locator('svg')).toHaveCount(1);
    colors.add(await s.evaluate((el) => getComputedStyle(el).color));
  }
  expect(colors.size).toBe(3);
});

test('card holds a name and one meta line: model · home machine', async ({ page }) => {
  await page.goto(ROSTER);
  const card = page.getByTestId('team-agent-card').filter({ hasText: 'r5-scribe' });
  const meta = card.getByTestId('team-agent-meta');
  await expect(meta).toHaveText('claude-opus-4-5 · xmonsMac-3574.local');
  const lineBox = await meta.evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    lh: Number.parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(lineBox.h).toBeLessThanOrEqual(lineBox.lh + 1);
  await expect(card).not.toContainText('负责撰写');
  await card.click();
  await expect(page).toHaveURL(/\/app\/resources\/agents\/roster-scribe\?scenario=team-roster$/);
});

test('`创建 Agent` is the top-bar primary, not a card in the grid', async ({ page }) => {
  await page.goto(ROSTER);
  const create = page.getByRole('button', { name: '创建 Agent' });
  await expect(create).toHaveCount(1);
  await expect(page.getByTestId('page-topbar').getByRole('button', { name: '创建 Agent' })).toBeVisible();
  await expect(page.getByTestId('team-agent-grid').getByRole('button')).toHaveCount(0);
  await create.click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeVisible();
});

test('a team with no agents shows the empty state in the grid layout', async ({ page }) => {
  await page.goto('/app/team?scenario=team-org-chart-empty');
  const empty = page.getByTestId('team-agents-empty');
  await expect(empty.getByRole('heading', { name: '暂无成员' })).toBeVisible();
  await expect(empty.locator('svg')).toHaveCount(1);
  await expect(page.getByTestId('team-agent-card')).toHaveCount(0);
  await expect(page.getByText('0 个成员')).toHaveCount(0);
});

test('create dialog: labels point at controls, `取消` closes, `创建` sits right of `取消`', async ({
  page,
}) => {
  await page.goto(ROSTER);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog.getByLabel('名称')).toHaveAttribute('id', 'dlg-agent-name');
  await expect(dialog.getByLabel('运行时')).toHaveAttribute('id', 'dlg-agent-runtime');
  await expect(dialog.getByLabel('归属机')).toHaveAttribute('id', 'dlg-agent-machine');
  await expect(dialog.getByLabel('模型')).toHaveAttribute('id', 'dlg-agent-model');
  const cancel = dialog.getByRole('button', { name: '取消' });
  const create = dialog.getByRole('button', { name: '创建', exact: true });
  const [c, p] = [await cancel.boundingBox(), await create.boundingBox()];
  expect(c && p && c.x + c.width <= p.x).toBe(true);
  expect(await create.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('8px');
  await cancel.click();
  await expect(dialog).toBeHidden();
});
