import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';
import { evidenceShot } from './evidence.js';

const RUN = [
  { id: 'a-short', content: '收到，我去看看。' },
  {
    id: 'a-long',
    content:
      '先看了 code-review 任务的电脑：执行机在线，最近一次心跳在一分钟前，但上一次运行停在安装依赖这一步，日志里最后一行是锁文件校验失败，之后没有新的输出，也没有留下未提交的改动，所以可以放心地从头再跑一遍。',
  },
  {
    id: 'a-paras',
    content:
      '原因有两条。\n\n第一，package.json 里升级了一个依赖，但锁文件没有一起提交。\n\n第二，CI 用的是冻结安装，所以版本对不上就直接退出。',
  },
  {
    id: 'a-code',
    content:
      '我会先在本地跑一遍：\n\n```sh\npnpm install --frozen-lockfile\n```\n\n通过后提交更新后的锁文件，再重新推送。',
  },
  { id: 'a-mid', content: '锁文件已经提交，新的运行正在排队。' },
  { id: 'a-last', content: 'code-review 任务的电脑已经重新连上，大约两分钟后开始。' },
] as const;
const MIDDLE = 'a-paras';

const REVIEW_TASK = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=28';

async function textUnder(toolbar: Locator, root: Locator): Promise<string[]> {
  const toolbarHandle = await toolbar.elementHandle();
  return root.evaluate((rootEl, bar) => {
    if (!(bar instanceof Element)) return ['toolbar missing'];
    const parts = [
      ...bar.querySelectorAll('button[data-tool], [data-slot="message-toolbar-meta"]'),
    ].map((el) => el.getBoundingClientRect());
    const covered: string[] = [];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      if (text === '' || bar.contains(node)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const line of range.getClientRects()) {
        const hit = parts.some(
          (p) =>
            p.left < line.right &&
            line.left < p.right &&
            p.top < line.bottom - 2 &&
            line.top + 2 < p.bottom,
        );
        if (hit) covered.push(text.slice(0, 24));
      }
    }
    return covered;
  }, toolbarHandle);
}

async function visibleCopies(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('[data-testid="chief-msg-copy"], [data-tool="copy"]')].filter(
        (el) => {
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          for (let up: Element | null = el; up !== null; up = up.parentElement)
            if (Number(getComputedStyle(up).opacity) === 0) return false;
          return true;
        },
      ).length,
  );
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not laid out');
  return box;
}


async function openRun(page: Page, width: number, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), scheme);
  const now = Date.now();
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'u-1', role: 'user', content: 'code-review 任务怎么停了？', createdAt: now - 400_000 },
      ...RUN.map((reply, n) => ({
        id: reply.id,
        role: 'assistant' as const,
        content: reply.content,
        createdAt: now - 360_000 + n * 60_000,
      })),
    ],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText('大约两分钟后开始');
  return stream;
}

async function boundaryInk(reply: Locator) {
  return reply.evaluate((el) => {
    const col = el.closest('[data-testid="chief-msg-col"]');
    const bar = getComputedStyle(el, '::before');
    return {
      bar: bar.content === 'none' || bar.content === 'normal' ? 0 : Number.parseFloat(bar.width),
      hairline: col === null ? 0 : Number.parseFloat(getComputedStyle(col).borderTopWidth),
    };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`consecutive Coordinator replies are split by a centred time line, never a bar or hairline, and each copy floats at its own top-right without covering text (${scheme}, 1440px)`, async ({
    page,
  }) => {
    const stream = await openRun(page, 1440, scheme);
    await page.mouse.move(0, 0);
    const dividers = stream.getByTestId('chief-time-divider');
    await expect(dividers, 'one time line between each pair of replies').toHaveCount(
      RUN.length - 1,
    );

    for (const [n, { id }] of RUN.entries()) {
      const reply = stream.locator(`[data-reply-source="${id}"]`);
      await reply.scrollIntoViewIfNeeded();
      const tools = reply.getByTestId('chief-msg-foot');
      await expect(tools, `${id}: hidden at rest`).toHaveCSS('opacity', '0');
      await expect(tools).toHaveAttribute('data-placement', 'top-end-hover');
      const rest = await boxOf(reply);

      await reply.locator('[data-slot="reply-block"]').first().hover();
      await expect(tools, `${id}: shown on hover`).toHaveCSS('opacity', '1');
      expect(await boundaryInk(reply), `${id}: no left bar and no hairline`).toEqual({
        bar: 0,
        hairline: 0,
      });
      expect((await boxOf(reply)).y, `${id}: hover moves nothing`).toBe(rest.y);
      await expect.poll(() => visibleCopies(page), `${id}: only this reply shows a copy`).toBe(1);
      await expect(
        tools.locator('[data-slot="message-toolbar-meta"]'),
        `${id}: the time lives in the divider, not the toolbar`,
      ).toHaveCount(0);
      expect(await textUnder(tools, stream), `${id}: its copy covers no text`).toEqual([]);
      const pill = await boxOf(tools);
      expect(Math.abs(pill.x + pill.width - (rest.x + rest.width)), `${id}: pinned right`).toBeLessThanOrEqual(1);
      expect(Math.abs(pill.y - rest.y), `${id}: level with its first line`).toBeLessThanOrEqual(2);
      expect(
        await isHittableCopy(tools),
        `${id}: the copy button is reachable`,
      ).toBe(true);

      if (n > 0) {
        const divider = await boxOf(dividers.nth(n - 1));
        const previous = await boxOf(stream.locator(`[data-reply-source="${RUN[n - 1]?.id}"]`));
        expect(divider.y, `${id}: the time line sits below the previous reply`).toBeGreaterThan(
          previous.y + previous.height,
        );
        expect(divider.y + divider.height, `${id}: and above this reply`).toBeLessThan(rest.y);
        expect(pill.y, `${id}: the copy never reaches the time line`).toBeGreaterThan(
          divider.y + divider.height,
        );
        await expect(dividers.nth(n - 1)).toHaveText(/^(今天|昨天) \d{1,2}:\d{2}$/);
      }
      if (id === MIDDLE) await evidenceShot(page, `chief-reply-run-hover-middle-${scheme}-1440.png`);
    }
    await page.mouse.move(0, 0);
    await evidenceShot(page, `chief-reply-run-${scheme}-1440.png`);
  });

  test(`at 390px a Coordinator reply shows no copy button and a press opens copy or select text (${scheme})`, async ({
    page,
  }) => {
    const stream = await openRun(page, 390, scheme);
    const reply = stream.locator(`[data-reply-source="${MIDDLE}"]`);
    await reply.scrollIntoViewIfNeeded();
    await reply.locator('[data-slot="reply-block"]').first().hover();
    expect(await visibleCopies(page), 'no reply copy button at 390px').toBe(0);
    for (const { id } of RUN) {
      await expect(
        stream.locator(`[data-reply-source="${id}"]`).locator('[data-tool="copy"]'),
        `${id}: no copy control rendered at all`,
      ).toHaveCount(0);
      expect(await boundaryInk(stream.locator(`[data-reply-source="${id}"]`))).toEqual({
        bar: 0,
        hairline: 0,
      });
    }
    await expect(stream.getByTestId('chief-time-divider')).toHaveCount(RUN.length - 1);

    await reply.locator('[data-slot="reply-block"]').first().click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['复制', '选择文字']);
    await evidenceShot(page, `chief-reply-press-menu-${scheme}-390.png`);
    await menu.getByRole('menuitem', { name: '选择文字' }).click();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toContain('第一，package.json 里升级了一个依赖');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, 'R1: no horizontal scroll at 390px').toBeLessThanOrEqual(0);
  });
}

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a long press on a Coordinator reply opens exactly copy and select text, and copy copies the whole reply', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const stream = await openRun(page, 390, 'light');
    const reply = stream.locator(`[data-reply-source="${MIDDLE}"]`);
    await reply.scrollIntoViewIfNeeded();
    await expect(reply.locator('[data-tool="copy"]')).toHaveCount(0);
    await reply.locator('[data-slot="reply-block"]').first().tap();
    await expect(page.getByRole('menu'), 'a tap opens nothing').toHaveCount(0);
    expect(await visibleCopies(page), 'a tap reveals no copy row').toBe(0);

    const box = await boxOf(reply.locator('[data-slot="reply-block"]').first());
    const cdp = await context.newCDPSession(page);
    const point = [{ x: box.x + 40, y: box.y + 10 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['复制', '选择文字']);
    for (const item of await menu.getByRole('menuitem').all()) {
      const itemBox = await boxOf(item);
      expect(itemBox.height, 'A1: touch target >= 44px').toBeGreaterThanOrEqual(44);
    }
    await menu.getByRole('menuitem', { name: '复制' }).click();
    await expect(page.getByText('已复制')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(RUN[2].content);
  });
});

async function isHittableCopy(tools: Locator): Promise<boolean> {
  return tools.locator('[data-tool="copy"]').evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== null && el.contains(top);
  });
}


test('a task transcript reply keeps its action row clear of the next row (1440px)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(REVIEW_TASK);
  const rows = page.locator('.chat-row--agent[data-tools-root]');
  await expect(rows.first()).toBeVisible();
  const transcript = page.locator('body');
  const count = await rows.count();
  for (let n = 0; n < count; n++) {
    const row = rows.nth(n);
    await row.scrollIntoViewIfNeeded();
    await row.locator('[data-slot="reply-block"]').first().hover();
    const tools = row.getByTestId('msg-tools');
    await expect(tools).toHaveCSS('opacity', '1');
    expect(await textUnder(tools, transcript), `agent row ${n}: action row covers no text`).toEqual(
      [],
    );
  }
});
