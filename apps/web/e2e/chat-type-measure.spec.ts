import { expect, test } from '@playwright/test';

// Issue #470: 对话正文字号提阶 + 行宽上限. Agent replies are reading text —
// the capture-faithful 13px ink steps up to 15px on a unitless 1.6 (the
// product is the same 24px line pitch the r8 rows carried, so row geometry
// does not drift), and a 68ch measure cap keeps wide-screen paragraphs and
// centered notes inside the 60–75 character comfort band. The composer
// placeholder steps 13 → 14px: one notch under the body, hierarchy intact.
// Each test pins one failure way of the rework:
//   1. body ink/pitch falls back to the old 13px fixed-pitch recipe
//   2. line-height declared in px again (stops scaling with the size)
//   3. the 68ch cap is missing or resolves to a different measure
//   4. the note loses its centered look inside the cap
//   5. placeholder ties with the body and the hierarchy collapses
//   6. bubble / avatar / footer geometry gets dragged along
//   7. a rule creeps back between a user turn and the agent row
//
// #945/#910 重钉：detail.css 退役，载体换语义/二级制——agent 文本 =
// data-testid="agent-text"（无 role 的行内结构位）、note =
// transcript-note、列 = transcript-col、气泡 = user-bubble、头像 =
// msg-avatar、action 行 = msg-actions、agent 行 = data-row="agent"
// （裁定 3：状态载体走 data-*）、占位行 = composer-placeholder testid。
// 「行高声明必须 unitless」的意图保留：探针从钉 `.chat-text` 选择器文本
// 改为「命中该元素的规则里存在 line-height:1.6 声明」——载体从类名换成
// 元素匹配，律不变（leading-[1.6] utility 即新声明位）。

const DONE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36';
const CONFIRM = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b';

test('chat body reads at 15px on a unitless 1.6 — the 24px pitch survives', async ({ page }) => {
  await page.goto(DONE);
  const text = page.getByTestId('agent-text').first();
  await expect(text).toBeVisible();
  const cs = await text.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, lineHeight: s.lineHeight };
  });
  expect(cs.fontSize).toBe('15px');
  // 15 × 1.6 lands on the same 24px line box the fixed pitch carried
  expect(cs.lineHeight).toBe('24px');
  // the declaration itself must stay unitless so the pitch tracks the size:
  // scan the stylesheets for a rule that matches THIS element and declares
  // line-height: 1.6 (the leading-[1.6] utility is that rule)
  const declared = await text.evaluate((el) => {
    // utilities 住在 @layer 块里——递归下钻（老探针扫的是 unlayered 平铺规则）
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

test('composer placeholder steps to 14px — one notch under the 15px body', async ({ page }) => {
  await page.goto(CONFIRM);
  const sizes = await page.evaluate(() => {
    const ph = document.querySelector('[data-testid="composer-placeholder"]')!;
    const text = document.querySelector('[data-testid="agent-text"]')!;
    return {
      placeholder: getComputedStyle(ph).fontSize,
      body: getComputedStyle(text).fontSize,
    };
  });
  expect(sizes.placeholder).toBe('14px');
  expect(sizes.body).toBe('15px');
});

test('bubble / avatar / footer keep their own geometry (#470 scope fence)', async ({ page }) => {
  // 2026-10-12 dsh 用户行解剖重钉（#1268 行为批）：用户行 = 贴右缘气泡（无
  // 头像）+ 气泡下动作行（时钟 + 复制）。气泡几何 = dsh 42px 药丸律（本面
  // 15px/24px 文 + py 9px）；agent 侧头像 20² 与 footer 31px inset 不动
  // （探针改钉 agent 行，用户行已无此两物）。
  await page.goto(DONE);
  const geo = await page.evaluate(() => {
    const bubble = document.querySelector('[data-testid="user-bubble"]')!;
    const avatar = document.querySelector('[data-row="agent"] [data-testid="msg-avatar"] img')!;
    const agentFooter = document.querySelector('[data-row="agent"] [data-testid="msg-actions"]')!;
    const userTurn = bubble.parentElement!;
    const userActions = userTurn.parentElement!.querySelector('[data-testid="msg-actions"]')!;
    const b = bubble.getBoundingClientRect();
    const a = avatar.getBoundingClientRect();
    return {
      bubbleH: Math.round(b.height),
      bubbleFont: getComputedStyle(bubble).fontSize,
      avatarBox: { w: Math.round(a.width), h: Math.round(a.height) },
      footerPad: getComputedStyle(agentFooter).paddingLeft,
      userRowJustify: getComputedStyle(userTurn).justifyContent,
      userActionsJustify: getComputedStyle(userActions).justifyContent,
      // 用户行无头像（自己的话不自报身份）
      userHasAvatar: userTurn.querySelector('[data-testid="msg-avatar"]') != null,
    };
  });
  expect(geo.bubbleH).toBe(42);
  expect(geo.bubbleFont).toBe('15px');
  expect(geo.avatarBox).toEqual({ w: 20, h: 20 });
  expect(geo.footerPad).toBe('31px');
  expect(geo.userRowJustify).toBe('flex-end');
  expect(geo.userActionsJustify).toBe('flex-end');
  expect(geo.userHasAvatar).toBe(false);
});

test('turn boundary is air, not a rule: no divider between a user turn and the agent row', async ({
  page,
}) => {
  // XMON-55 P5 follow-up. P3 marked every 用户→agent boundary with a full-bleed
  // 1px rule; across a transcript that reads as a document <hr> rather than a
  // change of speaker, and the user asked for it gone. The boundary is carried
  // by the avatar swap, the centered stamp and air. This pins the three ways
  // the air-only boundary can regress: a rule creeps back, the gap collapses,
  // or the gap balloons until the transcript reads as scattered fragments.
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
    // every 用户→agent boundary: an agent row whose preceding row-carrier
    // ends with the user turn's action row (data-row/data-testid carriers,
    // #910 裁定 3). #1009 A2：行骨架换骑 MessageScrollerItem——边界判定改在
    // 载体层（Item 的最后一个子节点 = 用户行的收尾 action row），行内断言不变。
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
