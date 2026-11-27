import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const DECK_TASK = { ...TASK, id: 'todo-s', title: '整理 Q3 复盘幻灯片', phase: 'done', seqNum: 31 };

const DECK = `<!doctype html><html data-slides><head><style>.slide{padding:120px;font:64px sans-serif}</style></head><body>
<section class="slide cover"><h1>Q3 复盘</h1><p>2026 年第三季度</p></section>
<section class="slide"><h2>本季目标</h2><input aria-label="slide-input" /></section>
<section class="slide"><h2>收入</h2><div><b>¥1,280 万</b> 同比 +18%</div></section>
</body></html>`;

const LANDING = `<!doctype html><html><body><h1>Cairn 定价</h1><section class="slide"><p>轮播：每月 ¥99</p></section><section class="slide"><p>轮播：团队版</p></section></body></html>`;

const SHORT = `<!doctype html><html data-slides><body><section class="slide"><h1>只剩封面</h1></section></body></html>`;

type Comment = Record<string, unknown> & { id: string; pin: number; status: string };

function seeded(id: string, pin: number, anchor: Record<string, unknown> | null, note: string): Comment {
  return {
    id,
    todoId: DECK_TASK.id,
    fileName: 'q3-review.html',
    versionId: 'ver-s2',
    versionSeq: 2,
    pin,
    viewport: 'desktop',
    selector: 'h1',
    elementId: '',
    label: 'h1',
    text: 'Q3 复盘',
    note,
    markAttachmentId: null,
    anchor,
    status: 'open',
    messageId: null,
    sentAt: null,
    handledSeq: null,
    createdAt: Date.now() - 30_000,
    updatedAt: Date.now() - 30_000,
  };
}

async function openFile(page: Page, fileName: string, html: string, comments: Comment[] = []) {
  const state = { comments, posts: [] as Record<string, unknown>[] };
  const version = (seq: number, body: string) => ({
    id: `ver-s${seq}`,
    todoId: DECK_TASK.id,
    fileName,
    seq,
    attachmentId: 'att-deck',
    sizeBytes: body.length,
    source: 'agent',
    restoredFromSeq: null,
    createdAt: Date.now() - (3 - seq) * 60_000,
  });
  const older = version(1, SHORT);
  const current = version(2, html);
  const pages: Record<string, string> = { [older.id]: SHORT, [current.id]: html };
  const base = `/api/todos/${DECK_TASK.id}/design`;
  await mockLive(page, { threads: [THREAD], messages: [], todos: [DECK_TASK] } as Parameters<typeof mockLive>[1], (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/attachments/att-deck/artifact')
      return json({
        todoId: DECK_TASK.id,
        fileName,
        kind: 'page',
        versionId: current.id,
        versionSeq: 2,
        versionCount: 2,
        openComments: 0,
      });
    if (path === `/api/todos/${DECK_TASK.id}`) return json(DECK_TASK);
    if (path === base)
      return json({
        pages: [{ fileName, current, versionCount: 2, openComments: 0, shareToken: null }],
        shareOrigin: null,
      });
    if (path === `${base}/${fileName}/versions`) return json([older, current]);
    if (path === `${base}/${fileName}/comments`) return json(state.comments);
    if (path === `${base}/comments` && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.posts.push(body);
      const row: Comment = {
        ...body,
        id: `cmt-${state.comments.length + 1}`,
        todoId: DECK_TASK.id,
        fileName,
        versionSeq: 2,
        pin: state.comments.length + 1,
        markAttachmentId: null,
        anchor: body.anchor ?? null,
        status: 'open',
        messageId: null,
        sentAt: null,
        handledSeq: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.comments = [...state.comments, row];
      return json(row, 201);
    }
    const pageId = /^\/api\/design\/versions\/([^/]+)\/page$/.exec(path)?.[1];
    if (pageId !== undefined && pages[pageId] !== undefined)
      return route.fulfill({ status: 200, contentType: 'text/html', body: pages[pageId] });
    return undefined;
  });
  await page.goto(`/app?artifact=att-deck.html&artifactName=${encodeURIComponent(fileName)}`);
  const panel = page.getByTestId('artifact-panel');
  return { panel, frame: panel.getByTestId('design-frame').contentFrame(), state };
}

test('a page whose carousel uses section.slide, without the deck mark, opens as a page', async ({ page }) => {
  const { panel, frame } = await openFile(page, 'pricing.html', LANDING);
  await expect(frame.getByRole('heading', { name: 'Cairn 定价' })).toBeVisible();
  await expect(frame.getByText('轮播：团队版')).toBeVisible();
  await expect(panel.getByTestId('design-viewport-mobile')).toBeVisible();
  await expect(panel.getByTestId('artifact-slides')).toHaveCount(0);
  await expect(panel.getByTestId('artifact-deck-position')).toHaveCount(0);
});

test('an HTML deck shows one 16:9 slide at a time and pages with the pager and the keyboard', async ({ page }) => {
  const { panel, frame } = await openFile(page, 'q3-review.html', DECK);
  const position = panel.getByTestId('artifact-deck-position');
  await expect(position).toHaveText('1 / 3');
  await expect(frame.getByRole('heading', { name: 'Q3 复盘' })).toBeVisible();
  await expect(frame.getByRole('heading', { name: '收入' })).toBeHidden();
  await expect(panel.getByTestId('design-viewport-mobile')).toHaveCount(0);
  const box = await panel.getByTestId('design-stage').boundingBox();
  if (box === null) throw new Error('stage not laid out');
  expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.01);
  await expect(panel.getByTestId('artifact-deck-prev')).toBeDisabled();

  await panel.getByTestId('artifact-deck-next').click();
  await expect(position).toHaveText('2 / 3');
  await expect(frame.getByRole('heading', { name: '本季目标' })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Q3 复盘' })).toBeHidden();

  await frame.getByRole('textbox', { name: 'slide-input' }).fill('x');
  await frame.getByRole('textbox', { name: 'slide-input' }).press('ArrowRight');
  await expect(position).toHaveText('2 / 3');

  await frame.getByRole('heading', { name: '本季目标' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(position).toHaveText('3 / 3');
  await expect(panel.getByTestId('artifact-deck-next')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(position).toHaveText('3 / 3');

  await panel.getByTestId('artifact-deck-prev').click();
  await page.keyboard.press('ArrowLeft');
  await expect(position).toHaveText('1 / 3');
});

test('present fills the screen with the deck, Esc never closes the panel, and leaving full screen keeps the slide', async ({ page }) => {
  const { panel } = await openFile(page, 'q3-review.html', DECK);
  await panel.getByTestId('artifact-deck-next').click();
  await panel.getByTestId('artifact-comment-toggle').click();
  await expect(panel.getByTestId('design-comment-list')).toBeVisible();
  await panel.getByTestId('artifact-deck-present').click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null))
    .toBe('artifact-slides');
  await expect(panel.getByTestId('artifact-deck-present')).toHaveCount(0);
  await expect(panel.getByTestId('design-comment-list')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('3 / 3');
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await page.evaluate(() => (document.fullscreenElement === null ? undefined : document.exitFullscreen()));
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('3 / 3');
  await expect(panel.getByTestId('artifact-deck-present')).toBeVisible();
});

test('a comment on a slide saves the slide, pins only on that slide and the list row brings it back', async ({
  page,
}) => {
  const { panel, frame, state } = await openFile(page, 'q3-review.html', DECK);
  await panel.getByTestId('artifact-deck-next').click();
  await panel.getByTestId('artifact-deck-next').click();
  await expect(frame.getByText('¥1,280 万')).toBeVisible();

  await panel.getByTestId('artifact-comment-toggle').click();
  await expect(panel.getByTestId('artifact-comment-strip')).toBeVisible();
  await expect(panel.getByTestId('design-mark-mode')).toHaveCount(0);
  await frame.getByRole('heading', { name: '收入' }).click();
  const popover = page.getByTestId('design-comment-popover');
  await expect(popover).toBeVisible();
  await panel.getByTestId('artifact-deck-prev').click();
  await expect(popover).toHaveCount(0);
  await panel.getByTestId('artifact-deck-next').click();
  await frame.getByText('¥1,280 万').click();
  await popover.getByTestId('design-comment-note').fill('换成柱状图');
  await popover.getByTestId('design-comment-save').click();
  await expect(popover).toHaveCount(0);
  expect(state.posts[0]).toMatchObject({ anchor: { type: 'slide', slide: 3 }, viewport: 'desktop', label: 'b' });
  await expect(panel.locator('[data-testid="design-pin"][data-pin="1"]')).toBeVisible();
  await expect(panel.getByTestId('design-comment-where')).toHaveText(/^第 3 页幻灯片 · b「¥1,280 万」/);

  await page.keyboard.press('Escape');
  await panel.getByTestId('artifact-deck-prev').click();
  await panel.getByTestId('artifact-deck-prev').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('1 / 3');
  await expect(panel.locator('[data-testid="design-pin"][data-pin="1"]')).toHaveCount(0);

  await panel.getByTestId('design-comment-where').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('3 / 3');
  await expect(panel.locator('[data-testid="design-pin"][data-pin="1"]')).toBeVisible();
});

test('a refused full screen keeps the slide and the comment list in the panel and says so', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'));
  });
  const { panel } = await openFile(page, 'q3-review.html', DECK);
  await panel.getByTestId('artifact-comment-toggle').click();
  await expect(panel.getByTestId('design-comment-list')).toBeVisible();
  await panel.getByTestId('artifact-deck-present').click();
  await expect(page.getByText('未能全屏放映')).toBeVisible();
  await expect(panel.getByTestId('design-comment-list')).toBeVisible();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('1 / 3');
});

test('an older version with fewer slides clamps to its last slide and the current version returns to where you were', async ({
  page,
}) => {
  const { panel, frame } = await openFile(page, 'q3-review.html', DECK);
  await panel.getByTestId('artifact-deck-next').click();
  await panel.getByTestId('artifact-deck-next').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('3 / 3');
  await panel.getByTestId('artifact-history-toggle').click();
  await panel.getByTestId('artifact-history').locator('[data-seq="1"]').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('1 / 1');
  await expect(frame.getByRole('heading', { name: '只剩封面' })).toBeVisible();
  await expect(panel.getByTestId('artifact-deck-next')).toBeDisabled();
  await panel.getByTestId('artifact-version-current').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('3 / 3');
  await expect(frame.getByRole('heading', { name: '收入' })).toBeVisible();
});

test('a browser without full screen offers no present button', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
  });
  const { panel } = await openFile(page, 'q3-review.html', DECK);
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('1 / 3');
  await expect(panel.getByTestId('artifact-deck-present')).toHaveCount(0);
});

test('source view and back keeps the slide', async ({ page }) => {
  const { panel, frame } = await openFile(page, 'q3-review.html', DECK);
  await panel.getByTestId('artifact-deck-next').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('2 / 3');
  await panel.getByTestId('design-source-toggle').click();
  await expect(panel.getByTestId('design-source')).toBeVisible();
  await panel.getByTestId('design-source-toggle').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('2 / 3');
  await expect(frame.getByRole('heading', { name: '本季目标' })).toBeVisible();
});

test('an older comment without a slide has no pin, and one past the last slide opens the last slide', async ({
  page,
}) => {
  const { panel } = await openFile(page, 'q3-review.html', DECK, [
    seeded('cmt-old', 1, null, '封面换图'),
    seeded('cmt-far', 2, { type: 'slide', slide: 9 }, '删掉这页'),
  ]);
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('1 / 3');
  await panel.getByTestId('artifact-comment-toggle').click();
  await expect(panel.getByTestId('design-comment-row')).toHaveCount(2);
  await expect(panel.getByTestId('design-pin')).toHaveCount(0);
  await panel.getByTestId('design-comment-where').filter({ hasText: '第 9 页幻灯片' }).click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('3 / 3');
});

test('a marked file without any slide falls back to the page', async ({ page }) => {
  const { panel, frame } = await openFile(
    page,
    'notes.html',
    '<!doctype html><html data-slides><body><h1>只有标题</h1></body></html>',
  );
  await expect(frame.getByRole('heading', { name: '只有标题' })).toBeVisible();
  await expect(panel.getByTestId('design-viewport-mobile')).toBeVisible();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveCount(0);
});

test('present from the last slide still pages back with the keyboard', async ({ page }) => {
  const { panel } = await openFile(page, 'q3-review.html', DECK);
  await panel.getByTestId('artifact-deck-next').click();
  await panel.getByTestId('artifact-deck-next').click();
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('3 / 3');
  await panel.getByTestId('artifact-deck-present').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.keyboard.press('ArrowLeft');
  await expect(panel.getByTestId('artifact-deck-position')).toHaveText('2 / 3');
});
