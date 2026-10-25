import { expect, test } from '@playwright/test';

const DONE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36';
const CONFIRM = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b';

test('chat body reads at 14px (text-card-title) on a unitless 1.6', async ({ page }) => {
  await page.goto(DONE);
  const text = page.getByTestId('agent-text').first();
  await expect(text).toBeVisible();
  const cs = await text.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, lineHeight: s.lineHeight };
  });
  // Paper PR 7: the six type keys have no 15px step; reading text takes
  // text-card-title (14px) and keeps the unitless 1.6 (22.4px line box)
  expect(cs.fontSize).toBe('14px');
  expect(cs.lineHeight).toBe('22.4px');
  // the declaration itself must stay unitless so the pitch tracks the size:
  // scan the stylesheets for a rule that matches THIS element and declares
  // line-height: 1.6 (the leading-[1.6] utility is that rule)
  const declared = await text.evaluate((el) => {

    const scan = (rules: CSSRuleList): string | null => {
      for (const rule of rules) {
        if (
          rule instanceof CSSStyleRule &&
          rule.style.lineHeight === '1.6' &&
          el.matches(rule.selectorText)
        ) {
          return rule.style.lineHeight;
        }
        if ('cssRules' in rule) {
          const found = scan((rule as CSSGroupingRule).cssRules);
          if (found !== null) return found;
        }
      }
      return null;
    };
    for (const sheet of document.styleSheets) {
      try {
        const found = scan(sheet.cssRules);
        if (found !== null) return found;
      } catch {
        continue;
      }
    }
    return null;
  });
  expect(declared).toBe('1.6');
});

test('68ch measure cap binds the body text and the centered note', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(DONE);
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
      const el = document.querySelector(sel)!;
      const used = Number.parseFloat(getComputedStyle(el).maxWidth);
      return used / zeroWidth(el);
    };
    return {
      text: ratio('[data-testid="agent-text"]'),
      note: ratio('[data-testid="transcript-note"]'),
    };
  });
  for (const r of [caps.text, caps.note]) {
    expect(r).toBeGreaterThan(67.5);
    expect(r).toBeLessThanOrEqual(68.5);
  }
  // the note keeps its centered look inside the cap: equal auto margins
  const note = await page.getByTestId('transcript-note').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { left: s.marginLeft, right: s.marginRight, align: s.textAlign };
  });
  expect(note.align).toBe('center');
  expect(Number.parseFloat(note.left)).toBeGreaterThan(0);
  expect(note.left).toBe(note.right);
  // the capped measure must not push the column into horizontal overflow
  const overflow = await page.evaluate(() => {
    const col = document.querySelector('[data-testid="transcript-col"]')!;
    return { scroll: col.scrollWidth, client: col.clientWidth };
  });
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

test('composer placeholder sits at 13.5px (text-ui) — one notch under the 14px body', async ({ page }) => {
  await page.goto(CONFIRM);
  const sizes = await page.evaluate(() => {
    const ph = document.querySelector('[data-testid="composer-placeholder"]')!;
    const text = document.querySelector('[data-testid="agent-text"]')!;
    return {
      placeholder: getComputedStyle(ph).fontSize,
      body: getComputedStyle(text).fontSize,
    };
  });
  expect(sizes.placeholder).toBe('13.5px');
  expect(sizes.body).toBe('14px');
});

test('bubble / avatar / footer keep their own geometry (#470 scope fence)', async ({ page }) => {
  await page.goto(DONE);
  const geo = await page.evaluate(() => {
    const bubble = document.querySelector('[data-testid="user-bubble"]')!;
    const avatar = document.querySelector('[data-testid="msg-avatar"] img')!;
    const userItem = bubble.closest('[data-slot="message-scroller-item"]')!;
    const userFooter = userItem.querySelector('[data-testid="msg-actions"]')!;
    const footer = [...document.querySelectorAll('[data-testid="msg-actions"]')].find(
      (el) => !userItem.contains(el),
    )!;
    const b = bubble.getBoundingClientRect();
    const a = avatar.getBoundingClientRect();
    return {
      bubbleH: Math.round(b.height),
      bubbleFont: getComputedStyle(bubble).fontSize,
      avatarBox: { w: Math.round(a.width), h: Math.round(a.height) },
      footerPad: getComputedStyle(footer).paddingLeft,
      userFooterAlign: getComputedStyle(userFooter).justifyContent,
    };
  });
  expect(geo.bubbleH).toBe(32);
  expect(geo.bubbleFont).toBe('14px');
  expect(geo.avatarBox).toEqual({ w: 20, h: 20 });
  expect(geo.footerPad).toBe('32px');
  expect(geo.userFooterAlign).toBe('flex-end');
});

test('turn boundary is air, not a rule: no divider between a user turn and the agent row', async ({
  page,
}) => {

  await page.goto(DONE);
  const probe = await page.evaluate(() => {
    // every element in the transcript that paints a horizontal line
    const ruled = [...document.querySelectorAll('[data-testid="transcript-col"] *')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const top = Number.parseFloat(cs.borderTopWidth) || 0;
        const bot = Number.parseFloat(cs.borderBottomWidth) || 0;
        return (top > 0 || bot > 0) && el.getBoundingClientRect().height > 0;
      })
      .map((el) => el.className);

    const turns = [...document.querySelectorAll('[data-slot="message-scroller-item"]')]
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
