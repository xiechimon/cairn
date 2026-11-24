import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

type Option = { label: string; description?: string; recommended?: boolean };
type Prompt = { header: string; question: string; options: Option[]; multiSelect?: boolean };

function ask(
  requestId: string,
  createdAt: number,
  questions: Prompt[],
  over: Record<string, unknown> = {},
) {
  return {
    id: `row-${requestId}`,
    role: 'assistant',
    createdAt,
    content: JSON.stringify({
      kind: 'ask_user_question',
      requestId,
      status: 'pending',
      questions,
      answers: null,
      ...over,
    }),
  };
}

const SALARY: Prompt = {
  header: 'Acme 面试回信',
  question: '回信里写期望年薪吗？',
  options: [
    { label: '写 65 万', description: '少一轮来回，报价也会被这个数封顶' },
    { label: '不写', description: '等对方先报价，谈判余地更大', recommended: true },
    { label: '写一个区间', description: '60 到 70 万，留出谈判空间' },
  ],
};

const ATTACH: Prompt = {
  header: 'Acme 面试回信',
  question: '回信里附上哪些材料？',
  multiSelect: true,
  options: [
    { label: '简历 PDF', description: '2026 年 11 月更新的版本', recommended: true },
    { label: '作品集链接', description: '三个项目，含 Cairn' },
    { label: '推荐人', description: '两位前同事，已同意被联系' },
  ],
};

const LEAD = { id: 'lead', role: 'user', content: 'Acme 的面试邀请帮我回一下，周二下午可以。', createdAt: 10 };

const state = (...questions: ReturnType<typeof ask>[]) => ({
  threads: [THREAD],
  messages: [LEAD, ...questions],
  todos: [],
});

type Posted = { path: string; body: { answers?: unknown[] } | null };

async function open(page: Page, data: ReturnType<typeof state>) {
  const posted: Posted[] = [];
  await mockLive(page, data, (path, route, json) => {
    if (route.request().method() !== 'POST' || !path.includes('/questions/')) return undefined;
    const body = (route.request().postDataJSON() as Posted['body']) ?? null;
    posted.push({ path, body });
    const requestId = /\/questions\/([^/]+)\//.exec(path)?.[1] ?? '';
    const cancelling = path.endsWith('/cancel');
    data.messages = data.messages.map((row) =>
      row.id === `row-${requestId}`
        ? {
            ...row,
            content: JSON.stringify({
              ...JSON.parse(row.content as string),
              status: cancelling ? 'cancelled' : 'answered',
              ...(cancelling
                ? { cancelledBy: 'person', cancelReason: '用户取消了本次提问' }
                : { answers: body?.answers ?? null }),
            }),
          }
        : row,
    );
    if (cancelling) return json({ ok: true });
    const updated = data.messages.find((row) => row.id === `row-${requestId}`);
    return json(updated === undefined ? {} : JSON.parse(updated.content as string));
  });
  await page.goto('/app');
  return posted;
}

const card = (page: Page) => page.getByTestId('chief-composer-block').getByTestId('chief-question');

test('the question card sits right above the composer: numbered rows with descriptions, the recommended first, nothing preselected, and one click answers', async ({
  page,
}) => {
  const posted = await open(page, state(ask('ask-salary', 20, [SALARY])));
  const dock = card(page);
  await expect(dock).toBeVisible();
  await expect(page.getByTestId('chief-stream').getByTestId('chief-question')).toHaveCount(0);
  await expect(dock.getByTestId('chief-question-text')).toHaveText('回信里写期望年薪吗？');
  const rows = dock.getByTestId(/^chief-question-option-0-\d$/);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('不写');
  await expect(rows.nth(0)).toContainText('推荐');
  await expect(rows.nth(0)).toContainText('等对方先报价，谈判余地更大');
  await expect(rows.nth(1)).toContainText('写 65 万');
  await expect(rows.nth(1)).not.toContainText('推荐');
  expect(await rows.evaluateAll((els) => els.map((el) => el.querySelector('[data-slot="question-key"]')?.textContent))).toEqual(['1', '2', '3']);
  for (const row of await rows.all()) await expect(row).toHaveAttribute('aria-pressed', 'false');
  const cardBox = (await dock.boundingBox())!;
  const composer = (await page.getByTestId('home-c').locator('.chief-composer').boundingBox())!;
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(composer.y);
  expect(composer.y - (cardBox.y + cardBox.height)).toBeLessThanOrEqual(12);
  expect(Math.abs(cardBox.x - composer.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(cardBox.width - composer.width)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('chief-composer-placeholder')).toHaveText('或者直接回复…');
  await page.waitForTimeout(300);
  expect(posted).toEqual([]);
  await rows.nth(1).click();
  await expect.poll(() => posted.map((p) => p.body)).toEqual([
    { answers: [{ header: 'Acme 面试回信', choices: ['写 65 万'] }] },
  ]);
  await expect(dock).toHaveCount(0);
  const receipt = page.getByTestId('chief-stream').getByTestId('chief-question-receipt');
  await expect(receipt).toHaveCount(1);
  await expect(receipt).toContainText('回信里写期望年薪吗？');
  await expect(receipt).toContainText('写 65 万');
  await expect(page.getByTestId('chief-stream').locator('[data-question-answer]')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-placeholder')).not.toHaveText('或者直接回复…');
});

test('the free-text row: skip turns into submit once typed, and Enter answers with the text', async ({ page }) => {
  const posted = await open(page, state(ask('ask-salary', 20, [SALARY])));
  const dock = card(page);
  const other = dock.getByTestId('chief-question-other');
  await expect(other).toHaveAttribute('placeholder', '输入你自己的回答…');
  await expect(dock.getByTestId('chief-question-skip')).toBeVisible();
  await expect(dock.getByTestId('chief-question-submit')).toHaveCount(0);
  await other.fill('先写 68 万');
  await expect(dock.getByTestId('chief-question-skip')).toHaveCount(0);
  await expect(dock.getByTestId('chief-question-submit')).toBeEnabled();
  expect(posted).toEqual([]);
  await other.press('Enter');
  await expect.poll(() => posted.map((p) => p.body)).toEqual([
    { answers: [{ header: 'Acme 面试回信', choices: ['先写 68 万'] }] },
  ]);
  await expect(dock).toHaveCount(0);
  await expect(page.getByTestId('chief-question-receipt')).toContainText('先写 68 万');
});

test('multi-select: checkboxes count what is picked, submit is off at zero, and nothing is sent until submit', async ({
  page,
}) => {
  const posted = await open(page, state(ask('ask-attach', 20, [ATTACH])));
  const dock = card(page);
  const boxes = dock.getByRole('checkbox');
  await expect(boxes).toHaveCount(4);
  for (const box of await boxes.all()) await expect(box).toHaveAttribute('aria-checked', 'false');
  await expect(dock.getByTestId('chief-question-count')).toHaveText('已选 0 个');
  const submit = dock.getByTestId('chief-question-submit');
  await expect(submit).toBeDisabled();
  await dock.getByTestId('chief-question-option-0-0').click();
  await dock.getByTestId('chief-question-option-0-2').click();
  await expect(dock.getByTestId('chief-question-count')).toHaveText('已选 2 个');
  await expect(boxes.nth(0)).toHaveAttribute('aria-checked', 'true');
  await dock.getByTestId('chief-question-other').fill('作品集 PDF 版');
  await expect(dock.getByTestId('chief-question-count')).toHaveText('已选 3 个');
  await page.waitForTimeout(300);
  expect(posted).toEqual([]);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => posted.map((p) => p.body)).toEqual([
    { answers: [{ header: 'Acme 面试回信', choices: ['简历 PDF', '推荐人', '作品集 PDF 版'] }] },
  ]);
  await expect(page.getByTestId('chief-question-receipt')).toContainText('简历 PDF、推荐人、作品集 PDF 版');
});

test('two pending questions page with ‹ 1/2 ›, and answering one brings the other', async ({ page }) => {
  const posted = await open(page, state(ask('ask-salary', 20, [SALARY]), ask('ask-attach', 21, [ATTACH])));
  const dock = card(page);
  await expect(dock.getByTestId('chief-question-position')).toHaveText('1/2');
  await expect(dock.getByTestId('chief-question-prev')).toBeDisabled();
  await dock.getByTestId('chief-question-next').click();
  await expect(dock.getByTestId('chief-question-position')).toHaveText('2/2');
  await expect(dock.getByTestId('chief-question-text')).toHaveText('回信里附上哪些材料？');
  await expect(dock.getByTestId('chief-question-next')).toBeDisabled();
  await dock.getByTestId('chief-question-prev').click();
  await expect(dock.getByTestId('chief-question-text')).toHaveText('回信里写期望年薪吗？');
  await dock.getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => posted.length).toBe(1);
  await expect(dock.getByTestId('chief-question-text')).toHaveText('回信里附上哪些材料？');
  await expect(dock.getByTestId('chief-question-position')).toHaveCount(0);
});

test('the chevron collapses the card into the composer and only the arrow beside it brings it back; Escape collapses too', async ({
  page,
}) => {
  const posted = await open(page, state(ask('ask-salary', 20, [SALARY])));
  const dock = card(page);
  await expect(dock.getByRole('button', { name: /关闭|取消提问/ })).toHaveCount(0);
  const stream = page.getByTestId('chief-stream');
  await expect(stream).not.toContainText('待你回答');
  await dock.getByTestId('chief-question-collapse').click();
  await expect(dock).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-placeholder')).toHaveText('回信里写期望年薪吗？');
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  await page.getByTestId('chief-question-restore').click();
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId('chief-question-option-0-0')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dock).toHaveCount(0);
  await expect(stream).not.toContainText('待你回答');
  await page.getByTestId('chief-question-restore').click();
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId('chief-question-option-0-0')).toBeFocused();
  expect(posted).toEqual([]);
});

test('number keys only move focus between rows and never answer', async ({ page }) => {
  const posted = await open(page, state(ask('ask-salary', 20, [SALARY])));
  const dock = card(page);
  await dock.getByTestId('chief-question-option-0-0').focus();
  await page.keyboard.press('3');
  await expect(dock.getByTestId('chief-question-option-0-2')).toBeFocused();
  await page.keyboard.press('4');
  await expect(dock.getByTestId('chief-question-other')).toBeFocused();
  await expect(dock.getByTestId('chief-question-other')).toHaveValue('');
  await page.keyboard.press('ArrowUp');
  await expect(dock.getByTestId('chief-question-option-0-2')).toBeFocused();
  await page.waitForTimeout(300);
  expect(posted).toEqual([]);
  for (const row of await dock.getByTestId(/^chief-question-option-0-\d$/).all())
    await expect(row).toHaveAttribute('aria-pressed', 'false');
});

test('skip leaves the card and the transcript keeps the question with 已跳过', async ({ page }) => {
  const posted = await open(page, state(ask('ask-salary', 20, [SALARY])));
  const dock = card(page);
  await dock.getByTestId('chief-question-skip').click();
  await expect(dock).toHaveCount(0);
  await expect.poll(() => posted.map((p) => p.path.split('/').at(-1)), { timeout: 8000 }).toEqual(['cancel']);
  const receipt = page.getByTestId('chief-question-receipt');
  await expect(receipt).toContainText('回信里写期望年薪吗？');
  await expect(receipt).toContainText('已跳过');
});

test('a parked question leaves the dock and answers inline where it was asked', async ({ page }) => {
  const posted = await open(
    page,
    state(ask('ask-salary', 20, [SALARY], { parkedAt: 25 })),
  );
  await expect(card(page)).toHaveCount(0);
  const stream = page.getByTestId('chief-stream');
  const chips = stream.getByTestId('chief-question-chips');
  await expect(chips).toHaveCount(1);
  await expect(chips).toHaveAttribute('data-request-id', 'ask-salary');
  await expect(chips.getByTestId('chief-question-text')).toHaveText('回信里写期望年薪吗？');
  await expect(stream.getByTestId('chief-question-parked')).toHaveText(
    'Coordinator 没有等回答，已继续',
  );
  await chips.getByTestId('chief-question-option-0-1').click();
  await expect.poll(() => posted.map((p) => p.body)).toEqual([
    { answers: [{ header: 'Acme 面试回信', choices: ['写 65 万'] }] },
  ]);
  await expect(stream.getByTestId('chief-question-chips')).toHaveCount(0);
  const receipt = stream.getByTestId('chief-question-receipt');
  await expect(receipt).toContainText('回信里写期望年薪吗？');
  await expect(receipt).toContainText('写 65 万');
});

test('a parked question does not keep a still-waiting question out of the dock', async ({ page }) => {
  await open(
    page,
    state(
      ask('ask-parked', 20, [SALARY], { parkedAt: 25 }),
      ask('ask-held', 21, [ATTACH]),
    ),
  );
  const dock = card(page);
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId('chief-question-text')).toHaveText('回信里附上哪些材料？');
  await expect(dock.getByTestId('chief-question-position')).toHaveCount(0);
  const stream = page.getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-question-chips')).toHaveCount(1);
  await expect(stream.getByTestId('chief-question-parked')).toBeVisible();
});

test('a withdrawn question is a receipt with the reason, never a card', async ({ page }) => {
  await open(
    page,
    state(
      ask('ask-salary', 20, [SALARY], {
        status: 'cancelled',
        cancelledBy: 'coordinator',
        cancelReason: '调研已经回答了这个问题',
      }),
    ),
  );
  await expect(card(page)).toHaveCount(0);
  const stream = page.getByTestId('chief-stream');
  await expect(stream.getByTestId('chief-question-chips')).toHaveCount(0);
  const receipt = stream.getByTestId('chief-question-receipt');
  await expect(receipt).toHaveCount(1);
  await expect(receipt).toHaveAttribute('data-status', 'cancelled');
  await expect(receipt).toContainText('回信里写期望年薪吗？');
  await expect(receipt).toContainText('不再需要回答：调研已经回答了这个问题');
  await expect(receipt).not.toContainText('已跳过');
  await expect(stream.getByTestId('chief-question-option-0-0')).toHaveCount(0);
  await expect(stream.getByTestId('chief-question-skip')).toHaveCount(0);
});

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`a Tasks jump keeps a parked option visible and focused through a new message (${size.name})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const prompt = { header: 'Dashboard export', question: 'Export all pages?', options: [{ label: 'Dashboard only' }] };
    const history = (prefix: string, start: number) =>
      Array.from({ length: 64 }, (_, index) => ({
        id: `${prefix}-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `Dashboard export ${prefix} update ${index + 1}`,
        createdAt: start + index,
      }));
    const data = state(ask('ask-export', 200, [prompt], { parkedAt: 201 }));
    data.messages.splice(1, 0, ...history('earlier', 100));
    data.messages.push(...history('later', 300));
    await open(page, data);
    const url = `/api/conversations/${THREAD.id}/stream`;
    await page.waitForFunction((path) => window.__es.some((source) => source.url.includes(path)), url);
    await page.getByTestId('tasks-toggle').click();
    const tasks = page.getByRole('complementary', { name: '任务' });
    await tasks.getByText(prompt.header, { exact: true }).click();
    const option = page.getByTestId('chief-stream').getByTestId('chief-question-option-0-0');
    await expect(option).toBeFocused();
    const message = { id: 'new-export-update', role: 'assistant', content: 'The dashboard data is ready to export.', createdAt: 400 };
    data.messages.push(message);
    const violation = await option.evaluate((el, { url, message }) => {
      const viewport = el.closest<HTMLElement>('[data-testid="chief-body"]')!;
      const source = window.__es.find((candidate) => candidate.url.includes(url));
      if (source === undefined) return 'Missing conversation stream';
      const top = el.getBoundingClientRect().top;
      const scrollTop = viewport.scrollTop;
      return new Promise<unknown>((resolve) => {
        let arrived: number | undefined;
        const start = performance.now();
        function check(now: number) {
          const box = el.getBoundingClientRect();
          const bounds = viewport.getBoundingClientRect();
          const style = getComputedStyle(viewport);
          const topFade = Number.parseFloat(style.getPropertyValue('--scroll-fade-top')) || 0;
          const bottomFade = Number.parseFloat(style.getPropertyValue('--scroll-fade-bottom')) || 0;
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const focused = document.activeElement === el;
          const hittable = hit?.closest('[data-question-row]') === el;
          const aboveFade = box.top < bounds.top + topFade;
          const belowFade = box.bottom > bounds.bottom - bottomFade;
          const drift = box.top - top;
          if (!focused || !hittable || aboveFade || belowFade || Math.abs(drift) > 1) {
            resolve({ focused, hittable, aboveFade, belowFade, drift, scrollDelta: viewport.scrollTop - scrollTop, elapsed: now - start });
            return;
          }
          if (viewport.querySelector(`[data-message-id="${message.id}"]`) !== null) arrived ??= now;
          if (arrived !== undefined && now - arrived >= 1000) resolve(null);
          else if (now - start >= 5000) resolve('Conversation update never settled');
          else requestAnimationFrame(check);
        }
        check(start);
        source.emit({ type: 'message', message });
      });
    }, { url, message });
    expect(violation).toBeNull();
    if (size.width === 390) await expect(tasks).toHaveCount(0);

    const viewport = page.getByTestId('chief-body');
    const distanceToEnd = () => viewport.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
    await expect(option).toBeFocused();
    await page.keyboard.press('End');
    await expect.poll(distanceToEnd).toBeLessThanOrEqual(2);
    const next = { id: 'export-finished', role: 'assistant', content: 'The dashboard export is complete.', createdAt: 401 };
    data.messages.push(next);
    await page.evaluate(({ url, next }) => {
      window.__es.find((source) => source.url.includes(url))?.emit({ type: 'message', message: next });
    }, { url, next });
    await expect(page.getByText(next.content, { exact: true })).toBeInViewport({ ratio: 1 });
    await expect.poll(distanceToEnd).toBeLessThanOrEqual(2);
  });

  test(`long content scrolls inside the card, which stays within 60% of the window and never pushes the composer away (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const long: Prompt = {
      header: '优惠券分摊回填',
      question:
        '去年已经结账、而且已经推送给财务系统的跨店铺订单，要不要按照新的整单舍入口径重新计算优惠券分摊？推送过的数据财务那边已经用于第四季度的对账和年报预审。',
      options: Array.from({ length: 8 }, (_, n) => ({
        label: `第 ${n + 1} 种做法：只重新计算第四季度里跨店铺的订单并再次推送`,
        description: '财务系统里已生成的凭证会被标记为待复核，预计占用财务两天，需要 38 家店铺各对一次账',
      })),
    };
    await open(page, state(ask('ask-long', 20, [long])));
    const dock = card(page);
    await expect(dock).toBeVisible();
    const box = (await dock.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(size.height * 0.6 + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    await expect(page.getByTestId('chief-composer-input')).toBeInViewport({ ratio: 1 });
    const last = dock.getByTestId('chief-question-option-0-7');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('chief-composer-input')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
  });
}
