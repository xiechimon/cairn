import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';
import { evidenceShot } from './evidence';

const ROUTE = '/app?scenario=chief-md-ref';

const reply = (page: Page) =>
  page
    .getByTestId('home-c')
    .getByTestId('chief-msg')
    .filter({ hasText: '这是一段测试用的 Markdown' });

test('one reply is one text block with loose paragraph spacing inside; tables and code are bordered surfaces', async ({
  page,
}) => {
  await page.goto(ROUTE);
  const message = reply(page);
  const blocks = message.locator('[data-slot="reply-block"]');
  await expect(blocks).toHaveCount(5);
  await expect(message.getByTestId('chief-reply-bubble')).toHaveCount(3);
  const bubble = message.getByTestId('chief-reply-bubble').first();
  await expect(bubble).toHaveCSS('padding-left', '0px');
  const inner = await bubble
    .locator('.chat-md-block')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  expect(inner.length).toBe(4);
  for (let i = 1; i < inner.length; i++) {
    const prev = inner[i - 1];
    const next = inner[i];
    if (prev === undefined || next === undefined) continue;
    expect(Math.round(next.top - prev.bottom), `loose gap before inner block ${i}`).toBe(12);
  }
  const boxes = await blocks.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1];
    const next = boxes[i];
    if (prev === undefined || next === undefined) continue;
    expect(Math.round(next.top - prev.bottom), `gap before block ${i}`).toBe(12);
  }
  const widest = Math.max(...boxes.map((box) => box.width));
  expect(widest).toBeLessThanOrEqual(576);
  const table = message.getByTestId('md-table');
  await expect(table).toHaveCSS('border-top-width', '1px');
  await expect(table.locator('xpath=ancestor::*[@data-slot="reply-bubble"]')).toHaveCount(0);
  await expect(table.locator('td').nth(1)).toHaveCSS('text-align', 'right');
  await expect(message.getByTestId('md-code-block')).toHaveCount(1);
  await evidenceShot(page, 'chief-reply-bubbles.png');
});

test('headings, inline styles, quote and a task list with the dashed-circle and filled-check glyphs render through the parser', async ({ page }) => {
  await page.goto(ROUTE);
  const message = reply(page);
  await expect(message.locator('h1.chat-md-head')).toHaveCSS('font-size', '18px');
  await expect(message.locator('h2.chat-md-head')).toHaveCSS('font-size', '16px');
  await expect(message.locator('em')).toHaveText('斜体');
  await expect(message.locator('del')).toHaveText('删除线');
  await expect(message.getByTestId('md-quote')).toHaveCSS('border-left-width', '3px');
  const boxes = message.getByTestId('md-checkbox');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(boxes.nth(1)).toBeDisabled();
  await expect(boxes.nth(0)).toHaveCSS('border-top-style', 'dashed');
  await expect(boxes.nth(0)).toHaveCSS('border-top-left-radius', /e\+\d+px$|^8px$/);
  await expect(boxes.nth(1).locator('svg')).toHaveCount(1);
  await expect(message.getByTestId('md-item-task').nth(1)).toHaveCSS('text-decoration-line', 'line-through');
  await expect(message.getByTestId('md-tasks')).toHaveCount(0);
  const linkInk = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--chat-link)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(['rgb(47, 86, 176)', 'rgb(122, 165, 224)']).toContain(linkInk);
  await expect(message.getByRole('link', { name: '链接示例' })).toHaveCSS('color', linkInk);
  await expect(message.getByRole('link', { name: '链接示例' })).toHaveCSS('text-decoration-line', 'underline');
  await expect(message.getByRole('link', { name: '链接示例' })).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await expect(message).not.toContainText('**');
  await expect(message).not.toContainText('~~');
});

test('C31: a Coordinator reply sits in the grey reply bubble and the owner keeps the sand bubble, both in the one sans', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-voice');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  const reply = stream.getByTestId('chief-msg').filter({ hasText: '压测结果整理好了' });
  await expect(reply.getByTestId('chief-reply').first()).toBeVisible();
  const look = await page.evaluate(() => {
    const resolve = (prop: 'fontFamily' | 'backgroundColor', value: string) => {
      const probe = document.createElement('div');
      probe.style[prop] = value;
      document.body.append(probe);
      const out = getComputedStyle(probe)[prop];
      probe.remove();
      return out;
    };
    const style = (el: Element | null) => {
      if (el === null) return null;
      const css = getComputedStyle(el);
      return { background: css.backgroundColor, font: css.fontFamily, size: css.fontSize };
    };
    const coordinator = [
      ...document.querySelectorAll(
        '[data-testid="chief-stream"] [data-slot="message-bubble"][data-side="coordinator"]',
      ),
    ].map(style);
    const owner = [
      ...document.querySelectorAll(
        '[data-testid="chief-stream"] [data-slot="message-bubble"][data-side="owner"]',
      ),
    ].map(style);
    const table = style(document.querySelector('[data-testid="chief-stream"] [data-testid="md-table"]'));
    const para = document.querySelector('[data-testid="chief-stream"] [data-testid="chief-reply"] .chat-para');
    const item = document.querySelector('[data-testid="chief-stream"] [data-testid="chief-reply"] li');
    const metrics = (el: Element | null) =>
      el === null ? null : { size: getComputedStyle(el).fontSize, family: getComputedStyle(el).fontFamily };
    return {
      sans: resolve('fontFamily', 'var(--font-sans)'),
      sand: resolve('backgroundColor', 'var(--bubble-fill)'),
      grey: resolve('backgroundColor', 'var(--reply-bubble-fill)'),
      serifLeft: [...document.querySelectorAll('[data-testid="chief-stream"] *')].filter((el) =>
        getComputedStyle(el).fontFamily.includes('sourceSerif4'),
      ).length,
      coordinator,
      owner,
      table,
      para: metrics(para),
      item: metrics(item),
    };
  });
  expect(look.coordinator.length).toBeGreaterThanOrEqual(3);
  for (const said of look.coordinator) {
    expect(said?.background, 'C31: a Coordinator reply sits in the grey reply bubble').toBe(look.grey);
    expect(said?.font, 'C31: a Coordinator reply is set in the sans').toBe(look.sans);
  }
  expect(look.serifLeft, 'C31: no serif is left in the conversation').toBe(0);
  expect(look.owner.length).toBe(4);
  for (const own of look.owner) {
    expect(own?.background, 'C31: the owner keeps the sand bubble').toBe(look.sand);
    expect(own?.font, 'C31: the owner bubble is set in the same sans').toBe(look.sans);
    expect(own?.size, 'C31: both sides share one size').toBe(look.coordinator[0]?.size);
  }
  expect(look.table?.font, 'C31: a table stays in the sans').toBe(look.sans);
  expect(look.para, 'C31: reply prose is the bubble size in the sans').toEqual({
    size: look.coordinator[0]?.size,
    family: look.sans,
  });
  expect(look.item?.size, 'C31: a list inside a reply keeps the bubble size').toBe(look.coordinator[0]?.size);
  await expect(stream.getByTestId('md-code-block')).toHaveCount(1);
  await expect(stream.getByTestId('chief-turn-error')).toHaveCount(1);
});

async function measureTable(table: ReturnType<Page['locator']>) {
  return table.evaluate((wrapper) => {
    const bubble = wrapper.closest('[data-slot="message-bubble"]') ?? wrapper;
    const inside = wrapper.getBoundingClientRect();
    const outside = bubble.getBoundingClientRect();
    const beforeScroll = wrapper.scrollLeft;
    wrapper.scrollLeft = wrapper.scrollWidth;
    const reached = wrapper.scrollLeft;
    const lastHead = wrapper.querySelector('thead th:last-child')?.getBoundingClientRect();
    const cells = [...wrapper.querySelectorAll('th, td')].map((cell) => {
      const box = cell.getBoundingClientRect();
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      }
      rects.sort((a, b) => a.top - b.top);
      let lines = 0;
      let floor = Number.NEGATIVE_INFINITY;
      for (const rect of rects) {
        if ((rect.top + rect.bottom) / 2 <= floor) continue;
        lines += 1;
        floor = rect.bottom;
      }
      let textSpill = 0;
      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) continue;
        textSpill = Math.max(
          textSpill,
          Math.ceil(rect.right - box.right),
          Math.ceil(box.left - rect.left),
        );
      }
      return {
        text: (cell.textContent ?? '').trim(),
        width: Math.round(box.width),
        lines,
        textSpill,
      };
    });
    wrapper.scrollLeft = beforeScroll;
    return {
      spill: Math.max(0, Math.round(inside.right - outside.right)),
      overflows: wrapper.scrollWidth > wrapper.clientWidth,
      reached,
      lastShown: lastHead !== undefined && lastHead.right <= inside.right + 2,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      cells,
    };
  });
}

for (const width of [1440, 390]) {
  test(`C46: wide, medium, prose, and multi-column reply tables at ${width}px size cells up to 16rem, keep short words whole, and scroll inside the bubble`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });

    await page.goto('/app?scenario=chief-wide-table');
    const wideLoc = page.getByTestId('home-c').getByTestId('md-table');
    const wide = await measureTable(wideLoc);
    expect(wide.spill, 'wide table stays inside bubble').toBe(0);
    expect(wide.overflows, 'wide table scrolls horizontally inside bubble').toBe(true);
    expect(wide.reached, 'wide table horizontal scroll advances').toBeGreaterThan(0);
    expect(wide.lastShown, 'wide table last column can scroll into view').toBe(true);
    expect(wide.pageOverflow, 'page does not scroll sideways').toBeLessThanOrEqual(0);
    await expect(wideLoc).toHaveAttribute('tabindex', '0');
    await expect(wideLoc).toHaveAttribute('role', 'region');
    await expect(wideLoc).toHaveAttribute('aria-label', '可横向滚动的表格');
    await wideLoc.focus();
    await expect(wideLoc).toBeFocused();
    await expect
      .poll(
        async () => {
          await page.keyboard.press('ArrowRight');
          return wideLoc.evaluate((node) => {
            const last = node.querySelector('thead th:last-child')?.getBoundingClientRect();
            return {
              scrollLeft: node.scrollLeft,
              lastVisible: last !== undefined && last.right <= node.getBoundingClientRect().right + 2,
            };
          });
        },
        { timeout: 5_000, intervals: [50] },
      )
      .toMatchObject({ lastVisible: true });
    const scrolledAfterKey = await wideLoc.evaluate((node) => node.scrollLeft);
    expect(scrolledAfterKey, 'keyboard ArrowRight scrolls table').toBeGreaterThan(0);
    for (const label of ['xiechimon', '欧阳小明', 'releasebot']) {
      const cell = wide.cells.find((c) => c.text === label);
      expect(cell?.lines, `short cell "${label}" stays on one line`).toBe(1);
    }
    const wideHeader = wide.cells.find((c) => c.text.startsWith('其他（'));
    expect(wideHeader, 'wide header exists').toBeDefined();
    if (!wideHeader) throw new Error('missing wide header');
    expect(wideHeader.width, 'wide header caps around 16rem + padding').toBeLessThanOrEqual(286);
    expect(wideHeader.lines, 'wide header wraps inside 16rem cell').toBeGreaterThanOrEqual(2);
    expect(wideHeader.textSpill, 'wide header text stays inside cell bounds').toBeLessThanOrEqual(1);

    await page.goto('/app?scenario=chief-medium-table');
    const mediumTables = page.getByTestId('home-c').getByTestId('md-table');
    await expect(mediumTables).toHaveCount(2);
    const medium = await measureTable(mediumTables.nth(0));
    expect(medium.spill).toBe(0);
    expect(medium.pageOverflow).toBeLessThanOrEqual(0);
    for (const label of [
      '发送修复',
      '11-26 23:58:16',
      'macmini-runner',
      'fix/reply-table',
      'passed on retry',
      'claude-sonnet-5',
    ]) {
      const cell = medium.cells.find((c) => c.text === label);
      expect(cell?.lines, `medium table cell "${label}" stays on one line`).toBe(1);
    }
    const shortLoc = mediumTables.nth(1);
    const shortTable = await measureTable(shortLoc);
    expect(shortTable.spill).toBe(0);
    expect(shortTable.pageOverflow).toBeLessThanOrEqual(0);
    if (width === 1440) {
      expect(shortTable.overflows, 'short table fits at 1440px without scrolling').toBe(false);
      await expect(shortLoc).not.toHaveAttribute('tabindex');
      await expect(shortLoc).not.toHaveAttribute('role');
      await expect(shortLoc).not.toHaveAttribute('aria-label');

      await shortLoc.evaluate((node) => {
        const border = node.offsetWidth - node.clientWidth;
        node.style.maxWidth = `${node.scrollWidth - 1 + border}px`;
      });
      await expect(shortLoc).toHaveAttribute('tabindex', '0');
      await expect(shortLoc).toHaveAttribute('role', 'region');
      await expect(shortLoc).toHaveAttribute('aria-label', '可横向滚动的表格');
      const onePxOverflow = await shortLoc.evaluate((node) => node.scrollWidth - node.clientWidth);
      expect(onePxOverflow, 'short table overflow is exactly 1 CSS px').toBe(1);

      await shortLoc.evaluate((node) => {
        node.style.maxWidth = '';
      });
      await expect(shortLoc).not.toHaveAttribute('tabindex');
      await expect(shortLoc).not.toHaveAttribute('role');
      await expect(shortLoc).not.toHaveAttribute('aria-label');

      await page.setViewportSize({ width: 240, height: 900 });
      await expect(shortLoc).toHaveAttribute('tabindex', '0');
      await expect(shortLoc).toHaveAttribute('role', 'region');
      await expect(shortLoc).toHaveAttribute('aria-label', '可横向滚动的表格');
      await shortLoc.focus();
      await expect(shortLoc).toBeFocused();
      await expect
        .poll(
          async () => {
            await page.keyboard.press('ArrowRight');
            return shortLoc.evaluate((node) => {
              const last = node.querySelector('thead th:last-child')?.getBoundingClientRect();
              return {
                scrolled: node.scrollLeft > 0,
                lastVisible: last !== undefined && last.right <= node.getBoundingClientRect().right + 2,
              };
            });
          },
          { timeout: 5_000, intervals: [50] },
        )
        .toEqual({ scrolled: true, lastVisible: true });

      await page.setViewportSize({ width, height: 900 });
      await expect(shortLoc).not.toHaveAttribute('tabindex');
      await expect(shortLoc).not.toHaveAttribute('role');
      await expect(shortLoc).not.toHaveAttribute('aria-label');
    }

    await page.goto('/app?scenario=chief-prose-table');
    const proseTables = page.getByTestId('home-c').getByTestId('md-table');
    await expect(proseTables).toHaveCount(2);
    const prose = await measureTable(proseTables.nth(0));
    expect(prose.spill).toBe(0);
    expect(prose.pageOverflow).toBeLessThanOrEqual(0);
    for (const label of ['重试预算', '发送修复', '进行中', '已完成', 'mini']) {
      const cell = prose.cells.find((c) => c.text === label);
      expect(cell?.lines, `prose sibling short cell "${label}" stays on one line`).toBe(1);
    }
    const longPaths = await measureTable(proseTables.nth(1));
    expect(longPaths.spill).toBe(0);
    expect(longPaths.pageOverflow).toBeLessThanOrEqual(0);
    for (const cell of longPaths.cells) {
      expect(cell.width, `long path/url cell "${cell.text}" caps around 16rem`).toBeLessThanOrEqual(286);
      expect(cell.textSpill, `long path/url cell "${cell.text}" stays inside cell bounds`).toBeLessThanOrEqual(1);
    }
    for (const prefix of ['pnpm ', 'apps/web/src/', 'https://example.com/']) {
      const wrappedCell = longPaths.cells.find((c) => c.text.startsWith(prefix));
      expect(wrappedCell, `long token cell "${prefix}" exists`).toBeDefined();
      if (!wrappedCell) throw new Error(`missing long token cell ${prefix}`);
      expect(wrappedCell.lines, `long token "${prefix}" wraps onto >=2 lines`).toBeGreaterThanOrEqual(2);
      expect(wrappedCell.textSpill, `long token "${prefix}" stays inside cell bounds`).toBeLessThanOrEqual(1);
    }

    await page.goto('/app?scenario=chief-table-matrix');
    const matrix = page.getByTestId('home-c').getByTestId('md-table');
    await expect(matrix).toHaveCount(3);

    const cjkMidWide = await measureTable(matrix.nth(0));
    expect(cjkMidWide.spill).toBe(0);
    expect(cjkMidWide.overflows).toBe(true);
    expect(cjkMidWide.pageOverflow).toBeLessThanOrEqual(0);
    for (const label of ['macmini-runner', 'fix/reply-table', 'claude-sonnet-5', '11-26 23:58:16']) {
      const cell = cjkMidWide.cells.find((c) => c.text === label);
      expect(cell?.lines, `cjkMidWide short cell "${label}" stays on one line`).toBe(1);
    }
    const cjkNote = cjkMidWide.cells.find((c) => c.text.includes('压测显示跨区链路超时最多'));
    expect(cjkNote, 'cjkMidWide prose cell exists').toBeDefined();
    if (!cjkNote) throw new Error('missing cjkNote cell');
    expect(cjkNote.width, 'cjkMidWide prose cell is not crushed vertically').toBeGreaterThanOrEqual(160);
    expect(cjkNote.width).toBeLessThanOrEqual(286);
    expect(cjkNote.textSpill).toBeLessThanOrEqual(1);

    const manyProseCjk = await measureTable(matrix.nth(1));
    expect(manyProseCjk.spill).toBe(0);
    expect(manyProseCjk.overflows).toBe(true);
    expect(manyProseCjk.pageOverflow).toBeLessThanOrEqual(0);
    for (const cell of manyProseCjk.cells.filter((c) => c.text.length >= 12)) {
      expect(cell.width, `manyProseCjk cell "${cell.text}" stays readable >= 140px`).toBeGreaterThanOrEqual(140);
      expect(cell.width).toBeLessThanOrEqual(286);
    }

    const manyProseEn = await measureTable(matrix.nth(2));
    expect(manyProseEn.spill).toBe(0);
    expect(manyProseEn.overflows).toBe(true);
    expect(manyProseEn.pageOverflow).toBeLessThanOrEqual(0);
    for (const cell of manyProseEn.cells.filter((c) => c.text.length >= 18)) {
      expect(cell.width, `manyProseEn cell "${cell.text}" stays readable >= 140px`).toBeGreaterThanOrEqual(140);
      expect(cell.width).toBeLessThanOrEqual(286);
    }
  });
}

test('consecutive assistant replies separated by thinking or tool calls cluster at 2px like user bubbles, while user-to-assistant stays 24px', async ({
  page,
}) => {
  const now = Date.now();
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'u-1', role: 'user', content: '测试', createdAt: now - 120_000 },
      { id: 'u-2', role: 'user', content: '你是什么大模型', createdAt: now - 110_000 },
      {
        id: 'a-1',
        role: 'assistant',
        content: '收到，我在的。有什么需要我做的随时告诉我。',
        createdAt: now - 100_000,
      },
      {
        id: 'a-think',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '检查 usage 记录' }],
        createdAt: now - 95_000,
      },
      {
        id: 'a-tool',
        role: 'assistant',
        content: {
          kind: 'toolcall',
          call: { id: 'tc-1', name: 'read_usage', arguments: {}, result: 'ok' },
        },
        createdAt: now - 92_000,
      },
      {
        id: 'a-2',
        role: 'assistant',
        content: '我查了 usage 记录，我现在使用的是 Gemini 4。',
        createdAt: now - 90_000,
      },
    ],
  });

  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText('我查了 usage 记录');

  const userBubbles = stream.locator('[data-slot="message-bubble"][data-side="owner"]');
  const replyBubbles = stream.locator('[data-slot="message-bubble"][data-side="coordinator"]');
  await expect(userBubbles).toHaveCount(2);
  await expect(replyBubbles).toHaveCount(2);

  await expect(userBubbles.nth(0)).toHaveAttribute('data-run', 'first');
  await expect(userBubbles.nth(1)).toHaveAttribute('data-run', 'last');
  await expect(replyBubbles.nth(0)).toHaveAttribute('data-run', 'first');
  await expect(replyBubbles.nth(1)).toHaveAttribute('data-run', 'last');

  const boxes = await page.evaluate(() => {
    const rect = (el: Element | null) => el?.getBoundingClientRect() ?? null;
    const users = [
      ...document.querySelectorAll('[data-testid="chief-stream"] [data-slot="message-bubble"][data-side="owner"]'),
    ].map(rect);
    const replies = [
      ...document.querySelectorAll(
        '[data-testid="chief-stream"] [data-slot="message-bubble"][data-side="coordinator"]',
      ),
    ].map(rect);
    return { users, replies };
  });

  const uGap = Math.round(boxes.users[1]!.top - boxes.users[0]!.bottom);
  const rGap = Math.round(boxes.replies[1]!.top - boxes.replies[0]!.bottom);
  const turnGap = Math.round(boxes.replies[0]!.top - boxes.users[1]!.bottom);

  expect(uGap).toBe(2);
  expect(rGap).toBe(2);
  expect(turnGap).toBe(24);
});
