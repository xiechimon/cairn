import { expect, type Page, test } from '@playwright/test';

const CHIEF_MD = '/app?scenario=chief-md';
const DONE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36';
const CHIEF_CODE = '/app?scenario=chief-code';

const CLAUDE_PYTHON_COLORS = {
  light: {
    def: 'rgb(129, 0, 194)',
    load_records: 'rgb(0, 81, 194)',
    path: 'rgb(184, 79, 5)',
    dict: 'rgb(179, 74, 0)',
    '"utf-8"': 'rgb(0, 128, 0)',
    '# utf-8 only': 'rgb(110, 118, 135)',
    '10': 'rgb(0, 128, 128)',
    None: 'rgb(0, 128, 128)',
  },
  dark: {
    def: 'rgb(204, 123, 244)',
    load_records: 'rgb(112, 184, 255)',
    path: 'rgb(247, 171, 95)',
    dict: 'rgb(251, 173, 96)',
    '"utf-8"': 'rgb(155, 233, 99)',
    '# utf-8 only': 'rgb(129, 136, 152)',
    '10': 'rgb(94, 237, 237)',
    None: 'rgb(94, 237, 237)',
  },
} as const;

async function openChiefReply(page: Page) {
  await page.goto(CHIEF_MD);
  await expect(page.getByTestId('home-c')).toBeVisible();
  return page
    .getByTestId('home-c')
    .getByTestId('chief-msg')
    .filter({ has: page.locator('h2.chat-md-head') })
    .first();
}

test('bullets are native list markers in the reference geometry: disc, text colour, 36px list indent, no item pad', async ({
  page,
}) => {
  const reply = await openChiefReply(page);
  const items = await reply.getByTestId('md-item-bullet').evaluateAll((els) =>
    els.map((li) => {
      const list = li.parentElement as HTMLElement;
      const parentItem = list.parentElement?.closest('li');
      return {
        depth: li.getAttribute('data-depth'),
        display: getComputedStyle(li).display,
        style: getComputedStyle(list).listStyleType,
        parentList: parentItem?.parentElement?.tagName ?? null,
        markerColor: getComputedStyle(li, '::marker').color,
        textColor: getComputedStyle(li).color,
        fontSize: Number.parseFloat(getComputedStyle(li).fontSize),
        listPad: Number.parseFloat(getComputedStyle(list).paddingInlineStart),
        itemPad: Number.parseFloat(getComputedStyle(li).paddingInlineStart),
      };
    }),
  );
  expect(items).toHaveLength(4);
  for (const item of items) {
    expect(item.display).toBe('list-item');
    expect(item.markerColor).toBe(item.textColor);
    expect(item.listPad).toBe(36);
    expect(item.itemPad).toBe(0);
  }
  const nested = items.find((item) => item.depth === '1');
  expect(nested?.parentList).toBe('OL');
  expect(nested?.style).toBe('disc');
  expect(items.filter((item) => item.depth === '0').every((item) => item.style === 'disc')).toBe(
    true,
  );
});

test('code block header is always visible with the language, expand and copy, and copy copies the code', async ({
  page,
}) => {
  const reply = await openChiefReply(page);
  const block = reply.getByTestId('md-code-block');
  const copy = block.getByTestId('md-code-copy');
  await expect(block.getByTestId('md-code-lang')).toHaveText('sh');
  await page.mouse.move(1, 1);
  await expect(copy).toBeVisible();
  await expect(copy).toHaveCSS('opacity', '1');
  await expect(block.getByTestId('md-code-expand')).toBeVisible();
  const geo = await block.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const head = el.firstElementChild!;
    const h = head.getBoundingClientRect();
    const c = el.querySelector('[data-testid="md-code-copy"]')!.getBoundingClientRect();
    const x = el.querySelector('[data-testid="md-code-expand"]')!.getBoundingClientRect();
    return {
      head: h.height,
      rule: getComputedStyle(head).borderBottomWidth,
      size: c.width,
      pitch: c.left - x.left,
      right: b.right - c.right,
    };
  });
  expect(geo.head).toBe(40);
  expect(geo.rule).toBe('1px');
  expect(geo.size).toBe(32);
  expect(geo.pitch).toBe(32);

  await copy.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制');
  await expect(copy).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'curl -s localhost:8787/healthz',
  );
});

test('code expand opens a dialog with the full code, its own copy and Done, Escape returns focus to the expand button', async ({
  page,
}) => {
  const reply = await openChiefReply(page);
  const expand = reply.getByTestId('md-code-block').getByTestId('md-code-expand');
  await expand.click();
  const dialog = page.getByRole('dialog', { name: 'Sh 代码' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('md-code-dialog-body')).toContainText(
    'curl -s localhost:8787/healthz',
  );
  await expect
    .poll(() => dialog.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(890);
  const gap = await dialog.evaluate((el) => {
    const body = el.querySelector('[data-testid="md-code-dialog-body"]')!.getBoundingClientRect();
    const done = el.querySelector('[data-testid="md-code-done"]')!.getBoundingClientRect();
    return done.top - body.bottom;
  });
  expect(gap).toBe(16);
  await expect(dialog.getByRole('heading', { name: 'Sh 代码' })).toHaveCSS('font-weight', '600');
  await dialog.getByTestId('md-code-dialog-copy').click();
  await expect(dialog.getByTestId('md-code-done')).toHaveText('完成');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeFocused();
  await expand.click();
  await page.getByTestId('md-code-done').click();
  await expect(dialog).toHaveCount(0);
});

test('code block stays inside the reply column and long lines scroll inside it', async ({
  page,
}) => {
  const reply = await openChiefReply(page);
  const geo = await reply.getByTestId('md-code-block').evaluate((el) => {
    const column = el.closest('[data-testid="chief-msg-col"]')!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const pre = el.querySelector('pre')!;
    return {
      inside: box.left >= column.left - 0.5 && box.right <= column.right + 0.5,
      scroller: getComputedStyle(pre.parentElement!).overflowX,
      whiteSpace: getComputedStyle(pre).whiteSpace,
      fontSize: getComputedStyle(pre).fontSize,
      lineHeight: getComputedStyle(pre).lineHeight,
      radius: getComputedStyle(el).borderTopLeftRadius,
    };
  });
  expect(geo.inside).toBe(true);
  expect(geo.scroller).toBe('auto');
  expect(geo.whiteSpace).toBe('pre');
  expect(geo.fontSize).toBe('13px');
  expect(geo.lineHeight).toBe('20px');
  expect(geo.radius).toBe('10px');
});

test('status events are a centred muted line with no rules, and a reply footer never overlaps the reply text', async ({
  page,
}) => {
  await page.goto(DONE);
  const note = page.getByTestId('transcript-note').filter({ hasText: 'Xmon Dai' }).first();
  await expect(note).toBeVisible();
  const rules = await note.evaluate((el) => ({
    before: getComputedStyle(el, '::before').content,
    after: getComputedStyle(el, '::after').content,
    align: getComputedStyle(el).textAlign,
  }));
  expect(rules.before).toBe('none');
  expect(rules.after).toBe('none');
  expect(rules.align).toBe('center');

  const reply = page
    .locator('[data-row="agent"]')
    .filter({ hasText: 'git merge origin/main' })
    .first();
  const overlap = await reply.evaluate((row) => {
    const text = row.querySelector('[data-testid="agent-text"]')!.getBoundingClientRect();
    const footer = row.querySelector('[data-testid="msg-actions"]')!.getBoundingClientRect();
    return { textBottom: text.bottom, footerTop: footer.top };
  });
  expect(overlap.footerTop).toBeGreaterThanOrEqual(overlap.textBottom);
});

test('Coordinator status events are the same left-aligned status line, clear of the reply footer above', async ({
  page,
}) => {
  await page.goto(CHIEF_MD);
  const home = page.getByTestId('home-c');
  const note = home.getByTestId('chief-note').first();
  await expect(note).toHaveText('17:26');
  const style = await note.evaluate((el) => {
    const s = getComputedStyle(el);
    const text = el.firstElementChild!.getBoundingClientRect();
    return {
      before: getComputedStyle(el, '::before').content,
      after: getComputedStyle(el, '::after').content,
      leftGap: text.left - el.getBoundingClientRect().left,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      minHeight: s.minHeight,
      color: s.color,
    };
  });
  expect(style.before).toBe('none');
  expect(style.after).toBe('none');
  expect(style.leftGap).toBe(0);
  expect(style.fontSize).toBe('13px');
  expect(style.lineHeight).toBe('18px');
  expect(style.minHeight).toBe('24px');
});

test('a wide code line in an agent reply stays inside the transcript row on a phone viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(DONE);
  const reply = page
    .locator('[data-row="agent"]')
    .filter({ hasText: 'git merge origin/main' })
    .first();
  await expect(reply).toBeVisible();
  const edges = await reply.evaluate((row) => {
    const text = row.querySelector('[data-testid="agent-text"]') as HTMLElement;
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre';
    pre.textContent = 'x'.repeat(400);
    text.appendChild(pre);
    return {
      textRight: text.getBoundingClientRect().right,
      rowRight: row.getBoundingClientRect().right,
    };
  });
  expect(edges.textRight).toBeLessThanOrEqual(edges.rowRight + 0.5);
});

for (const theme of ['light', 'dark'] as const) {
  test(`python code block tokens take claude.ai's ${theme} syntax colors`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto(CHIEF_CODE);
    const code = page.getByTestId('home-c').getByTestId('md-code');
    await expect(code).toHaveAttribute('data-lang', 'python');
    await expect(code).toContainText('def load_records(path: Path) -> list[dict]:');
    for (const [token, color] of Object.entries(CLAUDE_PYTHON_COLORS[theme])) {
      const span = code.locator('span').getByText(token, { exact: true }).first();
      await expect(span, token).toHaveCSS('color', color);
    }
  });
}
