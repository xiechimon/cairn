import { expect, test } from '@playwright/test';

const DONE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36';
const CONFIRM = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b';

test('chat body reads at 14px (text-ui) on the fixed 20px line of the main conversation bubbles', async ({
  page,
}) => {
  await page.goto(DONE);
  await page.locator('.side-panel [data-testid="transcript-col"]').waitFor();
  await page.locator('.side-panel [data-testid=\"transcript-col\"]').waitFor();
  const text = page.getByTestId('agent-text').first();
  await expect(text).toBeVisible();
  const cs = await text.evaluate((el) => {
    const s = getComputedStyle(el);
    const before = { fontSize: s.fontSize, lineHeight: s.lineHeight };
    (el as HTMLElement).style.fontSize = '20px';
    const scaled = getComputedStyle(el).lineHeight;
    (el as HTMLElement).style.fontSize = '';
    return { ...before, scaled };
  });
  expect(cs.fontSize).toBe('14px');
  expect(cs.lineHeight).toBe('20px');
  expect(cs.scaled).toBe('20px');
});

test('reply bubbles cap at the reply-bubble width and the centred note at 68ch', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(DONE);
  await page.locator('.side-panel [data-testid="transcript-col"]').waitFor();
  await page.locator('.side-panel [data-testid=\"transcript-col\"]').waitFor();
  const caps = await page.evaluate(() => {
    // ch resolves against the element's own font — measure the "0" glyph in
    // the same computed font and compare the used max-width against 68 of them
    const zeroWidth = (el: Element) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement('span');
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontSize = cs.fontSize;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.textContent = '0';
      document.body.append(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    };
    const ratio = (sel: string) => {
      const el = document.querySelector(`.side-panel ${sel}`)!;
      const used = Number.parseFloat(getComputedStyle(el).maxWidth);
      return used / zeroWidth(el);
    };
    const bubbles = [...document.querySelectorAll('.side-panel [data-testid="agent-text"]')];
    const probe = document.createElement('span');
    probe.style.width = 'var(--container-reply-bubble)';
    probe.style.position = 'absolute';
    document.body.append(probe);
    const cap = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      widest: Math.max(...bubbles.map((el) => el.getBoundingClientRect().width)),
      cap,
      note: ratio('[data-testid="transcript-note"] > span'),
    };
  });
  expect(caps.cap).toBe(512);
  expect(caps.widest).toBeLessThanOrEqual(caps.cap + 0.5);
  expect(caps.note).toBeGreaterThan(67.5);
  expect(caps.note).toBeLessThanOrEqual(68.5);
  const note = await page.getByTestId('transcript-note').first().evaluate((el) => {
    const s = getComputedStyle(el);
    const text = el.firstElementChild!.getBoundingClientRect();
    const line = el.getBoundingClientRect();
    return {
      leftGap: Math.abs(text.left - line.left - (line.right - text.right)),
      before: getComputedStyle(el, '::before').content,
      after: getComputedStyle(el, '::after').content,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      color: s.color,
      secondary: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
    };
  });
  expect(note.leftGap).toBeLessThanOrEqual(1);
  expect(note.before).toBe('none');
  expect(note.after).toBe('none');
  expect(note.fontSize).toBe('13px');
  expect(note.lineHeight).toBe('18px');
  // the capped measure must not push the column into horizontal overflow
  const overflow = await page.evaluate(() => {
    const col = document.querySelector('.side-panel [data-testid="transcript-col"]')!;
    return { scroll: col.scrollWidth, client: col.clientWidth };
  });
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

test('composer placeholder sits at 14px (text-ui)', async ({ page }) => {
  await page.goto('/app?scenario=home-c&thread=home-c-idle');
  const placeholder = page.locator('.side-panel [data-testid="composer-placeholder"]');
  await expect(placeholder).toHaveCSS('font-size', '14px');
});

test('agent text sits at 14px', async ({ page }) => {
  await page.goto(CONFIRM);
  await page.locator('.side-panel [data-testid="transcript-col"]').waitFor();
  await expect(page.locator('.side-panel [data-testid="agent-text"]').first()).toHaveCSS(
    'font-size',
    '14px',
  );
});

test('bubble / footer keep their own geometry, replies carry no avatar column', async ({ page }) => {
  await page.goto(DONE);
  await page.locator('.side-panel [data-testid="transcript-col"]').waitFor();
  await page.locator('.side-panel [data-testid=\"transcript-col\"]').waitFor();
  const geo = await page.evaluate(() => {
    const bubble = document.querySelector('.side-panel [data-testid="user-bubble"]')!;
    const avatars = document.querySelectorAll('.side-panel [data-testid="msg-avatar"]').length;
    const userItem = bubble.closest('[data-slot="message-scroller-item"]')!;
    const userFooter = userItem.querySelector('[data-testid="msg-actions"]')!;
    const footer = [...document.querySelectorAll('.side-panel [data-testid="msg-actions"]')].find(
      (el) => !userItem.contains(el),
    )!;
    const b = bubble.getBoundingClientRect();
    return {
      bubbleH: Math.round(b.height),
      bubbleFont: getComputedStyle(bubble).fontSize,
      avatars,
      footerPad: getComputedStyle(footer).paddingLeft,
      userFooterAlign: getComputedStyle(userFooter).justifyContent,
    };
  });
  expect(geo.bubbleH).toBeGreaterThanOrEqual(32);
  expect(geo.bubbleH).toBeLessThanOrEqual(33);
  expect(geo.bubbleFont).toBe('14px');
  expect(geo.avatars).toBe(0);
  expect(geo.footerPad).toBe('0px');
  expect(geo.userFooterAlign).toBe('flex-end');
});

test('turn boundary is air, not a rule: no divider between a user turn and the agent row', async ({
  page,
}) => {

  await page.goto(DONE);
  await page.locator('.side-panel [data-testid="transcript-col"]').waitFor();
  await page.locator('.side-panel [data-testid=\"transcript-col\"]').waitFor();
  const probe = await page.evaluate(() => {
    // every element in the transcript that paints a horizontal line
    const ruled = [...document.querySelectorAll('.side-panel [data-testid="transcript-col"] *')]
      .filter((el) => el.closest('.spec-block') === null)
      .filter((el) => {
        const cs = getComputedStyle(el);
        const top = Number.parseFloat(cs.borderTopWidth) || 0;
        const bot = Number.parseFloat(cs.borderBottomWidth) || 0;
        return (
          (top > 0 || bot > 0) &&
          el.getBoundingClientRect().height > 0 &&
          el.closest('[data-trace-card]') === null
        );
      })
      .map((el) => el.className);

    const turns = [...document.querySelectorAll('.side-panel [data-slot="message-scroller-item"]')]
      .filter((item) => {
        const prev = item.previousElementSibling;
        return (
          item.querySelector('[data-row="agent"]') != null &&
          prev?.lastElementChild?.getAttribute('data-testid') === 'msg-actions'
        );
      })
      .map((item) => {
        const row = item.querySelector('[data-row="agent"]')!;
        const prev = item.previousElementSibling!.lastElementChild!;
        const cs = getComputedStyle(row);
        const rect = row.getBoundingClientRect();
        return {
          borderTop: cs.borderTopWidth,
          paddingTop: cs.paddingTop,
          gap: rect.top - prev.getBoundingClientRect().bottom,
        };
      });
    return { ruled, turns };
  });
  // nothing in the transcript draws a line
  expect(probe.ruled).toEqual([]);
  // scenario 36 carries two such boundaries — the assertion is not vacuous
  expect(probe.turns).toHaveLength(2);
  for (const turn of probe.turns) {
    expect(turn.borderTop).toBe('0px');
    expect(turn.paddingTop).toBe('0px');
    // more than the 14px consecutive-agent packing, well under the 48px the
    // rule's own padding used to add
    expect(turn.gap).toBeGreaterThanOrEqual(16);
    expect(turn.gap).toBeLessThanOrEqual(32);
  }
});
