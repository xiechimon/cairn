import { expect, type Page, type Route, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// Clipboard paste → the existing #310 attachment chain (issue #729, canon
// #727 Part 2 + r9 §3.1). Both faces are pinned: the detail conversation
// composer (steer send path) and the new-task dialog (spec create path).
//
// Failure modes pinned here (issue #729 list, one test per mode):
//  1. line atomicity — a mid-line paste must break the line; the token
//     lands whole-line at the caret (ATTACHMENT_LINE is whole-line
//     anchored, a shared line silently degrades the chip to text);
//  2./6. synthesized names — generic clipboard blobs become
//     pasted-image-<n>.<ext>, multi-image pastes never collide;
//  3. send race — Enter while the upload is in flight is blocked; once the
//     token lands, Enter sends it inside the content;
//  4./5. rejections — a non-whitelisted file or an over-cap file never
//     reaches grant, the toast names the reason, the draft survives;
//  7. a text-only paste never sees preventDefault (zero behavior change);
//  9. both faces run the same shared insert (same expectations, two DOMs);
//  10. clipboard simulation — the synthetic DataTransfer paste event is the
//     deterministic route (assertions below); the real keyboard route
//     (permissions + ClipboardItem.write + Cmd/Ctrl+V) rides the last test
//     so a browser-shape regression surfaces there, not in every pin.
//
// Data face = live face stubbed (composer-wire-reject stubBoot discipline):
// no ?scenario= means the real API branch; grant/upload get deterministic
// stubs and every other GET falls through to a tolerated 500.

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

// 1x1 transparent PNG — the real-clipboard probe writes these bytes.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

// —— upload chain stubs (grant → upload), with capture ——

interface GrantCall {
  fileName: string;
  mimeType: string;
  size: number;
  scope: string;
}

interface UploadStubs {
  grants: GrantCall[];
  uploads: number;
}

async function stubUploads(page: Page): Promise<UploadStubs> {
  const state: UploadStubs = { grants: [], uploads: 0 };
  await page.route('**/api/uploads/grant', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    const body = JSON.parse(request.postData() ?? '{}') as GrantCall;
    state.grants.push(body);
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

/** Hold every grant request until the test releases it (send-race pins). */
async function deferUploads(page: Page) {
  const held: Route[] = [];
  await page.route('**/api/uploads/grant', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    held.push(route);
  });
  await page.route('**/api/uploads/upload', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    held.push(route);
  });
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

// —— synthetic clipboard paste (the deterministic route, FM10) ——

interface PastedFile {
  name: string;
  type: string;
  /** Byte length; content is zeros (the chain never reads it client-side). */
  size?: number;
  bytes?: number[];
}

async function pasteFiles(page: Page, selector: string, files: PastedFile[]) {
  await page.evaluate(
    ({ selector, files }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) throw new Error(`no textarea: ${selector}`);
      const dt = new DataTransfer();
      for (const f of files) {
        const buf =
          f.bytes !== undefined ? Uint8Array.from(f.bytes) : new Uint8Array(f.size ?? 3);
        dt.items.add(new File([buf], f.name, { type: f.type }));
      }
      ta.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    { selector, files },
  );
}

async function pasteTextOnly(page: Page, selector: string, text: string): Promise<boolean> {
  return page.evaluate(
    ({ selector, text }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) throw new Error(`no textarea: ${selector}`);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const event = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      ta.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { selector, text },
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

// —— detail face: building-phase card, the composer sends a steer ————

const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '粘贴探针',
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

async function stubDetailSurface(page: Page) {
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    route.fulfill({
      json: [
        { id: 'member-user', teamId: TEAM_ID, actorId: USER.id, memberType: 'user', actor: USER },
      ],
    }),
  );
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [WIRE_CARD] }));
  await page.route(`**/api/todos/${CARD_ID}`, (route) => route.fulfill({ json: WIRE_CARD }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route(`**/api/builds/${BUILD_ID}`, (route) => route.fulfill({ json: WIRE_BUILD }));
  await page.route(`**/api/builds/${BUILD_ID}/steps`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/plans`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/usage`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/builds/${BUILD_ID}/changes`, (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: EMPTY_CONVERSATION });
  });
}

const COMPOSER = '[data-testid="composer-card"] textarea';
const TOKEN_1 = '![pasted-image-1.png](attachment:team-1/att-1.png)';
const TOKEN_2 = '![pasted-image-2.png](attachment:team-1/att-2.png)';

async function bootDetail(page: Page) {
  await stubBoot(page);
  await stubDetailSurface(page);
  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator(COMPOSER);
  await expect(input).toBeVisible();
  return input;
}

test('detail face: a mid-line image paste lands the token whole-line at the caret', async ({
  page,
}) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);

  await input.fill('hello world');
  await setCaret(page, COMPOSER, 5);
  await pasteFiles(page, COMPOSER, [{ name: 'image.png', type: 'image/png' }]);

  // FM1: the caret sat mid-line — the insert broke the line on both sides.
  await expect(input).toHaveValue(`hello\n${TOKEN_1}\n world`);
  // FM2/FM6: the generic clipboard blob got the synthesized per-draft name,
  // and exactly one grant + one upload hit the wire (no double-fire).
  await expect.poll(() => uploads.grants.length).toBe(1);
  expect(uploads.grants[0]).toMatchObject({
    fileName: 'pasted-image-1.png',
    mimeType: 'image/png',
    scope: 'message',
  });
  await expect.poll(() => uploads.uploads).toBe(1);
  // The caret rests on the line below the token block (CC cursor canon).
  await expect
    .poll(() => input.evaluate((el) => (el as HTMLTextAreaElement).selectionStart))
    .toBe('hello\n'.length + TOKEN_1.length + 1);
  await evidenceShot(page, 'paste-detail-caret-insert.png');
});

test('detail face: one multi-image paste puts every token on its own line', async ({ page }) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);

  await pasteFiles(page, COMPOSER, [
    { name: 'image.png', type: 'image/png' },
    { name: 'image.png', type: 'image/png' },
  ]);

  await expect(input).toHaveValue(`${TOKEN_1}\n${TOKEN_2}\n`);
  await expect.poll(() => uploads.grants.length).toBe(2);
  // Same-draft numbering never collides (FM6).
  expect(uploads.grants.map((g) => g.fileName)).toEqual([
    'pasted-image-1.png',
    'pasted-image-2.png',
  ]);
});

test('detail face: a text-only paste is never preventDefaulted (FM7 zero change)', async ({
  page,
}) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);

  await input.fill('draft stays');
  await setCaret(page, COMPOSER, 5);
  const prevented = await pasteTextOnly(page, COMPOSER, 'plain text');

  expect(prevented).toBe(false);
  expect(uploads.grants).toEqual([]);
  await expect(input).toHaveValue('draft stays');
});

test('detail face: a non-whitelisted paste is rejected with a toast, grant never fires', async ({
  page,
}) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);

  await input.fill('kept');
  await pasteFiles(page, COMPOSER, [{ name: 'evil.zip', type: 'application/zip' }]);

  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('不支持该文件类型');
  await expect(toast).toContainText('evil.zip');
  expect(uploads.grants).toEqual([]);
  // FM12: the draft survives the rejection untouched.
  await expect(input).toHaveValue('kept');
  await evidenceShot(page, 'paste-detail-reject-toast.png');
});

test('detail face: an over-cap paste is rejected with a toast, grant never fires', async ({
  page,
}) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);

  await pasteFiles(page, COMPOSER, [
    { name: 'big.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 },
  ]);

  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('附件超过 10MB 上限');
  expect(uploads.grants).toEqual([]);
});

test('detail face: a non-image whitelist file (text/plain) is accepted under its real name', async ({
  page,
}) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);

  await pasteFiles(page, COMPOSER, [{ name: 'notes.txt', type: 'text/plain' }]);

  // Real names are never renamed — only generic clipboard blobs are.
  await expect(input).toHaveValue(`![notes.txt](attachment:team-1/att-1.png)\n`);
  await expect.poll(() => uploads.grants.length).toBe(1);
  expect(uploads.grants[0]).toMatchObject({
    fileName: 'notes.txt',
    mimeType: 'text/plain',
    scope: 'message',
  });
});

test('detail face: a mixed file+text clipboard takes the files and drops the text', async ({
  page,
}) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);

  // The synthetic event carries both a file and plain text; the handler
  // must preventDefault (text dropped — files win per the ticket ruling).
  const prevented = await page.evaluate(() => {
    const ta = document.querySelector('[data-testid="composer-card"] textarea');
    if (!(ta instanceof HTMLTextAreaElement)) throw new Error('no composer');
    const dt = new DataTransfer();
    dt.setData('text/plain', 'copied caption');
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(prevented).toBe(true);
  await expect(input).toHaveValue(`${TOKEN_1}\n`);
  await expect.poll(() => uploads.grants.length).toBe(1);
});

test('detail face: a failed upload toasts and the draft survives untouched', async ({ page }) => {
  await stubBoot(page);
  await stubDetailSurface(page);
  await page.route('**/api/uploads/grant', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'grant boom' } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator(COMPOSER);
  await expect(input).toBeVisible();
  await input.fill('words that must survive');
  await setCaret(page, COMPOSER, 5);
  await pasteFiles(page, COMPOSER, [{ name: 'image.png', type: 'image/png' }]);

  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('附件上传失败');
  // FM12: not one character lost, not a newline inserted.
  await expect(input).toHaveValue('words that must survive');
});

test('detail face: Enter during the upload does not send; after it lands, Enter sends the token', async ({
  page,
}) => {
  // Route order matters: page.route matches in reverse registration order,
  // so the stubBoot catch-all goes first and the POST-only handlers last.
  await stubBoot(page);
  await stubDetailSurface(page);
  const deferred = await deferUploads(page);
  let steers = 0;
  let lastContent = '';
  await page.route(`**/api/conversations/${BUILD_ID}/messages`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    steers += 1;
    lastContent = (JSON.parse(request.postData() ?? '{}') as { content?: string }).content ?? '';
    return route.fulfill({ status: 201, json: { message: { id: 'msg-1' } } });
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator(COMPOSER);
  await expect(input).toBeVisible();
  await input.fill('look at this');
  await setCaret(page, COMPOSER, 12);
  await pasteFiles(page, COMPOSER, [{ name: 'image.png', type: 'image/png' }]);

  // FM3: the grant is still held — Enter must not send a tokenless message.
  await input.press('Enter');
  expect(steers).toBe(0);
  await expect(input).toHaveValue('look at this');

  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // grant
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // upload
  await expect(input).toHaveValue(`look at this\n${TOKEN_1}\n`);

  await input.press('Enter');
  await expect.poll(() => steers).toBe(1);
  expect(lastContent).toBe(`look at this\n${TOKEN_1}`);
  await expect(input).toHaveValue('');
  await evidenceShot(page, 'paste-detail-send-after-upload.png');
});

// —— new-task face: spec textarea, save posts the createTodo wire ————

const SPEC = '.new-task-spec';

async function bootNewTask(page: Page) {
  await stubBoot(page);
  // The live hook fetches /api/projects?teamId=… — the glob must carry the
  // query wildcard or the catch-all 500s it and the dialog falls back to
  // the fixture default project id.
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.goto('/app');
  await page.locator('.sidebar-new-task').click();
  const dialog = page.locator('.new-task-dialog');
  await expect(dialog).toBeVisible();
  const spec = page.locator(SPEC);
  await expect(spec).toBeVisible();
  return { dialog, spec };
}

test('new-task face: paste inserts the token line-atomic into the spec and save carries it', async ({
  page,
}) => {
  const uploads = await stubUploads(page);
  const { spec } = await bootNewTask(page);
  let created: { title?: string; spec?: string } | null = null;
  await page.route(`**/api/projects/${PROJECT_ID}/todos`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    created = JSON.parse(request.postData() ?? '{}');
    return route.fulfill({ status: 201, json: { ...WIRE_CARD, id: 'todo-2' } });
  });

  await spec.fill('修复登录\n复现步骤');
  await setCaret(page, SPEC, 4); // end of the first line
  await pasteFiles(page, SPEC, [{ name: 'image.png', type: 'image/png' }]);

  // FM9: the shared insert produces the same line-atomic shape on this face.
  await expect(spec).toHaveValue(`修复登录\n${TOKEN_1}\n复现步骤`);
  await expect.poll(() => uploads.grants.length).toBe(1);
  expect(uploads.grants[0]).toMatchObject({
    fileName: 'pasted-image-1.png',
    scope: 'spec',
  });

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => created !== null).toBe(true);
  expect((created as { spec?: string }).spec).toBe(`修复登录\n${TOKEN_1}\n复现步骤`);
  await evidenceShot(page, 'paste-newtask-spec-token.png');
});

test('new-task face: save is blocked while the paste upload is in flight', async ({ page }) => {
  const deferred = await deferUploads(page);
  const { spec } = await bootNewTask(page);
  let creates = 0;
  await page.route(`**/api/projects/${PROJECT_ID}/todos`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    creates += 1;
    return route.fulfill({ status: 201, json: { ...WIRE_CARD, id: 'todo-3' } });
  });

  await spec.fill('任务正文');
  await pasteFiles(page, SPEC, [{ name: 'image.png', type: 'image/png' }]);

  // FM3 on this face: the save must not leave with the upload in flight.
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect(creates).toBe(0);

  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // grant
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // upload
  await expect(spec).toHaveValue(`任务正文\n${TOKEN_1}\n`);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => creates).toBe(1);
});

// —— FM10 probe: the real keyboard route (permissions + ClipboardItem) ————

test('detail face probe: a real Cmd/Ctrl+V clipboard image paste rides the same chain', async ({
  page,
  context,
}) => {
  const uploads = await stubUploads(page);
  const input = await bootDetail(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const wrote = await page.evaluate(async (b64: string) => {
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
      ]);
      return true;
    } catch {
      return false;
    }
  }, PNG_1PX);
  test.info().annotations.push({
    type: 'clipboard-write',
    description: wrote ? 'ClipboardItem.write accepted' : 'ClipboardItem.write refused',
  });
  test.skip(!wrote, 'this browser refuses ClipboardItem image writes — synthetic route covers it');

  await input.focus();
  const chord = process.platform === 'darwin' ? 'Meta+v' : 'Control+v';
  await page.keyboard.press(chord);

  // Native chords never reach the page on some platform/engine pairs
  // (macOS headless Chromium treats Cmd+V as a menu command). The
  // synthetic DataTransfer tests above are the deterministic pins; this
  // probe records the real route's verdict per browser and skips instead
  // of failing when the chord is swallowed (FM10: browser differences go
  // into the evidence, not into CI red).
  const fired = await expect
    .poll(() => uploads.grants.length, { timeout: 4_000 })
    .toBe(1)
    .then(
      () => true,
      () => false,
    );
  test.info().annotations.push({
    type: 'real-keyboard-paste',
    description: fired ? `${chord} fired a paste the chain consumed` : `${chord} never reached the page`,
  });
  test.skip(!fired, 'real keyboard paste unavailable on this platform — synthetic route covers it');

  await expect(input).toHaveValue(`![pasted-image-1.png](attachment:team-1/att-1.png)\n`);
  expect(uploads.grants[0]?.fileName).toBe('pasted-image-1.png');
  await evidenceShot(page, 'paste-detail-real-keyboard.png');
});
