import { expect, type Page, type Route, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// Composer attachment strip (issue #757): the visible face for both ends of
// the paste → upload → token window. While the grant/upload is in flight the
// draft holds no token — the strip must already show a placeholder card (the
// ticket's "渲染一下"); once tokens land the same strip shows the settled
// chips (AttachmentChip reuse); clicking an image card opens the preview
// lightbox instead of a new tab.
//
// Failure modes pinned here:
//  1. empty window — with the grant held, a paste must paint a placeholder
//     card (blob-URL thumbnail at chip size + 上传中 badge) in the same
//     tick; the draft stays text-only (ATTACHMENT_LINE anchoring untouched).
//  2. layout continuity — the placeholder box and the settled chip box are
//     identical (same bytes, same classes), so landing the token moves
//     nothing.
//  3. failed upload — the placeholder leaves with the toast; the draft
//     survives; the strip unmounts (no orphan card).
//  4. settled preview — clicking the settled image chip opens the
//     .attachment-preview dialog with the image; Esc closes it, draft kept.
//  5. in-flight preview — clicking the placeholder previews the local bytes
//     (blob URL) before any server round trip.
//  6. three faces — detail composer, new-task dialog, chief drawer all mount
//     the same strip (detail asserts the full chain; new-task and chief pin
//     placeholder → settled → preview).
//
// Data face = live face stubbed (composer-paste.spec discipline): no
// ?scenario= means the real API branch; grant/upload get deterministic
// stubs and every other GET falls through to a tolerated 500. The settled
// thumbnail and the preview image read stub returns real PNG bytes so the
// <img> elements actually paint (naturalWidth > 0) instead of asserting on
// broken-image boxes.
//
// #948 载体重钉（#910 裁定 1/2）：per-face 类名 locator 换语义载体——strip =
// getByRole('status', { name: '附件' })，占位卡 = data-testid
// "attachment-pending"（button/span 双形无恒 role，二级载体），预览 =
// getByRole('dialog', { name })，缩略/预览图 = getByRole('img', { name })；
// 浮列锚 = data-testid "composer-float"（结构钩子）。pastePng 的 querySelector
// 靶换 [data-testid=new-task-spec]（原生 textarea 断言原样 = 行为断言语义不动）。
// 跨域面锚（.composer-input / .chief-* / .sidebar-new-task）是各自域的残留
// 别名，随各自域票重钉，本 spec 不动。

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };

// 1x1 transparent PNG — fallback bytes before the painted test card loads.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Mutable art holder: the attachments stub reads it per request, so tests
 *  can paint the card after boot and both the paste bytes and the stubbed
 *  read endpoint serve the identical image (placeholder↔settled continuity
 *  needs same bytes on both sides). */
interface TestArt {
  b64: string;
}

const CARD_W = 120;
const CARD_H = 80;

/** Paint a recognizable 120x80 test card (gradient + ticket tag) and return
 *  its PNG base64 — placeholder thumbnails and settled chips paint real,
 *  human-readable pixels instead of 1px stubs. */
async function renderTestCard(page: Page): Promise<string> {
  return page.evaluate(
    ({ w, h }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#7c5cff');
      grad.addColorStop(1, '#2fd4a7');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('#757', 12, 34);
      ctx.font = '13px sans-serif';
      ctx.fillText('paste', 12, 58);
      const url = canvas.toDataURL('image/png');
      const comma = url.indexOf(',');
      if (comma < 0) throw new Error('bad data url');
      return url.slice(comma + 1);
    },
    { w: CARD_W, h: CARD_H },
  );
}

async function stubBoot(page: Page, art: TestArt) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  // Settled thumbnails + preview images read through this endpoint — the
  // bytes are whatever the test painted (art live-read per request).
  await page.route('**/api/attachments/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(art.b64, 'base64'),
    }),
  );
}

interface GrantCall {
  fileName: string;
  mimeType: string;
  size: number;
  scope: string;
}

/** Hold every grant/upload request until the test releases it, so the
 *  in-flight window stays open for placeholder assertions. */
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

/** Synthetic clipboard paste carrying the painted test-card bytes, so
 *  blob-URL thumbnails actually paint (composer-paste.spec FM10 discipline). */
async function pastePng(page: Page, selector: string, b64: string, name = 'image.png') {
  await page.evaluate(
    ({ selector, name, b64 }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) throw new Error(`no textarea: ${selector}`);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: 'image/png' }));
      ta.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    { selector, name, b64 },
  );
}

// —— detail face ————

const CARD_ID = 'todo-1';
const BUILD_ID = 'build-1';
const PROJECT_ID = 'proj-1';

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '附件 strip 探针',
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
  lastActivityAt: 0,
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

const COMPOSER = '.composer-input';
const TOKEN_1 = '![pasted-image-1.png](attachment:team-1/att-1.png)';

async function bootDetail(page: Page, art: TestArt) {
  await stubBoot(page, art);
  await stubDetailSurface(page);
  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator(COMPOSER);
  await expect(input).toBeVisible();
  return input;
}

test('detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move', async ({
  page,
}) => {
  const deferred = await deferUploads(page);
  const art: TestArt = { b64: PNG_1PX };
  const input = await bootDetail(page, art);
  art.b64 = await renderTestCard(page);

  await pastePng(page, COMPOSER, art.b64);

  // FM1: the in-flight card is already there — blob thumbnail + 上传中 —
  // while the draft holds no token yet.
  const strip = page.getByTestId('composer-float').getByRole('status', { name: '附件' });
  await expect(strip).toBeVisible();
  const placeholder = strip.getByTestId('attachment-pending');
  await expect(placeholder).toBeVisible();
  await expect(placeholder.getByText('上传中')).toHaveText('上传中');
  // 粘贴文件名走 #729 counter 重命名（pasted-image-N.png），非 dispatch 的
  // 原始 name——名称锚取落定 token 同源的 canonical 名。
  const thumb = placeholder.getByRole('img', { name: 'pasted-image-1.png' });
  await expect
    .poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(CARD_W);
  await expect(input).toHaveValue('');
  const beforeBox = await placeholder.boundingBox();
  expect(beforeBox).not.toBeNull();
  await evidenceShot(page, 'strip-detail-placeholder.png');

  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // grant
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // upload
  await expect(input).toHaveValue(`${TOKEN_1}\n`);

  // FM2: the settled chip replaces the placeholder at the identical box.
  await expect(placeholder).toHaveCount(0);
  const chip = strip.getByRole('button', { name: 'pasted-image-1.png' });
  await expect(chip).toBeVisible();
  const chipImg = chip.getByRole('img', { name: 'pasted-image-1.png' });
  await expect
    .poll(() => chipImg.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(CARD_W);
  const afterBox = await chip.boundingBox();
  expect(afterBox).toEqual(beforeBox);
  await evidenceShot(page, 'strip-detail-settled.png');
});

test('detail face: clicking the settled chip opens the image preview; Esc closes it', async ({
  page,
}) => {
  const deferred = await deferUploads(page);
  const art: TestArt = { b64: PNG_1PX };
  const input = await bootDetail(page, art);
  art.b64 = await renderTestCard(page);

  await pastePng(page, COMPOSER, art.b64);
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // grant
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // upload
  await expect(input).toHaveValue(`${TOKEN_1}\n`);

  // FM4: preview opens on the settled chip, paints the image, Esc closes.
  const chip = page
    .getByTestId('composer-float')
    .getByRole('button', { name: 'pasted-image-1.png' });
  await chip.click();
  const preview = page.getByRole('dialog', { name: 'pasted-image-1.png' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('pasted-image-1.png');
  const view = preview.getByRole('img', { name: 'pasted-image-1.png' });
  await expect.poll(() => view.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(
    CARD_W,
  );
  await evidenceShot(page, 'strip-detail-preview.png');

  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  // The draft survives the whole preview round trip untouched.
  await expect(input).toHaveValue(`${TOKEN_1}\n`);
});

test('detail face: clicking the in-flight placeholder previews the local bytes', async ({
  page,
}) => {
  const deferred = await deferUploads(page);
  const art: TestArt = { b64: PNG_1PX };
  await bootDetail(page, art);
  art.b64 = await renderTestCard(page);

  await pastePng(page, COMPOSER, art.b64);
  const placeholder = page.getByTestId('composer-float').getByTestId('attachment-pending');
  await expect(placeholder).toBeVisible();

  // FM5: no server round trip has completed (grant still held) — the preview
  // paints the pasted bytes straight from the blob URL.
  await placeholder.click();
  const preview = page.getByRole('dialog', { name: 'pasted-image-1.png' });
  await expect(preview).toBeVisible();
  const view = preview.getByRole('img', { name: 'pasted-image-1.png' });
  await expect.poll(() => view.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(
    CARD_W,
  );
  await expect
    .poll(() => view.evaluate((el) => (el as HTMLImageElement).src.startsWith('blob:')))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);

  // Let the upload land afterwards — the strip settles normally.
  await deferred.releaseAll(); // grant
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // upload
  await expect(page.locator(COMPOSER)).toHaveValue(`${TOKEN_1}\n`);
});

test('detail face: a failed upload clears the placeholder, toasts, keeps the draft', async ({
  page,
}) => {
  await stubBoot(page, { b64: PNG_1PX });
  await stubDetailSurface(page);
  // Hold the grant so the in-flight card deterministically paints first;
  // the release below fails it (instant-500 races React's batching and the
  // card may never paint — that batching is correct UX, not a test gap).
  const held: Route[] = [];
  await page.route('**/api/uploads/grant', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    held.push(route);
  });

  await page.goto(`/app/todo/${CARD_ID}`);
  const input = page.locator(COMPOSER);
  await expect(input).toBeVisible();
  await input.fill('words that must survive');
  await pastePng(page, COMPOSER, PNG_1PX);

  // The placeholder paints while the grant is held…
  const strip = page.getByTestId('composer-float').getByRole('status', { name: '附件' });
  await expect(strip.getByTestId('attachment-pending')).toBeVisible();

  // …then FM3: the grant fails — toast names it, the card leaves, draft whole.
  await expect.poll(() => held.length).toBe(1);
  for (const route of held.splice(0)) {
    await route.fulfill({ status: 500, json: { error: 'grant boom' } });
  }
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('附件上传失败');
  await expect(strip).toHaveCount(0);
  await expect(input).toHaveValue('words that must survive');
});

// —— new-task face ————

const SPEC = '[data-testid="new-task-spec"]';

async function bootNewTask(page: Page, art: TestArt) {
  await stubBoot(page, art);
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.goto('/app');
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog).toBeVisible();
  const spec = dialog.getByRole('textbox');
  await expect(spec).toBeVisible();
  return { dialog, spec };
}

test('new-task face: placeholder → settled chip → preview', async ({ page }) => {
  const deferred = await deferUploads(page);
  const art: TestArt = { b64: PNG_1PX };
  const { dialog, spec } = await bootNewTask(page, art);
  art.b64 = await renderTestCard(page);

  await pastePng(page, SPEC, art.b64);

  const strip = dialog.getByRole('status', { name: '附件' });
  await expect(strip).toBeVisible();
  const placeholder = strip.getByTestId('attachment-pending');
  await expect(placeholder).toBeVisible();
  await expect(placeholder.getByText('上传中')).toHaveText('上传中');
  await evidenceShot(page, 'strip-newtask-placeholder.png');

  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // grant
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // upload
  await expect(spec).toHaveValue(`${TOKEN_1}\n`);

  const chip = strip.getByRole('button', { name: 'pasted-image-1.png' });
  await expect(chip).toBeVisible();
  await chip.click();
  const preview = page.getByRole('dialog', { name: 'pasted-image-1.png' });
  await expect(preview).toBeVisible();
  const view = preview.getByRole('img', { name: 'pasted-image-1.png' });
  await expect.poll(() => view.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(
    CARD_W,
  );
  await evidenceShot(page, 'strip-newtask-preview.png');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});

// —— chief face ————

const AGENTS = [
  { id: 'agent-1', displayName: 'builder', description: 'Builds features' },
  { id: 'agent-2', displayName: 'reviewer', description: 'Reviews PRs' },
];

async function openChief(page: Page, art: TestArt) {
  await stubBoot(page, art);
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
  await page.route('**/api/skills?*', (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/teams/${TEAM_ID}/machines`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
  const membersLoaded = page.waitForResponse(
    (r) => r.url().includes(`/api/teams/${TEAM_ID}/members`) && r.status() === 200,
  );
  await page.goto('/app');
  await membersLoaded;
  // #950 载体：.chief-fab → aria-label 总管钮；.chief-composer-input → testid。
  await page.getByRole('button', { name: '总管', exact: true }).click();
  const drawer = page.locator('.chief-drawer');
  await expect(drawer).toBeVisible();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  return { drawer, input };
}

test('chief face: placeholder → settled chip → preview', async ({ page }) => {
  const deferred = await deferUploads(page);
  const art: TestArt = { b64: PNG_1PX };
  const { drawer, input } = await openChief(page, art);
  art.b64 = await renderTestCard(page);

  // pastePng 走 querySelector 串（helper 契约），testid 属性选择器 = getByTestId 等价面。
  await pastePng(page, '[data-testid="chief-composer-input"]', art.b64);

  const strip = drawer.getByRole('status', { name: '附件' });
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId('attachment-pending')).toBeVisible();
  await evidenceShot(page, 'strip-chief-placeholder.png');

  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // grant
  await expect.poll(() => deferred.held.length).toBe(1);
  await deferred.releaseAll(); // upload
  await expect(input).toHaveValue(`${TOKEN_1}\n`);

  const chip = strip.getByRole('button', { name: 'pasted-image-1.png' });
  await expect(chip).toBeVisible();
  await chip.click();
  const preview = page.getByRole('dialog', { name: 'pasted-image-1.png' });
  await expect(preview).toBeVisible();
  const view = preview.getByRole('img', { name: 'pasted-image-1.png' });
  await expect.poll(() => view.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(
    CARD_W,
  );
  await evidenceShot(page, 'strip-chief-preview.png');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});
