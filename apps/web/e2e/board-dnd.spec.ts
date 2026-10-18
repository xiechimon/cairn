import { expect, type Locator, type Page, test } from '@playwright/test';

/** #951/#910 载体：重置确认弹层 = role=dialog + 可及名一级（原 .dlg-reset
 *  类名钩随 detail/overlays.css 清零退役）。 */
const resetDialog = (page: Page) => page.getByRole('dialog', { name: '把任务重置回待开始？' });

/** #901 done 落位闸弹层：同载体律（role=dialog + 可及名一级）。 */
const doneDialog = (page: Page) => page.getByRole('dialog', { name: '把任务标记为已完成？' });

/** done/inflight 闸的 footer dismiss（关闭）。先锚 dialog-foot 再按名取钮：
 *  DialogShell 右上角 X 钮的 aria-label 同为「关闭」，dialog 级按名会双命中
 *  （Playwright strict mode）。 */
const dismissButton = (dialog: Locator) =>
  dialog.getByTestId('dialog-foot').getByRole('button', { name: '关闭' });

// Issue #616 → #753 acceptance: the board drag is the reference product's
// drag (todos.dev, 2026-10-03/04 live 重测——推翻 2026-10-02 旧测的两条:
// 「待处理/已完成卡不可拖」与「待处理永不作落点」）— a pure cross-column
// phase vehicle:
//   · 可拖面 = 每一列（#753 实测：四列的卡按压超过阈值都进 grabbing 拖拽）；
//   · the lift is a COMPACT clone (drag-card face: identity row + 2-line
//     title, V2 骨架方角 (#792 P6), 2° tilt, 0.92 opacity, --drag-shadow) —
//     not the board card copy; the source wrapper dims to 0.4 and keeps its slot;
//   · siblings NEVER shift mid-gesture and a same-column drop commits
//     nothing (the reference has no in-column reorder — #73/#403's sortable
//     preview retired with it);
//   · 合法目标 = per-source 矩阵（columns.ts canDropOnColumn 单源，#753）：
//     执行中 只吃 待开始；待处理 只吃 已完成(有变更)——重开落位写 review；
//     已完成 吃 待开始/执行中/待处理（含 failed，#1247）；待开始 吃全部
//     源列。非法对恒素面 + 落位零提交（实测：无拒绝动画，静默无操作）；
//     源列全程素面；两级染色（base 5% / hovered 10%）不变；
//   · 执行中 is the start gate: the drop fires the chief orchestration round
//     directly (#640 — the #318 choice dialog is gone; the phase is NOT
//     written locally, the card moves only once the chief dispatches;
//     2026-10-04 实测参考站该落位开 开始任务 dialog——差异归后续票，本仓
//     载体不动);
//   · 待处理/已完成 drops commit the phase silently, card lands at
//     the END of the target column's view, counts couple (r2 §4.2);
//     待开始双轨 (#755)：未开始卡（零历史）静默改相，已开始卡开重置确认闸
//     （中断构建 + 清空对话/方案/改动），确认前零提交；
//   · the overlay unmounts on the pointerup frame — no drop glide (#391's
//     250ms flight was a pacman invention; the reference snaps).
// The pointer sequence uses trusted moves past the PointerSensor 5px
// threshold, drop point inside the target's list area.
// #943/#910 重钉：卡 = [data-todo-id]、列表 = [data-column-list]（均为既有
// 属性载体）、浮层 = data-testid="drag-overlay"、列计数 =
// data-testid="column-count"（二级：裸数字无 role）、手势态 =
// body[data-board-dragging]（裁定 3：状态载体改 data-*）、动作钮 =
// role+name 一级。#951/#910 重钉：.dlg-reset → role=dialog 可及名
// 「把任务重置回待开始？」一级（detail/overlays.css 清零，类名钩退役）。
// .overlay-title 缺席钉保留原类载体：它是 rerun/reuse 浮层的零规则别名钩
// （皮律早已迁 utility），活体 pin 在 dead-buttons/rerun-close-family
// （已收官批次），终账归 #953。视觉断言值不动
// （--drag-shadow / --drop-tint-* / 0.4 / 0.92 / rotate(2deg) 零改动——
// board.css 规则原值迁工具类与 motion.css）。

const PROBE_ID = '7ve0iOkQ-JBpSL98zSiGc';

/** Press the first match of `fromSel` and carry it to a viewport point.
 *  Leaves the button down — the caller asserts mid-gesture state, then ups. */
async function dragTo(page: Page, fromSel: string, to: { x: number; y: number }): Promise<void> {
  const fromBox = await page.locator(fromSel).first().boundingBox();
  if (fromBox == null) throw new Error(`drag source missing: ${fromSel}`);
  const sx = fromBox.x + fromBox.width / 2;
  const sy = fromBox.y + fromBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 6, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
}

/** Press `fromSel` and park the pointer inside its own column's list tail —
 *  a same-column flight for tint reads and zero-commit releases (#753). */
async function dragInSourceColumn(page: Page, fromSel: string): Promise<void> {
  const fromBox = await page.locator(fromSel).first().boundingBox();
  if (fromBox == null) throw new Error(`drag source missing: ${fromSel}`);
  const column = await page
    .locator(fromSel)
    .first()
    .evaluate((el) => el.closest('section[data-column]')?.getAttribute('data-column'));
  const list = await page.locator(`[data-column-list="${column}"]`).boundingBox();
  if (list == null) throw new Error(`source list missing: ${column}`);
  const sx = fromBox.x + fromBox.width / 2;
  const sy = fromBox.y + fromBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 6, { steps: 4 });
  await page.mouse.move(list.x + list.width / 2, list.y + list.height - 24, { steps: 10 });
}

// ---- gesture settle (#398) ----
// Batch-load starvation spikes can land inside the assertion window AFTER
// the gesture state has already committed. Playwright matchers race every
// check against the deadline: these waits absorb the infrastructure jitter
// on action budgets so the strict expects that follow measure the PROPERTY,
// not machine latency. Each phase still fails on a genuinely broken gesture
// (overlay never appears / page never renders two frames).

/** The overlay is up (compact drag card mounted) and the page turned two
 *  responsive frame boundaries — any React tasks queued by the final move
 *  (collision → onDragOver → setDropColumnId → re-render) are FIFO-flushed. */
async function settleDrag(page: Page): Promise<void> {
  await page
    .getByTestId('drag-overlay').locator('[data-todo-id]')
    .waitFor({ state: 'visible', timeout: 15_000 });
  await settleDrop(page);
}

/** Two responsive frame boundaries: flushes tasks queued before it (the drop
 *  commit chain after pointerup, or the overId effect chain mid-gesture). */
async function settleDrop(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
  );
}

/** The four columns' tint-tier attributes in one read. */
async function readTiers(page: Page): Promise<Record<string, { valid: string | null; drop: string | null }>> {
  return page.evaluate(() => {
    const out: Record<string, { valid: string | null; drop: string | null }> = {};
    for (const section of document.querySelectorAll('section[data-column]')) {
      const id = section.getAttribute('data-column') as string;
      out[id] = {
        valid: section.getAttribute('data-drop-valid'),
        drop: section.getAttribute('data-drop'),
      };
    }
    return out;
  });
}

/** Resolve a CSS declaration through the same token path the board uses
 *  (probe-div trick — the computed value is the canon, not the source text). */
async function resolveStyle(page: Page, decls: Record<string, string>): Promise<Record<string, string>> {
  return page.evaluate((d) => {
    const probe = document.createElement('div');
    for (const [k, v] of Object.entries(d)) probe.style.setProperty(k, v);
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const out: Record<string, string> = {};
    for (const k of Object.keys(d)) {
      const camel = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      out[k] = cs.getPropertyValue(k) || (cs as unknown as Record<string, string>)[camel] || '';
    }
    probe.remove();
    return out;
  }, decls);
}

test('待开始 → 已完成: silent commit, end-of-column landing, counts couple, teardown sweeps', async ({
  page,
}) => {
  await page.goto('/app?scenario=22');
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  const to = { x: list.x + list.width / 2, y: list.y + 60 };

  await dragTo(page, '[data-column="todo"] [data-todo-id]', to);
  await settleDrag(page);
  // three feedback states ride the gesture: lifted compact card, hovered
  // column tint, grabbing body
  await expect(page.getByTestId('drag-overlay').locator('[data-todo-id]')).toBeVisible();
  await expect(page.locator('[data-column="done"]')).toHaveAttribute('data-drop', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-board-dragging', '');

  await page.mouse.up();
  await settleDrop(page);
  // committed: fresh phaseAt sorts the probe above the older incumbent (#1247)
  await expect(
    page.locator(`[data-column="done"] [data-todo-id="${PROBE_ID}"]`),
  ).toBeVisible();
  const doneOrder = await page
    .locator('[data-column="done"] [data-todo-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-todo-id')));
  expect(doneOrder[0]).toBe(PROBE_ID);
  await expect(page.locator('[data-column="todo"] [data-todo-id]')).toHaveCount(0);
  // header counts couple with the committed set (r2 §4.2)
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('0');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
  // the gesture teardown sweeps overlay + body class
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-board-dragging', '');
});

test('待开始 → 执行中: the drop fires orchestration directly — no dialog, no local phase write (#640)', async ({
  page,
}) => {
  await page.goto('/app?scenario=22');
  const list = await page.locator('[data-column-list="building"]').boundingBox();
  if (list == null) throw new Error('building list missing');
  const to = { x: list.x + list.width / 2, y: list.y + 60 };

  await dragTo(page, '[data-column="todo"] [data-todo-id]', to);
  await settleDrag(page);
  await expect(page.locator('[data-column="building"]')).toHaveAttribute('data-drop', 'true');
  await page.mouse.up();
  await settleDrop(page);

  // #640: the start gate no longer opens the #318 choice dialog — the drop
  // fires the chief orchestration round (live-only; fixture mode is inert, so
  // nothing renders). The gesture teardown still sweeps the drag overlay.
  await expect(page.locator('.overlay-title')).toHaveCount(0);
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  // the phase is NOT written locally: the probe still sits in 待开始, counts
  // untouched (in live it moves only once the chief dispatches via run_builds).
  await expect(
    page.locator(`[data-column="todo"] [data-todo-id="${PROBE_ID}"]`),
  ).toBeVisible();
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="building"]').getByTestId('column-count')).toHaveText('0');
});

// ---- the per-source target matrix (#753, todos.dev 2026-10-03/04 live 重测;
// rewrites 「待处理 never a target (#351)」— 待开始→待处理 stays invalid, but
// validity is now per source card, not a column-level constant) ----

const MATRIX_CASES = [
  { source: 'dm-todo', column: 'todo', valid: ['building', 'done'] },
  { source: 'dm-building', column: 'building', valid: ['todo', 'done'] },
  { source: 'dm-failed', column: 'pending', valid: ['todo', 'done'] },
  { source: 'dm-review', column: 'pending', valid: ['todo', 'done'] },
  { source: 'dm-confirm', column: 'pending', valid: ['todo', 'done'] },
  { source: 'dm-done-changes', column: 'done', valid: ['todo', 'pending'] },
  { source: 'dm-done-plain', column: 'done', valid: ['todo'] },
] as const;

test('per-source target matrix: the tint set follows the dragged card (#753)', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix');
  for (const c of MATRIX_CASES) {
    await dragInSourceColumn(page, `[data-todo-id="${c.source}"]`);
    await settleDrag(page);
    const tiers = await readTiers(page);
    for (const col of ['todo', 'building', 'pending', 'done']) {
      const expectValid = (c.valid as readonly string[]).includes(col);
      expect(
        tiers[col]?.valid,
        `source ${c.source}: data-drop-valid on ${col}`,
      ).toBe(expectValid ? 'true' : null);
    }
    // same-column release: zero commit, teardown sweeps
    await page.mouse.up();
    await settleDrop(page);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-board-dragging', '');
  }
  // nothing moved anywhere: counts are the untouched scenario shape
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="building"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('3');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
});

test('hover tier rides the hovered valid target for the new pairs (#753)', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix');
  // done(有变更) → 待处理: the reopen pair lights the hover tier on pending
  const list = await page.locator('[data-column-list="pending"]').boundingBox();
  if (list == null) throw new Error('pending list missing');
  await dragTo(page, '[data-todo-id="dm-done-changes"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await expect(page.locator('[data-column="pending"]')).toHaveAttribute('data-drop', 'true');
  await expect(page.locator('[data-column="pending"]')).toHaveAttribute('data-drop-valid', 'true');
  // 待开始 rides the base tier (valid, not hovered); 执行中 stays neutral
  await expect(page.locator('[data-column="todo"]')).toHaveAttribute('data-drop-valid', 'true');
  await expect(page.locator('[data-column="todo"]')).not.toHaveAttribute('data-drop', 'true');
  await expect(page.locator('[data-column="building"]')).not.toHaveAttribute('data-drop-valid');
  await page.mouse.up();
  await settleDrop(page);
});

test('invalid pairs: no tint on the hovered target, release commits nothing (#753)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const invalid = [
    { source: 'dm-confirm', target: 'building' },
    { source: 'dm-done-plain', target: 'pending' },
    { source: 'dm-todo', target: 'pending' },
  ] as const;
  for (const pair of invalid) {
    const list = await page.locator(`[data-column-list="${pair.target}"]`).boundingBox();
    if (list == null) throw new Error(`target list missing: ${pair.target}`);
    await dragTo(page, `[data-todo-id="${pair.source}"]`, {
      x: list.x + list.width / 2,
      y: list.y + list.height - 24,
    });
    await settleDrag(page);
    // the hovered invalid target lights NEITHER tier (实测: 非法对恒素面,
    // 落位 = 静默无操作, 无拒绝动画)
    await expect(
      page.locator(`[data-column="${pair.target}"]`),
      `${pair.source} → ${pair.target}: no hover tier`,
    ).not.toHaveAttribute('data-drop', 'true');
    await expect(
      page.locator(`[data-column="${pair.target}"]`),
      `${pair.source} → ${pair.target}: no base tier`,
    ).not.toHaveAttribute('data-drop-valid');
    await page.mouse.up();
    await settleDrop(page);
    // the card never left its source column
    await expect(
      page.locator(`[data-todo-id="${pair.source}"]`),
      `${pair.source} stayed put`,
    ).toBeVisible();
  }
  // counts are the untouched scenario shape
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="building"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('3');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
});

test('待开始 → 待处理 stays invalid (#351 pair kept inside the #753 matrix)', async ({ page }) => {
  await page.goto('/app?scenario=22');
  // the r5b §3.15 fold: the review+awaitingReply card sits in 待处理
  await expect(
    page.locator('[data-column="pending"]').getByRole('button', { name: '回复' }),
  ).toBeVisible();
  const list = await page.locator('[data-column-list="pending"]').boundingBox();
  if (list == null) throw new Error('pending list missing');
  const to = { x: list.x + list.width / 2, y: list.y + 60 };

  await dragTo(page, '[data-column="todo"] [data-todo-id]', to);
  await settleDrag(page);
  // no drop affordance on this pair — neither tint tier lights
  await expect(page.locator('[data-column="pending"]')).not.toHaveAttribute('data-drop', 'true');
  await expect(page.locator('[data-column="pending"]')).not.toHaveAttribute('data-drop-valid');

  await page.mouse.up();
  await settleDrop(page);
  // nothing commits: the probe stays in 待开始, both counts untouched
  await expect(
    page.locator(`[data-column="todo"] [data-todo-id="${PROBE_ID}"]`),
  ).toBeVisible();
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('1');
});

// ---- commits for the newly enabled pairs (#753) ----

test('已完成(有变更) → 待处理: reopen commits review, lands after the pinned group', async ({
  page,
}) => {
  await page.goto('/app?scenario=22');
  const list = await page.locator('[data-column-list="pending"]').boundingBox();
  if (list == null) throw new Error('pending list missing');
  const to = { x: list.x + list.width / 2, y: list.y + list.height - 24 };

  await dragTo(page, '[data-todo-id="r3-legacy-2"]', to);
  await settleDrag(page);
  await expect(page.locator('[data-column="pending"]')).toHaveAttribute('data-drop', 'true');
  await page.mouse.up();
  await settleDrop(page);

  // committed: the done card reopens INTO 待处理 as review（落点正名，#753
  // [设计]）—— the review-gate action link reads 审阅 (Paper card footer;
  // done cards carry no action), counts couple
  const moved = page.locator('[data-column="pending"] [data-todo-id="r3-legacy-2"]');
  await expect(moved).toBeVisible();
  await expect(moved.getByRole('button', { name: '审阅' })).toBeVisible();
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('0');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('2');
  // landing: the pinned review+awaitingReply card keeps the top; the reopened
  // card (review, no awaitingReply) lands AFTER it — end of the non-pinned run
  const order = await page
    .locator('[data-column="pending"] [data-todo-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-todo-id')));
  expect(order).toEqual(['r3-legacy-1', 'r3-legacy-2']);
});

test('待处理(confirm) → 已完成 opens the confirm dialog, then lands first (#1247)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-drag-matrix');
  let list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  await dragTo(page, '[data-todo-id="dm-confirm"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  await expect(doneDialog(page)).toBeVisible();
  await expect(doneDialog(page).getByText('选择结局。标记完成不算合并；已取消不算成功交付。')).toBeVisible();
  await expect(doneDialog(page).getByText('确认完成：进入已完成列，计为成功')).toBeVisible();
  await doneDialog(page).getByRole('button', { name: '确认完成' }).click();
  await expect(doneDialog(page)).toBeHidden();
  const inDone = page.locator('[data-column="done"] [data-todo-id="dm-confirm"]');
  await expect(inDone).toBeVisible();
  const doneOrder = await page
    .locator('[data-column="done"] [data-todo-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-todo-id')));
  expect(doneOrder[0]).toBe('dm-confirm');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('3');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('2');

  // failed 卡不动（#702 客户端同判）：待处理 只剩 pinned 组 + 无变化
  await expect(
    page.locator('[data-column="pending"] [data-todo-id="dm-failed"]'),
  ).toBeVisible();
});

test('待处理(confirm，有历史） → 待开始：开重置确认闸，不静默改相 (#755)', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const list = await page.locator('[data-column-list="todo"]').boundingBox();
  if (list == null) throw new Error('todo list missing');
  await dragTo(page, '[data-todo-id="dm-confirm"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  // dm-confirm 自带方案历史（hasPlan）= started：落位开重置 dialog，
  // 卡片停在源列，计数不动（#755 以前这里是静默改相，旧断言随正典更替改写）。
  await expect(resetDialog(page)).toBeVisible();
  await expect(
    page.locator('[data-column="pending"] [data-todo-id="dm-confirm"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('3');
  // 取消 = 零提交：弹层关，卡片不动，计数不动。
  await resetDialog(page).getByRole('button', { name: '取消' }).click();
  await expect(resetDialog(page)).toBeHidden();
  await expect(
    page.locator('[data-column="pending"] [data-todo-id="dm-confirm"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('3');
});

test('执行中 → 待开始：开重置确认闸 — gesture 只开闸，不写相位 (#755/#640)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const list = await page.locator('[data-column-list="todo"]').boundingBox();
  if (list == null) throw new Error('todo list missing');
  await dragTo(page, '[data-todo-id="dm-building"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  // #753 留下的「静默改相」断言作废：dm-building 有构建历史 = started，
  // 落位必须先经重置确认闸（中断构建 + 清空对话/方案/改动），确认前零提交。
  await expect(resetDialog(page)).toBeVisible();
  await expect(resetDialog(page).getByText('清空对话记录')).toBeVisible();
  await expect(resetDialog(page).getByText('清空方案版本')).toBeVisible();
  await expect(resetDialog(page).getByText('清空改动记录')).toBeVisible();
  await expect(
    page.locator('[data-column="building"] [data-todo-id="dm-building"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="building"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
});

// ---- 重置确认闸 (#755, scenario board-reset-gate) ----
// started 卡（有构建历史）落待开始开 dialog；零历史卡走静默改相。
// dialog 文案逐条点名清空范围（中断构建 + 对话/方案/改动），取消零提交。

test('重置闸·确认：started 卡确认后落待开始（fixture 本地重置投影）(#755)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-reset-gate');
  const list = await page.locator('[data-column-list="todo"]').boundingBox();
  if (list == null) throw new Error('todo list missing');
  await dragTo(page, '[data-todo-id="rg-building"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  await expect(resetDialog(page)).toBeVisible();
  await resetDialog(page).getByRole('button', { name: '确认重置' }).click();
  await expect(resetDialog(page)).toBeHidden();
  await expect(
    page.locator('[data-column="todo"] [data-todo-id="rg-building"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('2');
  await expect(page.locator('[data-column="building"]').getByTestId('column-count')).toHaveText('0');
});

test('重置闸·取消：零提交（卡片不动、计数不动、无请求发出）(#755)', async ({ page }) => {
  await page.goto('/app?scenario=board-reset-gate');
  // 取消路径不得产生任何写请求：fixture 面本就没有后端，此处再加一道
  // 请求拦截断言——落位与取消全程零 fetch。
  const writes: string[] = [];
  page.on('request', (req) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) writes.push(req.url());
  });
  const list = await page.locator('[data-column-list="todo"]').boundingBox();
  if (list == null) throw new Error('todo list missing');
  await dragTo(page, '[data-todo-id="rg-done-history"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  await expect(resetDialog(page)).toBeVisible();
  await resetDialog(page).getByRole('button', { name: '取消' }).click();
  await expect(resetDialog(page)).toBeHidden();
  await expect(
    page.locator('[data-column="done"] [data-todo-id="rg-done-history"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
  expect(writes).toEqual([]);
});

test('重置闸·静默：零历史卡拖回待开始不设闸 (#755)', async ({ page }) => {
  await page.goto('/app?scenario=board-reset-gate');
  const list = await page.locator('[data-column-list="todo"]').boundingBox();
  if (list == null) throw new Error('todo list missing');
  // 已完成·零历史：无可中断、无可清空 = 静默改相，dialog 不出现。
  await dragTo(page, '[data-todo-id="rg-done-fresh"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  await expect(resetDialog(page)).toBeHidden();
  await expect(
    page.locator('[data-column="todo"] [data-todo-id="rg-done-fresh"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('2');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('1');
});

// ---- done 落位闸 (#901, scenario board-drag-matrix) ----
// 闸相位（confirm/review）且有变更产物的卡拖向已完成 = 跳过合并语义，开
// 确认弹层（取消零提交）；无产物卡与其余源列拖拽保持静默改相（#892：数据
// 不支持砍掉拖拽捷径本身，只咬「有产物在审的卡」）。

test('done 闸·取消：review(有变更) 拖已完成开弹层，取消零提交（卡不动、计数不动、无写请求）(#901)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const writes: string[] = [];
  page.on('request', (req) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) writes.push(req.url());
  });
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  await dragTo(page, '[data-todo-id="dm-review"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  // dm-review = review ∧ hasChanges（probeTodo 相位默认位）：落位开 done 闸，
  // 卡片停在源列，计数不动。
  await expect(doneDialog(page)).toBeVisible();
  await expect(doneDialog(page).getByText('选择结局。标记完成不算合并；已取消不算成功交付。')).toBeVisible();
  await expect(doneDialog(page).getByText('确认完成：进入已完成列，计为成功')).toBeVisible();
  await expect(doneDialog(page).getByText('已开出的 PR 保持原状，不会自动合并')).toBeVisible();
  await expect(
    page.locator('[data-column="pending"] [data-todo-id="dm-review"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
  await dismissButton(doneDialog(page)).click();
  await expect(doneDialog(page)).toBeHidden();
  await expect(
    page.locator('[data-column="pending"] [data-todo-id="dm-review"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('3');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
  expect(writes).toEqual([]);
});

test('done 闸·确认：review(有变更) 确认后落已完成（fixture 本地提交，计数耦合）(#901)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  await dragTo(page, '[data-todo-id="dm-review"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  await expect(doneDialog(page)).toBeVisible();
  await doneDialog(page).getByRole('button', { name: '确认完成' }).click();
  await expect(doneDialog(page)).toBeHidden();
  await expect(
    page.locator('[data-column="done"] [data-todo-id="dm-review"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('2');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('3');
});

test('done 闸：无变更 confirm 取消留在待处理；building 源开 stop-then-done (#1247)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  const to = { x: list.x + list.width / 2, y: list.y + list.height - 24 };
  await dragTo(page, '[data-todo-id="dm-confirm"]', to);
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  await expect(doneDialog(page)).toBeVisible();
  await dismissButton(doneDialog(page)).click();
  await expect(doneDialog(page)).toBeHidden();
  await expect(
    page.locator('[data-column="pending"] [data-todo-id="dm-confirm"]'),
  ).toBeVisible();
  await dragTo(page, '[data-todo-id="dm-building"]', to);
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  const inflightDialog = page.getByRole('dialog', { name: '先停止构建再标记完成？' });
  await expect(inflightDialog).toBeVisible();
  await expect(inflightDialog.getByRole('button', { name: '停止并完成' })).toBeVisible();
  await dismissButton(inflightDialog).click();
  await expect(inflightDialog).toBeHidden();
  await expect(
    page.locator('[data-column="building"] [data-todo-id="dm-building"]'),
  ).toBeVisible();
});

test('failed → 已完成 can mark canceled (#1247)', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  await dragTo(page, '[data-todo-id="dm-failed"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await page.mouse.up();
  await settleDrop(page);
  await expect(doneDialog(page)).toBeVisible();
  await doneDialog(page).getByRole('button', { name: '已取消' }).click();
  await expect(doneDialog(page)).toBeHidden();
  await expect(page.locator('[data-column="done"] [data-todo-id="dm-failed"]')).toBeVisible();
  await expect(page.locator('[data-todo-id="dm-failed"] [data-todo-canceled]')).toBeVisible();
});

test('已完成列首卡完成时间不早于末卡 (#1247)', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const doneOrder = await page
    .locator('[data-column="done"] [data-todo-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-todo-id')));
  // dm-done-plain phaseAt 13:50 orderIndex 10; dm-done-changes phaseAt 13:20 orderIndex 0.
  expect(doneOrder).toEqual(['dm-done-plain', 'dm-done-changes']);
});

test('failed → 已完成 opens the dialog; cancel leaves the card (#1247)', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix');
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  await dragTo(page, '[data-todo-id="dm-failed"]', {
    x: list.x + list.width / 2,
    y: list.y + list.height - 24,
  });
  await settleDrag(page);
  await expect(page.locator('[data-column="done"]')).toHaveAttribute('data-drop-valid', 'true');
  await page.mouse.up();
  await settleDrop(page);
  await expect(doneDialog(page)).toBeVisible();
  await dismissButton(doneDialog(page)).click();
  await expect(
    page.locator('[data-column="pending"] [data-todo-id="dm-failed"]'),
  ).toBeVisible();
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
});

// ---- draggable from every column (#753; rewrites 「待处理/已完成 cards
// carry no drag sensor」— the 2026-10-02 claim is falsified: every card
// arms the gesture) ----

test('cards from every column arm the drag gesture (#753)', async ({ page }) => {
  await page.goto('/app?scenario=board-drag-matrix');
  for (const id of ['dm-todo', 'dm-building', 'dm-failed', 'dm-done-plain']) {
    await dragInSourceColumn(page, `[data-todo-id="${id}"]`);
    await settleDrag(page);
    // the gesture armed: overlay up, body class on, source wrapper dims
    await expect(
      page.getByTestId('drag-overlay').locator('[data-todo-id]'),
      `${id}: overlay`,
    ).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-board-dragging', '');
    // scroller scope：拖拽克隆卡（drag-overlay 内）同样携带 data-todo-id，
    // 手势期全域选择器会撞 strict mode（#943 实测）
    const dim = await page
      .locator(`[data-testid="board-scroller"] [data-todo-id="${id}"]`)
      .evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).opacity);
    expect(dim, `${id}: source dim`).toBe('0.4');
    await page.mouse.up();
    await settleDrop(page);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  }
  // same-column flights committed nothing
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="building"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.locator('[data-column="pending"]').getByTestId('column-count')).toHaveText('3');
  await expect(page.locator('[data-column="done"]').getByTestId('column-count')).toHaveText('2');
});

test('click navigation survives sensor arming on the newly draggable columns (#753/#629)', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-drag-matrix');
  for (const id of ['dm-confirm', 'dm-done-changes']) {
    const card = page.locator(`[data-todo-id="${id}"]`);
    await card.click();
    await page.waitForURL((u) => u.pathname === `/app/todo/${id}`);
    expect(new URL(page.url()).pathname).toBe(`/app/todo/${id}`);
    await page.goto('/app?scenario=board-drag-matrix');
    await expect(page.locator(`[data-todo-id="${id}"]`)).toBeVisible();
  }
});

test('same-column gesture: siblings never shift, drop is a no-op', async ({ page }) => {
  await page.goto('/app?scenario=22');
  // 卡面入场浮入（2026-10-12 dsh 对齐：card-enter 150ms）播完再量基线——
  // 等 getAnimations().finished 是 #1008 实测钉死的几何断言前置。
  await page
    .locator('.todo-card')
    .first()
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = await page.locator('[data-column="todo"] [data-todo-id]').first().boundingBox();
  if (box == null) throw new Error('probe card missing');
  const before = await page.getByTestId('board-scroller').locator('[data-todo-id]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.getAttribute('data-todo-id'), x: Math.round(r.x), y: Math.round(r.y) };
    }),
  );

  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 6, { steps: 4 });
  await page.mouse.move(sx + 2, sy + 90, { steps: 10 });
  await settleDrag(page);

  // no live preview: every board card keeps its slot, no wrapper transform
  const mid = await page.getByTestId('board-scroller').locator('[data-todo-id]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.getAttribute('data-todo-id'), x: Math.round(r.x), y: Math.round(r.y) };
    }),
  );
  expect(mid).toEqual(before);
  const transformed = await page.evaluate(
    () =>
      document.querySelectorAll('[data-column-list] > div[style*="transform"]').length,
  );
  expect(transformed).toBe(0);
  // the source column carries no tint tier either (reference: source stays neutral)
  await expect(page.locator('[data-column="todo"]')).not.toHaveAttribute('data-drop-valid');

  await page.mouse.up();
  await settleDrop(page);
  // no-op: no dialog, no commit, counts untouched
  await expect(page.locator('.overlay-title')).toHaveCount(0);
  await expect(page.locator('[data-column="todo"]').getByTestId('column-count')).toHaveText('1');
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
});

// ---- lifted face: the compact drag-tier recipe (#616, replaces #391's
// four-edge ink probe — the reference shadow is a wide soft pool 8px BELOW
// the card, top-edge ink is faint by design; the contract is the computed
// recipe, not a pixel-ink floor) ----
for (const theme of ['light', 'dark'] as const) {
  test(`lifted card rides the compact drag-tier recipe (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=22');
    const source = page.locator('[data-column="todo"] [data-todo-id]').first();
    const sourceBox = await source.boundingBox();
    if (sourceBox == null) throw new Error('probe card missing');

    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 8, sy + 6, { steps: 4 });
    await page.mouse.move(sx + 30, sy + 40, { steps: 8 });
    await settleDrag(page);

    const card = page.getByTestId('drag-overlay').locator('[data-todo-id]');
    await expect(card).toBeVisible();
    const expected = await resolveStyle(page, {
      'box-shadow': 'var(--drag-shadow)',
      // CDS PR-4: drag clone mirrors todo-card --radius-card (10px).
      'border-radius': 'var(--radius-card)',
    });
    const actual = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        'box-shadow': cs.boxShadow,
        // #943：倾角载体从 CSS transform 迁 TW v4 rotate-2 工具类——v4 的
        // rotate 族落在独立 rotate 属性上（computed transform 恒 none），
        // 与 dnd-kit wrapper 的 translate transform 合成像素同形（独立
        // transform 属性同管线叠加）。断言按新载体钉 rotate 本值。
        rotate: cs.rotate,
        opacity: cs.opacity,
        'border-radius': cs.borderRadius,
      };
    });
    expect(actual['box-shadow']).toBe(expected['box-shadow']);
    expect(actual.rotate).toBe('2deg');
    expect(actual.opacity).toBe('0.92');
    expect(actual['border-radius']).toBe(expected['border-radius']);

    // compact face: identity row + title only — the board card's bottom row
    // (agent avatar / rel-time / metrics / action) stays out of the flight。
    // #943/#910：身份行 = 卡根的首个 div（tag 载体）；底行缺席按语义合成钉
    // ——动作钮（role=button）与头像/指标（role=img / img）在抬升面必须为零。
    await expect(card.locator('> div').first()).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
    await expect(card.getByRole('img')).toHaveCount(0);
    await expect(card.locator('img')).toHaveCount(0);
    await expect(card).toContainText('#9');
    // overlay wrapper keeps the source card's width (PositionedOverlay law)
    const wrapBox = await page.getByTestId('drag-overlay').boundingBox();
    if (wrapBox == null) throw new Error('overlay wrapper missing');
    expect(Math.abs(wrapBox.width - sourceBox.width)).toBeLessThanOrEqual(1);
    // the source wrapper dims to the reference's 0.4 and keeps its slot
    const dim = await page.evaluate(() => {
      const el = document.querySelector('[data-column-list="todo"] > div');
      return el == null ? null : getComputedStyle(el).opacity;
    });
    expect(dim).toBe('0.4');

    await page.mouse.up();
    await settleDrop(page);
  });
}

// ---- two-tier indigo tint on the whole column cell (#616; #351 geometry
// law kept: the paint surface is the column section, header included) ----
for (const theme of ['light', 'dark'] as const) {
  test(`valid targets tint base tier, hovered column tints hot (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=22');
    const list = await page.locator('[data-column-list="done"]').boundingBox();
    if (list == null) throw new Error('done list missing');
    const to = { x: list.x + list.width / 2, y: list.y + 60 };
    await dragTo(page, '[data-column="todo"] [data-todo-id]', to);
    await settleDrag(page);
    await expect(page.locator('[data-column="done"]')).toHaveAttribute('data-drop', 'true');

    const expected = await resolveStyle(page, {
      'background-color': 'var(--drop-tint-hover)',
    });
    const expectedBase = await resolveStyle(page, {
      'background-color': 'var(--drop-tint-base)',
    });
    const paints = await page.evaluate(() => {
      const read = (col: string) => {
        const section = document.querySelector(`[data-column="${col}"]`);
        const listEl = section?.querySelector('[data-column-list]');
        return {
          valid: section?.getAttribute('data-drop-valid'),
          drop: section?.getAttribute('data-drop'),
          section: section == null ? null : getComputedStyle(section).backgroundColor,
          list: listEl == null ? null : getComputedStyle(listEl).backgroundColor,
        };
      };
      return { done: read('done'), building: read('building'), todo: read('todo'), pending: read('pending') };
    });

    // hovered valid target: hot tier on the whole cell, list carries no patch
    expect(paints.done.drop).toBe('true');
    expect(paints.done.section).toBe(expected['background-color']);
    expect(paints.done.list).toBe('rgba(0, 0, 0, 0)');
    // the other valid target rides the base tier
    expect(paints.building.valid).toBe('true');
    expect(paints.building.drop).toBeNull();
    expect(paints.building.section).toBe(expectedBase['background-color']);
    // source column stays neutral, and 待处理 is neutral for a 待开始 source
    // (#753 per-source matrix: 待开始→待处理 invalid — the column itself is
    // a valid target for done(有变更) sources, pinned by the matrix spec)
    expect(paints.todo.valid).toBeNull();
    expect(paints.pending.valid).toBeNull();
    expect(paints.todo.section).not.toBe(expectedBase['background-color']);
    expect(paints.pending.section).not.toBe(expectedBase['background-color']);

    await page.mouse.up();
    await settleDrop(page);
    // teardown sweeps both tiers
    await expect(page.locator('[data-column="done"]')).not.toHaveAttribute('data-drop', 'true');
    await expect(page.locator('[data-column="building"]')).not.toHaveAttribute('data-drop-valid');
  });
}

// ---- committed drop must not flash home (bounce-effect regression, #398
// era law kept): the first post-drag paint already reads the landing ----
test('committed drop never flashes the card back to the source column', async ({ page }) => {
  await page.goto('/app?scenario=22');
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  const to = { x: list.x + list.width / 2, y: list.y + 60 };
  await dragTo(page, '[data-column="todo"] [data-todo-id]', to);
  await settleDrag(page);

  await page.evaluate((id) => {
    const trace: { t: number; col: string | null }[] = [];
    (window as unknown as { __flashTrace: typeof trace }).__flashTrace = trace;
    const t0 = performance.now();
    const tick = () => {
      const grid = document.querySelector(`[data-testid="board-scroller"] [data-todo-id="${id}"]`);
      trace.push({
        t: Math.round(performance.now() - t0),
        col: grid?.closest('section[data-column]')?.getAttribute('data-column') ?? null,
      });
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
      else (window as unknown as { __flashDone: boolean }).__flashDone = true;
    };
    requestAnimationFrame(tick);
  }, PROBE_ID);

  // race reproducer (#1114): under load the first rAFs fire between arming
  // and the drop commit — pre-commit 'todo' frames are the drag state (the
  // source card stays pinned in its slot, per the gesture design above), not
  // a flash-back; the exact t-0262 flake shape (frames [{t:11,todo},...] at
  // docs/verify/1012/flake-attribution/run2-contended/probe-run.log).
  // Deterministically inject two of them before the release so the
  // mis-anchored assertion this spec used to carry stays red, not flaky.
  await page.evaluate(() => {
    (window as unknown as { __flashTrace: { t: number; col: string | null }[] })
      .__flashTrace.push({ t: 1, col: 'todo' }, { t: 2, col: 'todo' });
  });

  await page.mouse.up();
  // bounded wait for the 600ms trace window (replaces the blind 700ms sleep)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __flashDone: boolean }).__flashDone), {
      timeout: 10_000,
    })
    .toBe(true);
  const trace = await page.evaluate(
    () => (window as unknown as { __flashTrace: { t: number; col: string | null }[] }).__flashTrace,
  );
  // no frame AFTER the landing may render the committed card back in the
  // source column. NOTE: the trace arms BEFORE mouse.up, and the source card
  // stays pinned in its home slot for the whole gesture (draggable-card never
  // writes the transform back) — pre-commit todo frames are the drag state,
  // not a flash-back. The real regression shape is done → todo, so only
  // frames AFTER the first done landing count (same anchoring as
  // board-dnd-live.spec.ts firstPending).
  const firstDone = trace.findIndex((s) => s.col === 'done');
  expect(firstDone, 'card never landed in 已完成 during the trace').toBeGreaterThanOrEqual(0);
  const homeFrames = trace.slice(firstDone + 1).filter((s) => s.col === 'todo');
  expect(homeFrames, `frames with the card back in 待开始: ${JSON.stringify(homeFrames)}`).toEqual([]);
  // and it ends in the target column
  await expect(
    page.locator(`[data-column="done"] [data-todo-id="${PROBE_ID}"]`),
  ).toBeVisible();
});

// ---- no drop glide (#616): the overlay unmounts on the pointerup frame —
// #391's 250ms flight was a pacman invention; the reference snaps ----
test('overlay unmounts with the pointerup frame — no glide', async ({ page }) => {
  await page.goto('/app?scenario=22');
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done list missing');
  const to = { x: list.x + list.width / 2, y: list.y + 60 };
  await dragTo(page, '[data-column="todo"] [data-todo-id]', to);
  await settleDrag(page);
  await page.mouse.up();
  // two rAF boundaries ≈ 33ms — a 250ms glide would still be mounted here
  await settleDrop(page);
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  await expect(
    page.locator(`[data-column="done"] [data-todo-id="${PROBE_ID}"]`),
  ).toBeVisible();
});
