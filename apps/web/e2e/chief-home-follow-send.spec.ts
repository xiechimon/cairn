import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD, toolRow } from './chief-home-mock';
import { evidenceJson, evidenceShot } from './evidence';

const historyOf = (total: number): Row[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `h-${String(i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `question ${i}` : `answer ${i}`,
    createdAt: 1_000 + i,
  }));

async function mockSlowSend(page: Page, total = 250): Promise<Row[]> {
  const history = historyOf(total);
  let running = false;
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/chief/threads' && route.request().method() === 'GET')
      return json([{ ...THREAD, activeRun: running ? { phase: 'chief' } : null }]);
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() === 'POST') {
      const content = (route.request().postDataJSON() as { content: string }).content;
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          const message: Row = {
            id: `s-${history.length}`,
            role: 'user',
            content,
            createdAt: 1_000 + history.length,
          };
          history.push(message);
          running = true;
          void json({ thread: THREAD, message }, 201).then(resolve);
        }, 300),
      );
    }
    const before = new URL(route.request().url()).searchParams.get('before');
    const end = before === null ? history.length : history.findIndex((row) => row.id === before);
    const start = Math.max(0, end - 100);
    return json({
      messages: history.slice(start, end),
      nextCursor: start > 0 ? (history[start]?.id ?? null) : null,
    });
  });
  return history;
}

const home = (page: Page) => page.getByTestId('home-c');
const viewport = (page: Page) => home(page).getByTestId('chief-body');
const row = (page: Page, text: string) =>
  home(page).getByTestId('chief-stream').getByText(text, { exact: true });
const opacityOf = (locator: Locator) =>
  locator.evaluate((node) => Number(getComputedStyle(node).opacity));
const messageOf = (page: Page, text: string) =>
  home(page)
    .getByTestId('chief-msg')
    .filter({ has: page.getByText(text, { exact: true }) });

test('a sent message scrolls into view even when the reader was scrolled up', async ({ page }) => {
  await mockSlowSend(page);
  await page.goto('/app');
  await expect(row(page, 'answer 249')).toBeInViewport();
  await viewport(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - 600;
  });
  await expect(row(page, 'answer 249')).not.toBeInViewport();

  const input = home(page).getByTestId('chief-composer-input');
  await input.fill('follow me down');
  await input.press('Enter');

  await expect(row(page, 'follow me down')).toBeInViewport();
  const streamUrl = `/api/conversations/${THREAD.id}/stream`;
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), streamUrl))
    .toBe(true);
  await page.evaluate((u) => {
    window.__es.find((es) => es.url.includes(u))?.emit({ type: 'text_delta', text: 'typing back' });
  }, streamUrl);
  await expect(home(page).getByText('typing back')).toBeInViewport();
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await expect(row(page, 'follow me down')).toBeInViewport();
  await messageOf(page, 'follow me down')
    .getByTestId('chief-msg-tools')
    .getByTestId('chief-msg-more')
    .focus();
  await expect
    .poll(() => opacityOf(messageOf(page, 'follow me down').getByTestId('chief-msg-tools')))
    .toBe(1);
  await evidenceShot(page, 'chief-follow-send.png');
});

test('every message, the newest included, shows its actions only on hover', async ({
  page,
}) => {
  await mockSlowSend(page, 6);
  await page.goto('/app');
  await viewport(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.mouse.move(0, 0);
  await expect(row(page, 'answer 5')).toBeInViewport();

  const newestFoot = messageOf(page, 'answer 5').getByTestId('chief-msg-foot');
  const olderFoot = messageOf(page, 'answer 3').getByTestId('chief-msg-foot');
  const olderUserTools = messageOf(page, 'question 4').getByTestId('chief-msg-tools');

  await expect.poll(() => opacityOf(newestFoot)).toBe(0);
  await expect.poll(() => opacityOf(olderFoot)).toBe(0);
  await expect.poll(() => opacityOf(olderUserTools)).toBe(0);

  await messageOf(page, 'answer 3').getByTestId('chief-reply-bubble').first().hover();
  await expect.poll(() => opacityOf(olderFoot)).toBe(1);
  await messageOf(page, 'question 4').getByTestId('chief-bubble').hover();
  await expect.poll(() => opacityOf(olderUserTools)).toBe(1);
  await messageOf(page, 'answer 5').getByTestId('chief-reply-bubble').first().hover();
  await expect.poll(() => opacityOf(newestFoot)).toBe(1);
});

const gapToBottom = (page: Page) =>
  viewport(page).evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
const streamUrl = `/api/conversations/${THREAD.id}/stream`;
const emit = (page: Page, ev: unknown) =>
  page.evaluate(
    ([u, e]) => window.__es.find((es) => es.url.includes(u as string))?.emit(e),
    [streamUrl, ev] as const,
  );
const paragraph = (n: number) => `line ${n} ${'streamed words '.repeat(14)}`;

async function sendAtBottom(page: Page) {
  const history = await mockSlowSend(page);
  await page.goto('/app');
  await expect(row(page, 'answer 249')).toBeInViewport();
  const input = home(page).getByTestId('chief-composer-input');
  await input.fill('stay pinned');
  await input.press('Enter');
  await expect(row(page, 'stay pinned')).toBeInViewport();
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), streamUrl))
    .toBe(true);
  return history;
}

test('the typing dots after a send are visible without scrolling', async ({ page }) => {
  await sendAtBottom(page);
  await emit(page, { type: 'activity', activity: { phase: 'starting' } });
  const status = home(page).getByTestId('typing-dots');
  await expect(status).toBeInViewport({ ratio: 1 });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await evidenceShot(page, 'chief-stick-status.png');
});

test('streaming growth and a tool row stay pinned while the reader is at the bottom', async ({
  page,
}) => {
  const history = await sendAtBottom(page);
  for (let n = 0; n < 6; n++) {
    await emit(page, { type: 'text_delta', text: `${paragraph(n)}\n\n` });
    await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  }
  const tool = toolRow('tool-1', 'todo_write', {}, 5_000);
  history.push(tool);
  await emit(page, { type: 'message', message: tool });
  await emit(page, { type: 'text_delta', text: `${paragraph(99)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await expect(home(page).getByTestId('jump-to-latest')).toHaveAttribute('data-active', 'false');
  await evidenceShot(page, 'chief-stick-streaming.png');
});

test('scrolling up stops following, and the jump button resumes it', async ({ page }) => {
  await sendAtBottom(page);
  await emit(page, { type: 'text_delta', text: `${paragraph(0)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);

  await viewport(page).hover();
  await page.mouse.wheel(0, -700);
  await expect.poll(() => gapToBottom(page)).toBeGreaterThan(300);
  const parked = await gapToBottom(page);
  for (let n = 1; n < 4; n++) await emit(page, { type: 'text_delta', text: `${paragraph(n)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeGreaterThan(parked);
  const jump = home(page).getByTestId('jump-to-latest');
  await expect(jump).toHaveAttribute('data-active', 'true');

  await jump.click();
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await emit(page, { type: 'text_delta', text: `${paragraph(4)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await expect(jump).toHaveAttribute('data-active', 'false');

  await viewport(page).hover();
  await page.mouse.wheel(0, -700);
  await expect.poll(() => gapToBottom(page)).toBeGreaterThan(300);
  const parkedAfterJump = await gapToBottom(page);
  await emit(page, { type: 'text_delta', text: `${paragraph(5)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeGreaterThan(parkedAfterJump);
  await expect(jump).toHaveAttribute('data-active', 'true');
});

for (const activation of ['click', 'Enter', 'Space', 'reduced-motion', 'phone-light'] as const) {
  test(`jump to latest is instant with ${activation} through a long lazy history`, async ({
    page,
  }) => {
    if (activation === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (activation === 'phone-light') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    const history = historyOf(100);
    for (const [index, message] of history.entries()) {
      message.content = `${index === 99 ? 'Latest delivery report' : `Delivery review ${index}`}\n\n${'The deployment checks passed and the change is ready for review. '.repeat((index % 7) + 1)}`;
    }
    await mockLive(page, { threads: [THREAD], messages: history });
    await page.goto('/app');
    const body = viewport(page);
    const jump = home(page).getByTestId('jump-to-latest');
    await expect(row(page, 'Latest delivery report')).toBeAttached();
    await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
    await expect
      .poll(async () => {
        await body.evaluate((node) => {
          node.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
          node.scrollTop = 0;
        });
        return row(page, 'Delivery review 0').count();
      })
      .toBe(1);
    if (activation === 'phone-light') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await body.evaluate((node) => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
      for (const item of node.querySelectorAll<HTMLElement>(
        '[data-slot="message-scroller-item"]',
      )) {
        item.style.contentVisibility = 'auto';
      }
      node.scrollTop = 0;
    });
    await expect(jump).toHaveAttribute('data-active', 'true');
    expect(await body.evaluate((node) => node.scrollHeight / node.clientHeight)).toBeGreaterThan(5);
    expect(
      await body
        .locator('[data-slot="message-scroller-item"]')
        .first()
        .evaluate((node) => getComputedStyle(node).contentVisibility),
    ).toBe('auto');
    await jump.hover();
    const resting = await jump.evaluate((node) => ({
      property: getComputedStyle(node).transitionProperty,
      duration: getComputedStyle(node).transitionDuration,
      background: getComputedStyle(node).backgroundColor,
    }));
    await jump.evaluate((button) => {
      button.addEventListener(
        'click',
        () => {
          const started = performance.now();
          const root = button.closest('[data-slot="message-scroller"]');
          const viewport = root?.querySelector('[data-slot="message-scroller-viewport"]');
          if (!(viewport instanceof HTMLElement)) throw new Error('Missing conversation viewport');
          const frames: { t: number; top: number; gap: number; opacity: number }[] = [];
          const sample = () => {
            const t = performance.now() - started;
            frames.push({
              t: Math.round(t * 10) / 10,
              top: Math.round(viewport.scrollTop),
              gap: Math.round(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight),
              opacity: Number(getComputedStyle(button).opacity),
            });
            if (t < 500) return requestAnimationFrame(sample);
            const latest = [...viewport.querySelectorAll('[data-slot="message-scroller-item"]')].at(
              -1,
            );
            const bounds = viewport.getBoundingClientRect();
            const rect = latest?.getBoundingClientRect();
            button.setAttribute(
              'data-jump-measurement',
              JSON.stringify({
                frames,
                latestVisible:
                  rect != null && rect.bottom <= bounds.bottom + 2 && rect.bottom > bounds.top,
              }),
            );
          };
          requestAnimationFrame(sample);
        },
        { once: true },
      );
    });
    if (activation === 'Enter' || activation === 'Space') {
      await jump.focus();
      await jump.press(activation === 'Space' ? 'Space' : 'Enter');
    } else {
      await page.mouse.down();
      const pressed = await jump.evaluate((node) => ({
        duration: getComputedStyle(node).transitionDuration,
        background: getComputedStyle(node).backgroundColor,
      }));
      expect.soft(pressed.duration).toBe('0s');
      expect.soft(pressed.background).not.toBe(resting.background);
      await page.mouse.up();
    }
    await jump.evaluate(async (node) => {
      while (!node.hasAttribute('data-jump-measurement')) {
        await new Promise(requestAnimationFrame);
      }
    });
    const measurement = JSON.parse((await jump.getAttribute('data-jump-measurement')) ?? '{}') as {
      frames: { t: number; top: number; gap: number; opacity: number }[];
      latestVisible: boolean;
    };
    if (activation === 'click') {
      await evidenceShot(page, `${process.env.JUMP_EVIDENCE_PHASE ?? 'after'}-window-end.png`);
    }
    await evidenceJson(
      `${process.env.JUMP_EVIDENCE_PHASE ?? 'after'}-frames-${activation}.json`,
      measurement.frames,
    );
    const landed = measurement.frames.findIndex((frame) => frame.gap <= 2);
    const hidden = measurement.frames.findIndex((frame) => frame.opacity === 0);
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(measurement.frames.slice(landed).every((frame) => frame.gap <= 2)).toBe(true);
    expect(hidden).toBeGreaterThanOrEqual(0);
    if (activation === 'phone-light') {
      expect(landed).toBeLessThanOrEqual(1);
      expect(hidden).toBeLessThanOrEqual(1);
    } else {
      expect(measurement.frames[landed]?.t).toBeLessThanOrEqual(150);
      expect(measurement.frames[hidden]?.t).toBeLessThanOrEqual(150);
    }
    expect(measurement.latestVisible).toBe(true);
    expect(resting.property === 'none' || resting.duration.split(',').every((v) => parseFloat(v) === 0)).toBe(true);
    await page.waitForTimeout(250);
    await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
    await expect(jump).toHaveAttribute('data-active', 'false');
    expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}

for (const reduced of [false, true]) {
  test(`a sent message rises in over 160ms, history rows do not (reduced motion: ${reduced})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await mockSlowSend(page, 6);
    await page.goto('/app');
    await expect(row(page, 'answer 5')).toBeVisible();
    const animationOf = (text: string) =>
      messageOf(page, text).evaluate((node) => {
        const style = getComputedStyle(node);
        return { name: style.animationName, duration: style.animationDuration };
      });
    expect((await animationOf('question 4')).name).toBe('none');
    const input = home(page).getByTestId('chief-composer-input');
    await input.fill('rise in');
    await input.press('Enter');
    await expect(row(page, 'rise in')).toBeVisible();
    const shown = await animationOf('rise in');
    if (reduced) expect(shown.name).toBe('none');
    else expect(shown).toEqual({ name: 'message-enter', duration: '0.16s' });
  });
}
