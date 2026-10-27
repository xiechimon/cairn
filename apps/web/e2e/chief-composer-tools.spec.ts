import { expect, type Page, type Route, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// #732: the chief drawer composer gets the detail composer's tool face
// (ruling (a), issue comment 2026-10-03). The interaction set is the same
// one the detail face already carries — inline `@` completion (#728),
// clipboard image paste (#729) and the toolbar's attach + mention buttons —
// but only the interaction face opens: no new backend face is added, the
// grant/upload/read chain and the mention wire are the landed ones.
//
// Failure modes pinned here (ticket list, extended by recon):
//  FM1 data source: chief's mentionGroups come from the same REST hooks the
//      detail face projects (members filtered to agents feeds the inline
//      list; the five groups feed the popover). A mis-wired or missing
//      source leaves the inline listbox permanently closed (it needs a
//      non-empty agent group) or the popover at zero counts.
//  FM2 popup layer: the drawer is a docked dialog — the inline listbox
//      anchors above the composer wrap inside it (mention-picker.css z 40 is
//      local to the drawer), the popover rides FloatingShell's ladder.
//  FM3 read-only face: with onSend absent (fixture capture) the completion
//      must not fire (editable gate inside useComposerWire) and the attach
//      button stays inert.
//  FM6 attachment wire: paste rides attachFile scope 'message' and the token
//      stays a whole line (ATTACHMENT_LINE is whole-line anchored — a shared
//      line silently degrades the chip to literal text); the send content is
//      the draft verbatim, zero wire change.
//  FM7 transcript: the live user row renders through ChatMarkdown (#742), so
//      mention and attachment tokens must come out as chips, never literal.
//  FM9 Esc ladder: with the inline listbox open Esc closes the listbox and
//      the drawer survives (#146 ladder law); the popover's Esc is the
//      FloatingShell layer's.
//  FM10 send path: Enter with a highlighted row inserts instead of sending;
//      Enter during an in-flight upload never sends (the shared wire gate).
//
// Data face = live face stubbed (composer-paste.spec discipline): no
// ?scenario= means the real API branch; the surfaces under test get their
// own stubs and every other GET falls through to a tolerated 500.

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

/** The three-agent roster the inline list is written against (labels are
 *  deliberately fuzzy-separable: "bu" hits only builder). */
const AGENTS = [
  { id: 'agent-1', displayName: 'builder', description: 'Builds features' },
  { id: 'agent-2', displayName: 'reviewer', description: 'Reviews PRs' },
  { id: 'agent-3', displayName: 'deploy-bot', description: 'Ships to prod' },
];

const T_BUILDER = '[builder](agent:agent-1)';

const WIRE_CARD = {
  id: 'todo-1',
  teamId: TEAM_ID,
  projectId: 'proj-1',
  title: '提及数据源探针',
  spec: '',
  phase: 'building',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: 'build-1',
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const PROJECT = {
  id: 'proj-1',
  name: 'cairn',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

/** Boot face: teams / user me carry the teamId, every other GET 500s.
 *  page.route matches in reverse registration order — catch-all first. */
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

/** The five mention-group sources (canonical projections, todo-detail-page
 *  shape) plus the empty thread list = the fresh-thread view whose send
 *  opens a new chief thread. */
async function stubMentionSources(page: Page) {
  const members = [
    { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
    ...AGENTS.map((a, i) => ({
      id: `member-agent-${i}`,
      teamId: TEAM_ID,
      actorId: a.id,
      memberType: 'agent',
      actor: a,
    })),
  ];
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) => route.fulfill({ json: members }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_CARD] }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/skills?*', (route) =>
    route.fulfill({ json: [{ id: 'skill-1', name: 'verify-cairn', description: 'Live stack' }] }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/machines`, (route) =>
    route.fulfill({ json: [{ id: 'machine-1', name: 'xmonsMac' }] }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
}

/** Open the live chief drawer on the board route. The inline list only arms
 *  once the roster has resolved — typing before that races the members
 *  fetch (composer-inline-mention.spec precedent). */
async function openChief(page: Page) {
  await stubBoot(page);
  await stubMentionSources(page);
  const membersLoaded = page.waitForResponse(
    (r) => r.url().includes(`/api/teams/${TEAM_ID}/members`) && r.status() === 200,
  );
  await page.goto('/app?view=board');
  await membersLoaded;

  await page.getByRole('button', { name: '总管' }).click();
  const drawer = page.locator('.chief-drawer');
  await expect(drawer).toBeVisible();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  const listbox = drawer.locator('.mention-inline');
  const rows = drawer.locator('.mention-inline-row');
  return { drawer, input, listbox, rows };
}

// —— upload chain stubs (grant → upload), with capture ——

interface GrantCall {
  fileName: string;
  mimeType: string;
  size: number;
  scope: string;
}

async function stubUploads(page: Page) {
  const state: { grants: GrantCall[]; uploads: number } = { grants: [], uploads: 0 };
  await page.route('**/api/uploads/grant', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    state.grants.push(JSON.parse(request.postData() ?? '{}') as GrantCall);
    const n = state.grants.length;
    return route.fulfill({
      json: {
        uploadUrl: '/api/uploads',
        grant: `grant-${n}`,
        key: `${TEAM_ID}/att-${n}.png`,
        attachmentId: `att-${n}`,
      },
    });
  });
  await page.route('**/api/uploads/upload', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    state.uploads += 1;
    return route.fulfill({ json: { id: 'x', key: 'x', sizeBytes: 3 } });
  });
  return state;
}

/** Hold every grant/upload request until the test releases it (send-race). */
async function deferUploads(page: Page) {
  const held: Route[] = [];
  const hold = (route: Route, request: { method: () => string }) => {
    if (request.method() !== 'POST') return route.fallback();
    held.push(route);
  };
  await page.route('**/api/uploads/grant', hold);
  await page.route('**/api/uploads/upload', hold);
  let n = 0;
  return {
    held,
    async releaseAll() {
      for (const route of held.splice(0)) {
        n += 1;
        const url = String(route.request().url());
        if (url.endsWith('/grant')) {
          await route.fulfill({
            json: {
              uploadUrl: '/api/uploads',
              grant: `grant-${n}`,
              key: `${TEAM_ID}/att-${n}.png`,
              attachmentId: `att-${n}`,
            },
          });
        } else {
          await route.fulfill({ json: { id: 'x', key: 'x', sizeBytes: 3 } });
        }
      }
    },
  };
}

const COMPOSER = '[data-testid="chief-composer-input"]';
const TOKEN_1 = '![pasted-image-1.png](attachment:team-1/att-1.png)';

async function pasteFiles(page: Page, selector: string, files: { name: string; type: string }[]) {
  await page.evaluate(
    ({ selector, files }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) throw new Error(`no textarea: ${selector}`);
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([new Uint8Array(3)], f.name, { type: f.type }));
      ta.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    { selector, files },
  );
}

async function setCaret(page: Page, selector: string, caret: number) {
  await page.evaluate(
    ({ selector, caret }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) throw new Error(`no textarea: ${selector}`);
      ta.focus();
      ta.setSelectionRange(caret, caret);
    },
    { selector, caret },
  );
}

/** Count the chief send POSTs (fresh-thread route). */
async function countChiefSends(page: Page) {
  const sent: string[] = [];
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    sent.push((JSON.parse(request.postData() ?? '{}') as { content?: string }).content ?? '');
    return route.fulfill({
      status: 201,
      json: { thread: { id: 'chief-1', teamId: TEAM_ID, title: 't', createdAt: 0 } },
    });
  });
  return sent;
}

// —— inline completion face (FM1/FM2/FM9/FM10) ——

test('trigger: @ opens the inline listbox inside the drawer; arrows + Enter insert the token (FM1)', async ({
  page,
}) => {
  const { input, listbox, rows } = await openChief(page);
  const sent = await countChiefSends(page);

  await input.fill('@bu');
  await expect(listbox).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('builder');

  // Combobox wiring while open (the textarea keeps DOM focus).
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const listboxId = await listbox.getAttribute('id');
  await expect(input).toHaveAttribute('aria-controls', listboxId as string);

  await input.press('ArrowDown');
  await expect(rows.first()).toHaveClass(/mention-inline-row--active/);
  await input.press('Enter');

  // Whole @query consumed, trailing space landed, nothing sent (FM10).
  await expect(input).toHaveValue(`${T_BUILDER} `);
  await expect(listbox).toBeHidden();
  expect(sent).toHaveLength(0);
  await expect(input).toBeFocused();
  await evidenceShot(page, 'chief-mention-inline-insert.png');
});

test('mouse: hover highlights and the row click inserts without stealing focus (FM2)', async ({
  page,
}) => {
  const { input, listbox, rows } = await openChief(page);

  await input.fill('@bu');
  await expect(listbox).toBeVisible();
  await rows.first().hover();
  await expect(rows.first()).toHaveClass(/mention-inline-row--active/);
  const rowId = await rows.first().getAttribute('id');
  await expect(input).toHaveAttribute('aria-activedescendant', rowId as string);

  await rows.first().click();
  await expect(input).toHaveValue(`${T_BUILDER} `);
  await expect(listbox).toBeHidden();
  await expect(input).toBeFocused();
});

test('geometry: the listbox anchors above the composer wrap inside the drawer (FM2)', async ({
  page,
}) => {
  const { input, listbox } = await openChief(page);

  await input.fill('@');
  await expect(listbox).toBeVisible();
  // Past the 100ms zoom-in-95 enter animation (composer-inline-mention.spec
  // precedent: a mid-animation boundingBox is scaled).
  await page.waitForTimeout(300);

  const lb = await listbox.boundingBox();
  // #950: the wrap anchor migrated to the textarea box — the
  // .chief-composer-input-wrap class died with chief.css, and its only in-flow
  // child was the textarea (the listboxes are absolutely positioned), so the
  // textarea's box is the same in-flow geometry the wrap carried.
  const wrap = await input.boundingBox();
  expect(lb).not.toBeNull();
  expect(wrap).not.toBeNull();
  const l = lb as { x: number; y: number; width: number; height: number };
  const w = wrap as { x: number; y: number; width: number; height: number };
  // Anchored above the wrap (bottom: calc(100% + 6px) against the wrap).
  expect(l.y + l.height).toBeLessThanOrEqual(w.y);
  // Spanning the wrap width (left/right 0 anchoring).
  expect(Math.abs(l.width - w.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(l.x - w.x)).toBeLessThanOrEqual(8);
});

test('Esc closes the listbox and the drawer survives (#146 ladder, FM9)', async ({ page }) => {
  const { drawer, input, listbox } = await openChief(page);

  await input.fill('@bu');
  await expect(listbox).toBeVisible();
  await input.press('Escape');
  await expect(listbox).toBeHidden();
  // The Esc was consumed by the listbox — the docked drawer stays open and
  // the draft is untouched.
  await expect(drawer).toBeVisible();
  await expect(input).toHaveValue('@bu');
});

test('the mention button opens the popover with live group counts and inserts a token (FM1)', async ({
  page,
}) => {
  const { drawer, input } = await openChief(page);

  await drawer.getByRole('button', { name: '提及' }).click();
  const picker = page.locator('.mention-picker');
  await expect(picker).toBeVisible();
  // Counts come from the live hooks (one todo / one skill / three agents /
  // one project / one machine) — a zero row means the group source is not
  // wired on the chief face.
  await expect(picker.locator('.mention-row--top[aria-label="Agents (3)"]')).toBeVisible();
  await expect(picker.locator('.mention-row--top[aria-label="任务 (1)"]')).toBeVisible();
  await expect(picker.locator('.mention-row--top[aria-label="技能 (1)"]')).toBeVisible();
  await expect(picker.locator('.mention-row--top[aria-label="项目 (1)"]')).toBeVisible();
  await expect(picker.locator('.mention-row--top[aria-label="机器 (1)"]')).toBeVisible();
  await evidenceShot(page, 'chief-mention-popover-counts.png');

  await picker.locator('.mention-row--top[aria-label="Agents (3)"]').click();
  await picker.locator('.mention-row--entry', { hasText: 'builder' }).click();
  await picker.locator('.mention-picker-insert').click();

  await expect(picker).toBeHidden();
  await expect(input).toHaveValue(`${T_BUILDER} `);
});

test('Esc with the popover open closes the popover, not the drawer (FM9)', async ({ page }) => {
  const { drawer } = await openChief(page);

  await drawer.getByRole('button', { name: '提及' }).click();
  const picker = page.locator('.mention-picker');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(drawer).toBeVisible();
});

// —— clipboard paste face (FM6/FM10) ——

test('a mid-line image paste lands the token whole-line at the caret (FM6)', async ({ page }) => {
  await stubBoot(page);
  const uploads = await stubUploads(page);
  await stubMentionSources(page);
  await page.goto('/app?view=board');
  await page.getByRole('button', { name: '总管' }).click();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeEditable();

  await input.fill('hello world');
  await setCaret(page, COMPOSER, 5);
  await pasteFiles(page, COMPOSER, [{ name: 'image.png', type: 'image/png' }]);

  // The caret sat mid-line — the insert broke the line on both sides so the
  // token is a whole line (ATTACHMENT_LINE is whole-line anchored).
  await expect(input).toHaveValue(`hello\n${TOKEN_1}\n world`);
  await expect.poll(() => uploads.grants.length).toBe(1);
  expect(uploads.grants[0]).toMatchObject({
    fileName: 'pasted-image-1.png',
    mimeType: 'image/png',
    scope: 'message',
  });
  await expect.poll(() => uploads.uploads).toBe(1);
  await evidenceShot(page, 'chief-paste-token-at-caret.png');
});

test('Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10)', async ({
  page,
}) => {
  await stubBoot(page);
  await stubMentionSources(page);
  const deferred = await deferUploads(page);
  await page.goto('/app?view=board');
  await page.getByRole('button', { name: '总管' }).click();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeEditable();
  const sent = await countChiefSends(page);

  await input.fill('look at this');
  await setCaret(page, COMPOSER, 12);
  await pasteFiles(page, COMPOSER, [{ name: 'image.png', type: 'image/png' }]);

  // The grant is still held — Enter must not send a tokenless message.
  await input.press('Enter');
  expect(sent).toHaveLength(0);
  await expect(input).toHaveValue('look at this');

  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll();
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll();
  await expect(input).toHaveValue(`look at this\n${TOKEN_1}\n`);

  await input.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  // The content is the draft verbatim — the token rides the string, zero
  // wire change on the chief send path.
  expect(sent[0]).toBe(`look at this\n${TOKEN_1}`);
});

// —— transcript rendering (FM7) ——

// The live envelope + one thread whose messages carry both token kinds
// (chief-stream-markdown.spec mock shape, trimmed to what this pin needs).
const THREAD = {
  id: 'chief-bbb',
  chiefId: 'chief-u1-t1',
  userId: USER.id,
  teamId: TEAM_ID,
  title: '线程乙',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's2', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};
const CHIEF_AGENT = {
  id: 'agent-1',
  displayName: 'builder',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: 'r3-gw',
  modelId: 'claude-sonnet-5',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

/** Boot the live drawer at one thread whose user row carries both token
 *  kinds (deep link ?chief=<threadId>). */
async function openChiefThread(page: Page) {
  await stubBoot(page);
  await stubMentionSources(page);
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route) =>
    route.fulfill({ json: [THREAD] }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/chief`, (route) =>
    route.fulfill({
      json: {
        chief: {
          id: 'chief-u1-t1',
          userId: USER.id,
          teamId: TEAM_ID,
          agent: { agentId: 'agent-1' },
          charter: null,
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: CHIEF_AGENT,
        context: null,
        watches: [],
        wakes: [],
      },
    }),
  );
  await page.route('**/api/conversations/chief-bbb/messages', (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: `看看 ${T_BUILDER} 和\n![shot.png](attachment:${TEAM_ID}/att-9.png)`,
            createdAt: 1,
          },
          { id: 'm9', role: 'assistant', content: '收到。', createdAt: 9 },
        ],
      },
    }),
  );
  await page.goto('/app?view=board&chief=chief-bbb');
  const drawer = page.locator('.chief-drawer');
  await expect(drawer).toBeVisible();
  return drawer;
}

test('transcript: mention and attachment tokens in a user row render as chips, never literal (FM7)', async ({
  page,
}) => {
  const drawer = await openChiefThread(page);

  const bubble = drawer.getByTestId('chief-bubble').first();
  await expect(bubble).toHaveAttribute('data-md', '');

  const mention = bubble.locator('.mention-chip--agent');
  await expect(mention).toHaveCount(1);
  await expect(mention).toHaveText('builder');
  const attachment = bubble.locator('.spec-chip');
  await expect(attachment).toHaveCount(1);
  // No literal markdown leaked (the degraded form this pin exists for).
  await expect(bubble).not.toContainText('[builder]');
  await expect(bubble).not.toContainText('![shot.png]');
  await evidenceShot(page, 'chief-transcript-chips.png');
});

// —— fixture capture face (FM3) ——

test.describe('fixture face stays inert (#732 FM3)', () => {
  test('the composer is read-only: no listbox, attach inert, picker at zero counts', async ({
    page,
  }) => {
    await page.goto('/app?view=board&scenario=111');
    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    const input = page.getByTestId('chief-composer-input');
    await expect(input).toHaveAttribute('readonly', '');

    // Typing into the read-only textarea never arms the completion.
    await input.click();
    await page.keyboard.type('@bu');
    await expect(drawer.locator('.mention-inline')).toHaveCount(0);

    await expect(drawer.getByRole('button', { name: '添加附件' })).toBeDisabled();

    // The popover opens on the capture face with zero counts (no live hooks).
    await drawer.getByRole('button', { name: '提及' }).click();
    const picker = page.locator('.mention-picker');
    await expect(picker).toBeVisible();
    await expect(picker.locator('.mention-row--top[aria-label="Agents (0)"]')).toBeVisible();
  });
});