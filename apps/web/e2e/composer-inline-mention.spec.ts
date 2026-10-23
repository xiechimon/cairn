import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// #728: inline `@` completion aligned with the Claude Code interaction
// canon (#727 §1). Acceptance is FEEL — every test drives a keyboard /
// mouse sequence and pins the observable result.
//
// Failure modes pinned (ticket "先列失败方式" numbering):
//   F1  Enter-send regression: "highlighted Enter = insert" must not break
//       "list closed / no highlight = send" (composer-wire-reject law);
//   F2  mid-word / email false trigger (`foo@`, `a@b.com`);
//   F3  stale popup after caret-only moves (selection re-evaluation);
//   F4  focus theft (textarea must keep focus; highlight via
//       aria-activedescendant, combobox pattern);
//   F5  insert offset drift (insertion replaces the STORED token range);
//   F6  missing trailing space / caret landing inside the token;
//   F7  backspace boundary off-by-one;
//   F8  IME composition firing insert/send;
//   F10 second mention with a stale range;
//   F11 popover multi-select insertion (last-one-wins before the fix);
//   plus the close set (rules 32-34 + web adaptations) and cap 15.
//
// Data face = live face stubbed (composer-wire-reject.spec discipline):
// no ?scenario= means the real API branch; the surfaces under test get
// their own stubs and every other GET falls through to a tolerated 500.

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '内联提及探针',
  spec: '',
  phase: 'building',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const PROJECT = {
  id: PROJECT_ID,
  name: 'cairn',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

const WIRE_BUILD = {
  id: BUILD_ID,
  todoId: CARD_ID,
  withPlan: true,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: 0,
};

const EMPTY_CONVERSATION = {
  messages: [],
  chips: null,
  historyEpoch: 0,
  steerPending: [],
  activeRun: null,
  nextCursor: null,
};

/** The three-agent roster the tests were written against. Labels are
 *  deliberately fuzzy-separable: "bld" hits only builder, "re" only
 *  reviewer, "Bu" (smart case) nothing. */
const AGENTS = [
  { id: 'agent-1', displayName: 'builder', description: 'Builds features' },
  { id: 'agent-2', displayName: 'reviewer', description: 'Reviews PRs' },
  { id: 'agent-3', displayName: 'deploy-bot', description: 'Ships to prod' },
];

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
}

/** Boot the live detail face (building phase, empty conversation) with a
 *  member roster and a counted steer POST endpoint. `extra` stubs the
 *  skill / machine faces (#848 five-kind coverage); absent = 500 → empty
 *  groups (the pre-#848 three-face shape: agents + todo + project). */
async function openDetail(
  page: Page,
  agents: { id: string; displayName: string; description?: string }[] = AGENTS,
  extra?: { skills?: { id: string; name: string; description?: string }[]; machines?: { id: string; name: string }[] },
) {
  await stubBoot(page);
  const members = [
    { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
    ...agents.map((a, i) => ({
      id: `member-agent-${i}`,
      teamId: TEAM_ID,
      actorId: a.id,
      memberType: 'agent',
      actor: a,
    })),
  ];
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) => route.fulfill({ json: members }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_CARD] }));
  await page.route(`**/api/todos/${CARD_ID}`, (route) => route.fulfill({ json: WIRE_CARD }));
  // `?*` is load-bearing: the hook requests `/api/projects?teamId=…` and a
  // bare `**/api/projects` glob never matches a query URL (#848 stub fix —
  // before, the project face silently 500'd in every test below).
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  if (extra?.skills !== undefined) {
    const skills = extra.skills;
    await page.route('**/api/skills?*', (route) => route.fulfill({ json: skills }));
  }
  if (extra?.machines !== undefined) {
    const machines = extra.machines;
    await page.route(`**/api/teams/${TEAM_ID}/machines`, (route) =>
      route.fulfill({ json: machines }),
    );
  }
  await page.route(`**/api/builds/${BUILD_ID}`, (route) => route.fulfill({ json: WIRE_BUILD }));
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/plans`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/usage`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  const sent: string[] = [];
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'POST') return route.fulfill({ json: EMPTY_CONVERSATION });
    sent.push(request.postData() ?? '');
    return route.fulfill({ status: 201, json: { message: { id: 'msg-1' } } });
  });
  const membersLoaded = page.waitForResponse(
    (r) => r.url().includes(`/api/teams/${TEAM_ID}/members`) && r.status() === 200,
  );
  await page.goto(`/app/todo/${CARD_ID}`);
  // The inline list only arms once the roster has resolved — typing before
  // that races the members fetch (the token re-judges on the next key, but
  // a lone fill would never open the list on a cold cache). Extra faces
  // (skills/machines) need no explicit wait: the five-kind tests assert row
  // counts through expect auto-retry.
  await membersLoaded;
  const input = page.locator('[data-testid="composer-card"] textarea');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  const listbox = page.locator('.mention-inline');
  const rows = page.locator('.mention-inline-row');
  return { input, listbox, rows, sent };
}

// Serialized wire forms (mention-token.ts serializeMention).
const T_BUILDER = '[builder](agent:agent-1)';
const T_REVIEWER = '[reviewer](agent:agent-2)';

test('trigger: line start / after whitespace / after CJK punctuation — never mid-word or in an email (F2)', async ({
  page,
}) => {
  const { input, listbox } = await openDetail(page);

  await input.fill('foo@');
  await expect(listbox).toBeHidden();

  await input.fill('a@b.com');
  await expect(listbox).toBeHidden();

  await input.fill('@');
  await expect(listbox).toBeVisible();

  await input.fill('hi @bu');
  await expect(listbox).toBeVisible();

  await input.fill('好的。@');
  await expect(listbox).toBeVisible();
  await evidenceShot(page, 'trigger-cjk-boundary.png');
});

test('filter: fuzzy subsequence, smart case, empty-state row', async ({ page }) => {
  const { input, rows } = await openDetail(page);

  // "bld" is a subsequence of builder only (not a prefix of anything).
  await input.fill('@bld');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('builder');

  // Smart case (rule 17): an uppercase query matches case-sensitively —
  // the all-lowercase roster drops out and the empty state shows.
  await input.fill('@Bui');
  await expect(rows).toHaveCount(0);
  await expect(page.locator('.mention-inline-empty')).toContainText('没有与"@Bui"匹配的结果');
  await evidenceShot(page, 'filter-smart-case-empty.png');

  // Empty query lists the roster in order (rule 8/13 isomorph): agents in
  // roster order, then todo / project (#848 five-kind face — skills and
  // machines 500 in this helper, so they stay empty).
  await input.fill('@');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('builder');
  await expect(rows.nth(1)).toContainText('reviewer');
  await expect(rows.nth(2)).toContainText('deploy-bot');
  await expect(rows.nth(3)).toContainText('#9 内联提及探针');
  await expect(rows.nth(4)).toContainText('cairn');
});

test('filter: candidate list caps at 15 (CN=15)', async ({ page }) => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: `agent-${i}`,
    displayName: `agent-${String(i).padStart(2, '0')}`,
  }));
  const { input, rows } = await openDetail(page, many);
  await input.fill('@');
  await expect(rows).toHaveCount(15);
});

test('keyboard: arrows cycle the highlight, the top row is NOT preselected', async ({ page }) => {
  const { input, rows } = await openDetail(page);
  await input.fill('@');
  await expect(rows).toHaveCount(5);
  // CC rule 56 isomorph: opening highlights nothing — Enter would send.
  await expect(page.locator('.mention-inline-row--active')).toHaveCount(0);

  await input.press('ArrowDown');
  await expect(rows.nth(0)).toHaveClass(/mention-inline-row--active/);
  await input.press('ArrowDown');
  await expect(rows.nth(1)).toHaveClass(/mention-inline-row--active/);
  await input.press('ArrowUp');
  await expect(rows.nth(0)).toHaveClass(/mention-inline-row--active/);
  // Wrap up past the first row → last row (cyclic, ticket acceptance).
  await input.press('ArrowUp');
  await expect(rows.nth(4)).toHaveClass(/mention-inline-row--active/);
  // Wrap down past the last row → first row.
  await input.press('ArrowDown');
  await expect(rows.nth(0)).toHaveClass(/mention-inline-row--active/);
  await evidenceShot(page, 'keyboard-highlight.png');
});

test('Enter with a highlight inserts WITHOUT sending; the second Enter sends (r9 §5 fix)', async ({
  page,
}) => {
  const { input, listbox, sent } = await openDetail(page);
  await input.fill('@bu');
  await input.press('ArrowDown');
  await input.press('Enter');

  // The whole @query is consumed (no residue) and one trailing space lands
  // (rule 26 + r9 §3.2); the caret sits after the space — proven by the
  // follow-up typing test below.
  await expect(input).toHaveValue(`${T_BUILDER} `);
  await expect(listbox).toBeHidden();
  // The value/hidden assertions above already spanned multiple render
  // round-trips — an accidental send (synchronous in the same handler)
  // would have hit the counted route by now.
  expect(sent).toHaveLength(0);
  await evidenceShot(page, 'enter-inserts-not-sends.png');

  // Second Enter = send (the list is closed, so the composer law applies).
  await input.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toContain(T_BUILDER);
  // Async 201 → the draft clears (the #75/#631 success half, unchanged).
  await expect(input).toHaveValue('');
});

test('Enter without a highlight sends as typed (F1: composer-wire-reject law survives)', async ({
  page,
}) => {
  const { input, sent } = await openDetail(page);
  await input.fill('@bu');
  await expect(page.locator('.mention-inline')).toBeVisible();
  await input.press('Enter'); // no arrow — nothing highlighted
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toContain('@bu');
});

test('Tab inserts the top match without sending and keeps focus (rule 22/56)', async ({
  page,
}) => {
  const { input, listbox, sent } = await openDetail(page);
  await input.fill('@bu');
  await input.press('Tab');
  await expect(input).toHaveValue(`${T_BUILDER} `);
  await expect(listbox).toBeHidden();
  await expect(input).toBeFocused(); // Tab did not move focus away
  expect(sent).toHaveLength(0);
});

test('mouse: hover highlights, click inserts, the textarea never loses focus (F4 combobox)', async ({
  page,
}) => {
  const { input, listbox, rows, sent } = await openDetail(page);
  await input.fill('@bu');
  await expect(listbox).toBeVisible();

  // Combobox wiring: while open the textarea announces the popup and keeps
  // DOM focus — the old shape focused the LAST row through a shared ref.
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const listboxId = await listbox.getAttribute('id');
  expect(listboxId).toBeTruthy();
  await expect(input).toHaveAttribute('aria-controls', listboxId as string);
  await expect(input).toBeFocused();

  // Hover moves the highlight (rule 24) and activedescendant follows.
  await rows.first().hover();
  await expect(rows.first()).toHaveClass(/mention-inline-row--active/);
  const rowId = await rows.first().getAttribute('id');
  await expect(input).toHaveAttribute('aria-activedescendant', rowId as string);
  await evidenceShot(page, 'hover-highlight.png');

  // Click inserts — and focus stays on the textarea (mousedown prevented).
  await rows.first().click();
  await expect(input).toHaveValue(`${T_BUILDER} `);
  await expect(listbox).toBeHidden();
  await expect(input).toBeFocused();
  expect(sent).toHaveLength(0);
});

test('insert lands a trailing space and the caret after it — typing continues outside the token (F6)', async ({
  page,
}) => {
  const { input } = await openDetail(page);
  await input.fill('hi @bu');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue(`hi ${T_BUILDER} `);

  // The caret must sit AFTER the trailing space: the next keystroke may
  // not land inside `[label](agent:id)` (markdown corruption).
  await input.press('x');
  await expect(input).toHaveValue(`hi ${T_BUILDER} x`);
  // The inserted token still round-trips to a mention chip shape.
  const caret = await input.evaluate((el) => el.selectionStart);
  expect(caret).toBe(`hi ${T_BUILDER} x`.length);
});

test('close set: Esc closes the listbox and stays on the detail (#634 layering)', async ({
  page,
}) => {
  const { input, listbox } = await openDetail(page);
  await input.fill('@bu');
  await expect(listbox).toBeVisible();
  await input.press('Escape');
  await expect(listbox).toBeHidden();
  // The Esc was consumed by the listbox — the detail page did not exit.
  await expect(page).toHaveURL(/\/todo\//);
  await expect(input).toHaveValue('@bu'); // text untouched

  // The dismissing key's own keyup re-judges the (unchanged) token — the
  // listbox must NOT instantly reopen. A key that leaves the caret where
  // it is (ArrowRight at end of text) triggers exactly that re-judgment.
  await input.press('ArrowRight');
  await expect(listbox).toBeHidden();
});

test('close set: backspace shortens the query, backspacing past @ closes (F7)', async ({
  page,
}) => {
  const { input, listbox, rows } = await openDetail(page);
  await input.fill('@bui');
  await expect(listbox).toBeVisible();
  await expect(rows).toHaveCount(1); // builder only

  await input.press('Backspace'); // '@bu' — query shrank, list stays
  await expect(listbox).toBeVisible();
  await expect(rows).toHaveCount(1);

  await input.press('Backspace'); // '@b' — fuzzy 'b' also hits deploy-bot
  await expect(listbox).toBeVisible();
  await expect(rows).toHaveCount(2);

  await input.press('Backspace'); // '@' — empty query, full roster
  await expect(listbox).toBeVisible();
  await expect(rows).toHaveCount(5);

  await input.press('Backspace'); // '' — past the trigger, closed
  await expect(listbox).toBeHidden();
  await expect(input).toHaveValue('');
});

test('close set: typing a space ends the token (rule 34)', async ({ page }) => {
  const { input, listbox } = await openDetail(page);
  await input.fill('@bu');
  await expect(listbox).toBeVisible();
  await input.press('Space');
  await expect(listbox).toBeHidden();
});

test('close set: caret-only moves out of the token close the list (F3)', async ({ page }) => {
  const { input, listbox } = await openDetail(page);

  // Keyboard: ArrowLeft is not consumed by the popup — the caret walks
  // left through the token and out; each keyup re-judges the token.
  await input.fill('hi @bu');
  await expect(listbox).toBeVisible();
  await input.press('ArrowLeft'); // caret after '@b' — still a token
  await expect(listbox).toBeVisible();
  await input.press('ArrowLeft'); // caret right after '@' — empty query
  await expect(listbox).toBeVisible();
  await input.press('ArrowLeft'); // caret before '@' — token gone
  await expect(listbox).toBeHidden();

  // Mouse: clicking earlier in the textarea moves the caret without any
  // change event — the popup must not stay stale. (fill('') first: a fill
  // to the identical value fires no input event, so the popup would never
  // re-judge.)
  await input.fill('');
  await input.fill('hi @bu');
  await expect(listbox).toBeVisible();
  const box = await input.boundingBox();
  expect(box).toBeTruthy();
  await input.click({ position: { x: 3, y: (box as { height: number }).height / 2 } });
  await expect(listbox).toBeHidden();
});

test('close set: clicking outside the composer closes the list', async ({ page }) => {
  const { input, listbox } = await openDetail(page);
  await input.fill('@bu');
  await expect(listbox).toBeVisible();
  await page.getByTestId('detail-body').click({ position: { x: 4, y: 4 } });
  await expect(listbox).toBeHidden();
  await expect(input).toHaveValue('@bu'); // the draft survives the dismiss
});

test('multiple mentions: a second @ after an insert opens fresh and lands in order (F10)', async ({
  page,
}) => {
  const { input, listbox, rows } = await openDetail(page);
  await input.fill('@bu');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue(`${T_BUILDER} `);

  // The caret landed after the trailing space; typing @ again must open
  // with an empty stale-range slate.
  await input.pressSequentially('@re');
  await expect(listbox).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('reviewer');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue(`${T_BUILDER} ${T_REVIEWER} `);
  await evidenceShot(page, 'multiple-mentions.png');
});

test('popover multi-select inserts every token with trailing spaces (F11)', async ({ page }) => {
  const { input } = await openDetail(page);
  await page.getByTestId('composer-toolbar').getByRole('button', { name: '提及' }).click();
  const picker = page.locator('.mention-picker');
  await expect(picker).toBeVisible();
  await page.locator('.mention-row--top[aria-label="Agents (3)"]').click();
  await page.locator('.mention-row--entry', { hasText: 'builder' }).click();
  await page.locator('.mention-row--entry', { hasText: 'reviewer' }).click();
  await page.locator('.mention-picker-insert').click();

  // Before the batched insertTokens fix only the LAST token of a
  // multi-select survived (each insertToken read the same stale closure).
  await expect(input).toHaveValue(`${T_BUILDER} ${T_REVIEWER} `);
  await evidenceShot(page, 'popover-multi-insert.png');
});

test('IME: a composing Enter neither inserts nor sends (F8)', async ({ page }) => {
  const { input, listbox, rows, sent } = await openDetail(page);
  await input.fill('@bu');
  await input.press('ArrowDown');
  await expect(rows.first()).toHaveClass(/mention-inline-row--active/);

  // A composition-confirming Enter arrives with isComposing — the popup
  // and the send path must both stand down.
  await input.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
  await expect(input).toHaveValue('@bu');
  await expect(listbox).toBeVisible();
  await expect(rows.first()).toHaveClass(/mention-inline-row--active/);
  expect(sent).toHaveLength(0);

  // The very next real Enter inserts normally — the guard skips composing
  // keys only.
  await input.press('Enter');
  await expect(input).toHaveValue(`${T_BUILDER} `);
  expect(sent).toHaveLength(0);
});

test('geometry: the listbox stays anchored above the composer (#688 ladder untouched)', async ({
  page,
}) => {
  const { input, listbox } = await openDetail(page);
  await input.fill('@');
  await expect(listbox).toBeVisible();
  // Past the 100ms zoom-in-95 enter animation — a mid-animation
  // boundingBox is scaled (mention-picker-center.spec precedent).
  await page.waitForTimeout(300);
  const listBox = await listbox.boundingBox();
  const composerBox = await page.getByTestId('composer-card').boundingBox();
  expect(listBox).toBeTruthy();
  expect(composerBox).toBeTruthy();
  const lb = listBox as { x: number; y: number; width: number; height: number };
  const cb = composerBox as { x: number; y: number; width: number; height: number };
  // Anchored above the composer card (bottom: calc(100% + 6px) — the
  // containing block is .composer, position: relative; unchanged).
  expect(lb.y + lb.height).toBeLessThanOrEqual(cb.y);
  // Spanning the composer width (left/right 0 anchoring, unchanged).
  expect(Math.abs(lb.width - cb.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(lb.x - cb.x)).toBeLessThanOrEqual(8);
});

// #760: `@` 文件候选面（Claude Code 主候选面同构）。
//
// Candidate source = `GET /api/projects/:id/files`（全递归路径表）；插入形 =
// 裸路径 + 尾随空格（CC rules 26-29），不走 scheme wire。分区规则：同一列表、
// 同一 fuzzy 分排序，ties 时 agents 在前（roster 序），总 cap 15 不动。
// 无文件面（未 stub = 500 → 空集）即本文件既有全部用例：#728 手感（触发 /
// 过滤 / 键盘 / 关闭集）不回归，只是空 query 的 roster 从 agents-only 长成
// 五类（+todo +project）。
const FILES = [
  { path: 'apps/web/src/ui/button.tsx', type: 'blob', size: 120 },
  { path: 'apps/web/src/ui', type: 'tree', size: null },
  { path: 'docs/spec/19-foo.md', type: 'blob', size: 40 },
];

/** openDetail + files 面 stub（等 files 取到再打字，免冷缓存竞态）。 */
async function openDetailWithFiles(page: Page) {
  const opened = await openDetail(page);
  await page.route(`**/api/projects/${PROJECT_ID}/files*`, (route) =>
    route.fulfill({
      json: { ref: 'HEAD', commit: 'c'.repeat(40), truncated: false, files: FILES },
    }),
  );
  const filesLoaded = page.waitForResponse(
    (r) => r.url().includes(`/api/projects/${PROJECT_ID}/files`) && r.status() === 200,
  );
  // 重进一次让 files 查询挂上 stub（openDetail 的首次请求已走 500  fallback →
  // 空集；reload 后 stub 生效）。react-query 对 500 不重试（retry: false）。
  await page.reload();
  await filesLoaded;
  const input = page.locator('[data-testid="composer-card"] textarea');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  return { ...opened, input, listbox: page.locator('.mention-inline'), rows: page.locator('.mention-inline-row') };
}

test('files: empty query lists entities then files in roster order', async ({ page }) => {
  const { input, rows } = await openDetailWithFiles(page);
  await input.fill('@');
  // 3 agents + todo + project（roster 序）+ 3 files（枚举序），总 cap 15 未触发
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText('builder');
  await expect(rows.nth(2)).toContainText('deploy-bot');
  await expect(rows.nth(3)).toContainText('#9 内联提及探针');
  await expect(rows.nth(4)).toContainText('cairn');
  await expect(rows.nth(5)).toContainText('apps/web/src/ui/button.tsx');
  await expect(rows.nth(6)).toContainText('apps/web/src/ui/');
  await evidenceShot(page, 'files-unified-list.png');
});

test('files: fuzzy filters both faces, agents keep ties', async ({ page }) => {
  const { input, rows } = await openDetailWithFiles(page);
  // "butt" 是 button.tsx 的子序列；agents 无人命中 → 只有文件行
  await input.fill('@butt');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('apps/web/src/ui/button.tsx');

  // 既有 agents 查询不受文件面污染（"bld" 只命中 builder）
  await input.fill('@bld');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('builder');
});

test('files: Enter inserts the bare path with a trailing space and sends on second Enter', async ({
  page,
}) => {
  const { input, listbox, rows, sent } = await openDetailWithFiles(page);
  await input.fill('@butt');
  await expect(rows).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  // 裸路径 + 尾随空格（CC rule 26），@query 无残留
  await expect(input).toHaveValue('apps/web/src/ui/button.tsx ');
  await expect(listbox).toBeHidden();
  expect(sent).toHaveLength(0);
  await evidenceShot(page, 'files-insert-path.png');

  await input.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toContain('apps/web/src/ui/button.tsx');
});

test('files: directory row inserts with a trailing slash', async ({ page }) => {
  const { input, rows } = await openDetailWithFiles(page);
  await input.fill('@ui/');
  // button.tsx 与 ui/ 目录都命中（同一 fuzzy 分，stub 序）；第二行是目录
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('apps/web/src/ui/');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('apps/web/src/ui/ ');
});

// #812：选中即渲染 chip（composer 内确认 strip，与 transcript 的
// .mention-chip 同形 + 新 chip 轻过渡 pop）。失败方式编号：
//   C6 strip 与 listbox 叠挂（listbox 开着时 strip 让路，选中落定才现形）
//   C7 空 draft / 无 chip 时 strip 零节点（fixture 面 DOM 字节不变）
//   C8 pop 只播一次（无关编辑不重播——key 稳定，已有 chip 去 fresh 态）
//   C9 动效机制实物（#746：断言 computed animation-name，非只读类名）
test('chips: Enter-select renders the file chip with a fresh pop', async ({ page }) => {
  const { input, rows } = await openDetailWithFiles(page);
  await input.fill('@butt');
  await expect(rows).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  const strip = page.getByTestId('composer-card').getByRole('status', { name: '提及' });
  await expect(strip).toBeVisible();
  await expect(strip.locator('.mention-chip')).toHaveCount(1);
  await expect(strip.locator('.mention-chip')).toContainText('apps/web/src/ui/button.tsx');
  // 新 chip 带 fresh 态（轻过渡的挂载钩子）。
  await expect(strip.locator('[data-fresh]')).toHaveCount(1);
  // C9：过渡真在播——编译产物里有该 animation（类名写了≠生效，#656 前例）。
  const animationName = await strip
    .locator('[data-fresh]')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animationName).not.toBe('none');
  await evidenceShot(page, 'chips-file-fresh.png');
});

test('chips: agent select renders the agent chip', async ({ page }) => {
  const { input, rows } = await openDetailWithFiles(page);
  await input.fill('@bld');
  await expect(rows).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  const strip = page.getByTestId('composer-card').getByRole('status', { name: '提及' });
  await expect(strip.locator('.mention-chip--agent')).toHaveCount(1);
  await expect(strip.locator('.mention-chip--agent')).toContainText('builder');
});

test('chips: Tab and click render the identical chip (accept 路径一致）', async ({
  page,
}) => {
  const { input, rows } = await openDetailWithFiles(page);
  await input.fill('@butt');
  await expect(rows).toHaveCount(1);
  await input.press('Tab');
  const strip = page.getByTestId('composer-card').getByRole('status', { name: '提及' });
  await expect(strip.locator('.mention-chip')).toContainText('apps/web/src/ui/button.tsx');

  await input.fill('');
  await expect(strip).toBeHidden();
  await input.fill('@butt');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(strip.locator('.mention-chip')).toContainText('apps/web/src/ui/button.tsx');
  await expect(strip.locator('[data-fresh]')).toHaveCount(1);
});

test('chips: editing the path retires the chip; the pop plays only once (C8)', async ({
  page,
}) => {
  const { input, rows } = await openDetailWithFiles(page);
  await input.fill('@butt');
  await expect(rows).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  const strip = page.getByTestId('composer-card').getByRole('status', { name: '提及' });
  await expect(strip.locator('[data-fresh]')).toHaveCount(1);

  // 无关编辑（尾随空格后加字）：chip 留，fresh 退。
  await input.press('x');
  await expect(strip.locator('.mention-chip')).toHaveCount(1);
  await expect(strip.locator('[data-fresh]')).toHaveCount(0);

  // 把路径吃掉：chip 退，strip 卸载（C7）。
  await input.fill('');
  await expect(strip).toHaveCount(0);
});

test('chips: the strip yields while the listbox is open (C6)', async ({ page }) => {
  const { input, listbox, rows } = await openDetailWithFiles(page);
  await input.fill('@butt');
  await expect(rows).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  const strip = page.getByTestId('composer-card').getByRole('status', { name: '提及' });
  await expect(strip).toBeVisible();

  // 再开一次 @：listbox 现形期间 strip 让路，不叠挂。
  await input.pressSequentially('@');
  await expect(listbox).toBeVisible();
  await expect(strip).toHaveCount(0);

  await input.press('Escape');
  await expect(listbox).toBeHidden();
  await expect(strip).toBeVisible();
});

// #848: 内联 @ 开五类（#727 D3 落地）。popover 的五类词表在内联面同一
// fuzzy 手感下可触发、可插入、落 chip；`/` 菜单与 popover 的键位不动。
const FIVE_KIND = {
  skills: [{ id: 'skill-1', name: 'code-review', description: 'Reviews code' }],
  machines: [{ id: 'machine-1', name: 'mea' }],
};

test('five-kind: bare @ lists all five kinds in roster order', async ({ page }) => {
  const { input, rows } = await openDetail(page, AGENTS, FIVE_KIND);
  await input.fill('@');
  // agents ×3 → todo → skill → project → machine（buildInlineRows 拼装序）
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toContainText('builder');
  await expect(rows.nth(3)).toContainText('#9 内联提及探针');
  await expect(rows.nth(4)).toContainText('code-review');
  await expect(rows.nth(5)).toContainText('cairn');
  await expect(rows.nth(6)).toContainText('mea');
  await evidenceShot(page, 'five-kind-list.png');
});

test('five-kind: skill Tab-inserts the scheme token and the chip confirms', async ({
  page,
}) => {
  const { input, rows } = await openDetail(page, AGENTS, FIVE_KIND);
  await input.fill('@code');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('code-review');
  await input.press('Tab');
  await expect(input).toHaveValue('[code-review](skill:skill-1) ');
  const strip = page.getByTestId('composer-card').getByRole('status', { name: '提及' });
  await expect(strip.locator('.mention-chip--skill')).toHaveCount(1);
  await expect(strip.locator('.mention-chip--skill')).toContainText('code-review');
  await evidenceShot(page, 'five-kind-skill-insert.png');
});

test('five-kind: todo Enter-inserts the plain #seq token without sending', async ({
  page,
}) => {
  const { input, rows, sent } = await openDetail(page, AGENTS, FIVE_KIND);
  await input.fill('@内联');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('#9 内联提及探针');
  await input.press('ArrowDown');
  await input.press('Enter');
  // todo wire 形是纯文本 #seq（serializeMention 既有语义，不走 scheme 链）
  await expect(input).toHaveValue('#9 ');
  expect(sent).toHaveLength(0);
  await input.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
});

test('five-kind: project click inserts the scheme token and the chip confirms', async ({
  page,
}) => {
  const { input, rows } = await openDetail(page, AGENTS, FIVE_KIND);
  await input.fill('@pacm');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(input).toHaveValue('[cairn](project:proj-1) ');
  const strip = page.getByTestId('composer-card').getByRole('status', { name: '提及' });
  await expect(strip.locator('.mention-chip--project')).toHaveCount(1);
});

test('five-kind: machine Enter-inserts without sending; second Enter sends', async ({
  page,
}) => {
  const { input, listbox, rows, sent } = await openDetail(page, AGENTS, FIVE_KIND);
  await input.fill('@mea');
  await expect(rows).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('[mea](machine:machine-1) ');
  await expect(listbox).toBeHidden();
  expect(sent).toHaveLength(0);
  await input.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toContain('[mea](machine:machine-1)');
});
