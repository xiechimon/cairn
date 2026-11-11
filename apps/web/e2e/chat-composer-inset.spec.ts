import { expect, type Page, test } from '@playwright/test';
import { type MockState, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const STREAM = `/api/conversations/${THREAD.id}/stream`;
const REPLY = '你想测试什么？可以试着问我一个问题，或让我查机器、技能、任务状态。';
const LONG_REPLY = Array.from({ length: 24 }, (_, n) => `第 ${n} 段 ${'流式文字 '.repeat(18)}`).join(
  '\n\n',
);

const history = (total: number): Row[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `h-${String(i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `question ${i}` : `answer ${i}`,
    createdAt: 1_000 + i,
  }));

type Surface = { name: string; scope: (page: Page) => ReturnType<Page['locator']> };

const SURFACES: Surface[] = [
  { name: 'home', scope: (page) => page.getByTestId('home-c') },
];

const VIEWPORTS = [
  { name: 'desktop 1440x900', width: 1440, height: 900 },
  { name: 'mobile 375x812', width: 375, height: 812 },
];

async function open(page: Page, surface: Surface, activeAfterSend = false) {
  const state: MockState = { threads: [THREAD], messages: history(30) };
  let running = false;
  await mockLive(page, state, (path, route, json) => {
    if (path === '/api/teams/t1/chief/threads' && route.request().method() === 'GET')
      return json([{ ...THREAD, activeRun: running ? { phase: 'chief' } : null }]);
    if (path === `/api/conversations/${THREAD.id}/messages` && route.request().method() === 'POST')
      running = activeAfterSend;
    return undefined;
  });
  await page.route('**/api/uploads/grant', (route) =>
    route.fulfill({
      json: { uploadUrl: '/api/uploads', grant: 'g1', key: 't1/att-1.txt', attachmentId: 'att-1' },
    }),
  );
  await page.route('**/api/uploads/upload', (route) =>
    route.fulfill({ json: { id: 'x', key: 'x', sizeBytes: 3 } }),
  );
  await page.goto('/app');
  const scope = surface.scope(page);
  await expect(scope.getByTestId('chief-body')).toBeVisible();
  await expect(scope.getByText('answer 29', { exact: true })).toBeAttached();
  return { state, scope };
}

async function send(page: Page, scope: ReturnType<Surface['scope']>) {
  const input = scope.getByTestId('chief-composer-input');
  await input.fill('测试');
  await input.press('Enter');
  await expect(scope.getByTestId('chief-stream').getByText('测试', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), STREAM))
    .toBe(true);
}

async function sendAndReply(
  page: Page,
  scope: ReturnType<Surface['scope']>,
  state: MockState,
  reply: string,
) {
  await send(page, scope);
  const row: Row = { id: 'reply-1', role: 'assistant', content: reply, createdAt: 9_000 };
  state.messages = [...state.messages, row];
  await page.evaluate(
    ([u, message]) =>
      window.__es.find((es) => es.url.includes(u as string))?.emit({ type: 'message', message }),
    [STREAM, row] as const,
  );
}

async function clearance(page: Page, scope: ReturnType<Surface['scope']>) {
  return scope.evaluate((root) => {
    const messages = root.querySelectorAll('[data-testid="chief-msg"]');
    const last = messages[messages.length - 1];
    const composer = root.querySelector('.chief-composer');
    const body = root.querySelector('[data-testid="chief-body"]');
    if (!last || !composer || !body) throw new Error('chat surfaces missing');
    const fade = Number.parseFloat((body as HTMLElement).style.getPropertyValue('--scroll-fade-bottom')) || 0;
    const next = composer;
    return {
      room: next.getBoundingClientRect().top - fade - last.getBoundingClientRect().bottom,
      gap: body.scrollHeight - body.scrollTop - body.clientHeight,
    };
  });
}

async function expectClear(page: Page, scope: ReturnType<Surface['scope']>) {
  await expect.poll(async () => (await clearance(page, scope)).gap).toBeLessThanOrEqual(2);
  await expect.poll(async () => (await clearance(page, scope)).room).toBeGreaterThanOrEqual(0);
  expect((await clearance(page, scope)).room).toBeLessThanOrEqual(40);
}

for (const viewport of VIEWPORTS) {
  for (const surface of SURFACES) {
    test.describe(`${surface.name} at ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test('the reply after a send sits fully above the composer fade', async ({ page }) => {
        const { state, scope } = await open(page, surface);
        await sendAndReply(page, scope, state, REPLY);
        await expect(scope.getByText(REPLY, { exact: true })).toBeVisible();
        await evidenceShot(page, `inset-${surface.name}-${viewport.width}-reply.png`);
        await expectClear(page, scope);
      });

      test('a five-line draft keeps the reply above the composer fade', async ({ page }) => {
        const { state, scope } = await open(page, surface);
        await sendAndReply(page, scope, state, REPLY);
        await expect(scope.getByText(REPLY, { exact: true })).toBeVisible();
        const input = scope.getByTestId('chief-composer-input');
        await input.fill(['一', '二', '三', '四', '五'].join('\n'));
        await evidenceShot(page, `inset-${surface.name}-${viewport.width}-five-lines.png`);
        await expectClear(page, scope);
      });

      test('an attachment chip keeps the reply above the composer fade', async ({ page }) => {
        const { state, scope } = await open(page, surface);
        await sendAndReply(page, scope, state, REPLY);
        await expect(scope.getByText(REPLY, { exact: true })).toBeVisible();
        await scope
          .locator('input[type="file"]')
          .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
        await expect(scope.getByTestId('composer-attachments')).toBeVisible();
        await evidenceShot(page, `inset-${surface.name}-${viewport.width}-attachment.png`);
        await expectClear(page, scope);
      });

      test('a long reply keeps following and ends clear of the composer fade', async ({ page }) => {
        const { scope } = await open(page, surface, true);
        await send(page, scope);
        await page.evaluate(
          ([u, text]) =>
            window.__es
              .find((es) => es.url.includes(u as string))
              ?.emit({ type: 'text_delta', text }),
          [STREAM, LONG_REPLY] as const,
        );
        await expect(scope.getByText('第 23 段', { exact: false })).toBeVisible();
        await expect
          .poll(async () => (await clearance(page, scope)).gap)
          .toBeLessThanOrEqual(2);
      });
    });
  }
}

const MASK_CASES = [
  { name: '1440x900 at DPR 1', width: 1440, height: 900, dpr: 1 },
  { name: '1440x900 at DPR 2', width: 1440, height: 900, dpr: 2 },
  { name: '1600x1000 at DPR 2', width: 1600, height: 1000, dpr: 2 },
];

for (const mask of MASK_CASES) {
  for (const surface of SURFACES) {
    test.describe(`mask on ${surface.name} at ${mask.name}`, () => {
      test.use({
        viewport: { width: mask.width, height: mask.height },
        deviceScaleFactor: mask.dpr,
      });

      test('the bottom fade is off whenever the list is within 2px of the end', async ({
        page,
      }) => {
        const { state, scope } = await open(page, surface);
        const body = scope.getByTestId('chief-body');
        await body.evaluate((node) => {
          const log: { gap: number; fade: string }[] = [];
          (window as unknown as { __maskLog: typeof log }).__maskLog = log;
          const tick = () => {
            log.push({
              gap: node.scrollHeight - node.scrollTop - node.clientHeight,
              fade: node.style.getPropertyValue('--scroll-fade-bottom'),
            });
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await sendAndReply(page, scope, state, REPLY);
        await expect(scope.getByText(REPLY, { exact: true })).toBeVisible();
        await page.waitForTimeout(1500);
        const log = await page.evaluate(
          () => (window as unknown as { __maskLog: { gap: number; fade: string }[] }).__maskLog,
        );
        const stale = log.filter((s) => s.gap <= 2 && s.fade !== '0px');
        expect(stale).toEqual([]);
        const settled = await body.evaluate((node) => ({
          gap: node.scrollHeight - node.scrollTop - node.clientHeight,
          fade: node.style.getPropertyValue('--scroll-fade-bottom'),
        }));
        expect(settled.gap).toBeLessThanOrEqual(2);
        expect(settled.fade).toBe('0px');
      });

      test('the bottom fade follows layout changes that fire no scroll or DOM event', async ({
        page,
      }) => {
        const { state, scope } = await open(page, surface);
        await sendAndReply(page, scope, state, REPLY);
        await expect(scope.getByText(REPLY, { exact: true })).toBeVisible();
        const body = scope.getByTestId('chief-body');
        const read = () =>
          body.evaluate((node) => ({
            gap: Math.round(node.scrollHeight - node.scrollTop - node.clientHeight),
            fade: node.style.getPropertyValue('--scroll-fade-bottom'),
          }));
        await expect.poll(read).toEqual({ gap: 0, fade: '0px' });
        await body.evaluate(
          (node) =>
            new Promise<void>((resolve) => {
              let steady = 0;
              let last = '';
              const frame = () => {
                const now = `${node.scrollHeight}:${node.scrollTop}:${node.hasAttribute('data-autoscrolling')}`;
                steady = now === last ? steady + 1 : 0;
                last = now;
                if (steady >= 30) resolve();
                else requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            }),
        );
        await body.evaluate((node) => node.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));

        await body.evaluate((node) => {
          const content = node.querySelector('[data-testid="chief-stream"]') as HTMLElement;
          content.style.paddingBottom = '40px';
        });
        await expect.poll(async () => (await read()).fade).toBe('64px');
        expect((await read()).gap).toBeGreaterThan(2);

        await body.evaluate((node) => {
          const content = node.querySelector('[data-testid="chief-stream"]') as HTMLElement;
          content.style.paddingBottom = '';
        });
        await expect.poll(read).toEqual({ gap: 0, fade: '0px' });
      });
    });
  }
}
