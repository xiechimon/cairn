import { expect, test } from '@playwright/test';

const MACHINES = '/app/resources/machines?scenario=06';
const SHELL = '[data-route="/app/resources/machines"]';
const ROW = `${SHELL} div[data-kind]`;
const LOCAL_ROW = `${ROW}[data-kind="local"]`;

const LOCAL_NAME = 'xmonsMac-3574.local';
const LOCAL_ID = 'TlZ2sSD4EJCxjNJqVhdo_';

test('local row pinned first: data-kind=local + id handle + hostname canon', async ({ page }) => {
  await page.goto(MACHINES);
  const first = page.locator(ROW).first();
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('data-kind', 'local');
  await expect(first).toHaveAttribute('data-machine-id', LOCAL_ID);
  await expect(first.getByText(LOCAL_NAME)).toHaveText(LOCAL_NAME);
});

test('managed facade row removed (spec 11 A8 negative)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(LOCAL_ROW)).toBeVisible();
  await expect(page.locator(`${SHELL} .page-main`)).not.toContainText('Cairn 托管机器');
});

test('per-runtime brand mark: both present + brightness split = enabledRuntimes canon', async ({ page }) => {
  await page.goto(MACHINES);
  const pi = page.locator(`${LOCAL_ROW} [data-runtime="pi"]`);
  const cc = page.locator(`${LOCAL_ROW} [data-runtime="claude-code"]`);
  await expect(pi).toBeVisible();
  await expect(cc).toBeVisible();
  await expect(pi.locator('svg')).toBeVisible();
  await expect(cc.locator('svg')).toBeVisible();

  await expect(pi).toHaveText('');
  await expect(cc).toHaveText('');
  await expect(pi).toHaveAccessibleName('pi');
  await expect(cc).toHaveAccessibleName('Claude Code');
  await expect(pi).toHaveAttribute('title', 'pi');
  await expect(cc).toHaveAttribute('title', 'Claude Code');

  await expect(pi).toHaveAttribute('data-enabled', 'true');
  await expect(cc).toHaveAttribute('data-enabled', 'false');
});

test('inline control face = shell switch + two concurrency selectors (XMON-113 + #1108; dead buttons still none)', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${LOCAL_ROW} [role="switch"]`)).toHaveCount(1);

  await expect(page.locator(`${LOCAL_ROW} button[aria-label^="并发上限"]`)).toHaveCount(1);

  await expect(page.locator(`${LOCAL_ROW} button`)).toHaveCount(1);

  await expect(page.locator(`${LOCAL_ROW} [data-runtime] [role="switch"]`)).toHaveCount(0);
});

test('sub-row hint removed, re-hung on the shell switch-cluster tooltip (#1175)', async ({ page }) => {
  await page.goto(MACHINES);
  const hint = page.locator('[data-slot="tooltip-content"]');

  await expect(page.locator(LOCAL_ROW)).not.toContainText(
    '已授权「远程 shell」的 Agent 可在该机器上执行命令。',
  );
  await expect(hint).toHaveCount(0);
  await expect(page.locator(LOCAL_ROW)).not.toContainText('· max');

  await page.locator(`${LOCAL_ROW} [data-slot="tooltip-trigger"]`).hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('已授权「远程 shell」的 Agent 可在该机器上执行命令。');
});

test('local row not deletable: no delete-class control in the row (negative)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${LOCAL_ROW} button[aria-label*="删除"]`)).toHaveCount(0);
  await expect(page.locator(`${LOCAL_ROW} [aria-haspopup="menu"]`)).toHaveCount(0);
});

test('row body not clickable; machine name = link to the machine detail page (#1259)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(LOCAL_ROW)).toBeVisible();

  await expect(page.locator(`${SHELL} [data-kind][role="button"]`)).toHaveCount(0);
  const nameLinks = page.locator(`${LOCAL_ROW} a`);
  await expect(nameLinks).toHaveCount(1);
  await expect(nameLinks).toHaveAttribute(
    'href',
    `/app/resources/machines/${LOCAL_ID}?scenario=06`,
  );
});

test('mark geometry: 16×16 mark, on/off opacity split, row-height contract unbroken', async ({ page }) => {
  await page.goto(MACHINES);
  const m = await page.evaluate(
    ({ sel }) => {
      const read = (runtime: string) => {
        const wrap = document.querySelector(`${sel} [data-runtime="${runtime}"]`);
        if (!wrap) throw new Error(`runtime missing: ${runtime}`);
        const mark = wrap.querySelector('svg');
        if (!mark) throw new Error('mark missing');
        const r = mark.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        return {
          markW: r.width,
          markH: r.height,
          opacity: getComputedStyle(mark).opacity,
          wrapLeft: wr.x,
          wrapRight: wr.right,
        };
      };
      const row = document.querySelector(sel)?.getBoundingClientRect();
      return {
        on: read('pi'),
        off: read('claude-code'),
        rowHeight: row?.height ?? null,
      };
    },
    { sel: LOCAL_ROW },
  );
  for (const s of [m.on, m.off]) {
    expect(s.markW).toBe(16);
    expect(s.markH).toBe(16);
  }
  expect(m.on.opacity).toBe('1');
  expect(m.off.opacity).toBe('0.35');
  expect(m.off.wrapLeft - m.on.wrapRight).toBe(16);
  expect(m.rowHeight).toBe(52); // Paper settings row (SETTINGS_ROW_CLS min-h-13)
});