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

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`each of many consecutive Coordinator replies has one copy row of its own that covers no text (${scheme}, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), scheme);
      const now = Date.now();
      await mockLive(page, {
        threads: [THREAD],
        messages: [
          { id: 'u-1', role: 'user', content: 'code-review 任务怎么停了？', createdAt: now - 90_000 },
          ...RUN.map((reply, n) => ({
            id: reply.id,
            role: 'assistant' as const,
            content: reply.content,
            createdAt: now - 60_000 + n * 1_000,
          })),
        ],
      });
      await page.goto('/app');
      const stream = page.getByTestId('home-c').getByTestId('chief-stream');
      await expect(stream).toContainText('大约两分钟后开始');
      await page.mouse.move(0, 0);

      const latestTools = stream.locator('[data-reply-source="a-last"]').getByTestId('chief-msg-foot');
      await expect(latestTools, 'the latest reply shows its row without hover').toHaveCSS(
        'opacity',
        '1',
      );

      for (const [n, { id }] of RUN.entries()) {
        const reply = stream.locator(`[data-reply-source="${id}"]`);
        await reply.scrollIntoViewIfNeeded();
        await expect(
          reply.locator('[data-tool="copy"]').filter({ visible: true }),
          `${id}: one copy control per reply`,
        ).toHaveCount(1);
        const bubbles = reply.getByTestId('chief-reply-bubble');
        const count = await bubbles.count();
        for (let b = 0; b < count; b++) {
          const tools = reply.getByTestId('chief-msg-foot');
          await expect(async () => {
            await bubbles.nth(b).hover();
            await expect(tools).toHaveCSS('opacity', '1', { timeout: 1_000 });
          }).toPass();
          const shown = id === 'a-last' ? 1 : 2;
          await expect
            .poll(() => visibleCopies(page), `${id}: only this reply and the latest show a copy`)
            .toBe(shown);
          expect(await textUnder(tools, stream), `${id}: its row covers no message text`).toEqual(
            [],
          );
        }
        const tools = reply.getByTestId('chief-msg-foot');
        const own = await boxOf(reply.locator('[data-slot="reply-blocks"], [data-slot="reply-block"]').first());
        const row = await boxOf(tools);
        expect(row.y, `${id}: its row sits under its own text`).toBeGreaterThanOrEqual(
          own.y + own.height - 1,
        );
        const next = RUN[n + 1];
        if (next !== undefined) {
          const nextReply = await boxOf(stream.locator(`[data-reply-source="${next.id}"]`));
          const above = row.y - (own.y + own.height);
          const below = nextReply.y - (row.y + row.height);
          expect(below, `${id}: its row clears the next reply`).toBeGreaterThan(0);
          expect(above, `${id}: its row hugs its own reply, not the next`).toBeLessThan(below);
        }
        if (id === MIDDLE) {
          await bubbles.first().hover();
          await expect(tools).toHaveCSS('opacity', '1');
          await evidenceShot(page, `chief-reply-run-hover-middle-${scheme}-${width}.png`);
        }
      }
      await page.mouse.move(0, 0);
      await evidenceShot(page, `chief-reply-run-${scheme}-${width}.png`);
    });
  }
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
