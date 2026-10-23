#!/usr/bin/env node
// verify-cairn drive-paste — 剪贴板图片粘贴 → 既有附件链真用户路径
// (#729,正典 #727 Part 2 + r9 §3.1)。
//
// 路径 A(详情页 composer,confirm 相位):真 PNG 字节以合成 ClipboardEvent
//   (DataTransfer + File 'image.png')粘进 `.composer-input`——grant → upload
//   → token 三步 wire 全捕获,token 以独占一行落 caret 位(行中原样断行),
//   caret 落块后行首;Enter 发送 = revision(反馈行落 transcript)→ 会话里
//   AttachmentChip 缩略图像素真加载(naturalWidth > 0)。
// 路径 B(新建任务对话框):同款粘贴落 `.new-task-spec` caret 位 → 保存 →
//   todo.spec 携 token → 详情页 spec 卡片渲染缩略 chip。
// 路径 C(FM10 探针):真键盘路——clipboard-read/write 权限 +
//   ClipboardItem.write + Meta+V/Ctrl+V,结果( fired / swallowed )记进
//   result.json,不作硬断言(平台差异属证据,不属回归)。
//
// 真值四面:UI token 文本 + caret 位 / wire 捕获(wire-captures.json)/
//   SQLite attachment 行(按 storageKey 精确取)/ 磁盘字节 === 样本字节 +
//   GET /api/attachments/:id 读回一致。样本 PNG(canvas 生成)留在证据目录。
//
// 用法:VERIFY_REPO_ROOT=<worktree> node drive-paste.mjs <todoId>
//   todoId 需处于 confirm 相位(setup-review-seed.mjs 产物)。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ATTACH_DIR = join(RUN_DIR, 'home/server/attachments');
const todoId = process.argv[2];
if (!todoId) {
  process.stderr.write('usage: drive-paste.mjs <todoId (confirm phase)>\n');
  process.exit(2);
}
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-paste`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean,收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
const shot = async (page, name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};

const dbQuery = (fn) => {
  try {
    const Database = require2('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return { ok: true, ...fn(db) };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, skipped: true, reason: String(err?.message ?? err) };
  }
};

// wire 捕获:grant/upload/revision 三缝的请求与响应逐条落盘(r9 §4 同形态)。
const wire = [];
function captureWire(page) {
  page.on('response', async (res) => {
    const url = res.url();
    if (
      !url.includes('/api/uploads/') &&
      !url.includes('/steps') &&
      !url.includes('/api/projects/')
    ) {
      return;
    }
    const req = res.request();
    if (req.method() === 'GET') return;
    let postData = req.postData() ?? null;
    if (postData && postData.length > 4096) postData = `${postData.slice(0, 512)}…(truncated)`;
    let body = null;
    try {
      body = await res.text();
      if (body.length > 4096) body = `${body.slice(0, 512)}…(truncated)`;
    } catch {
      body = null;
    }
    wire.push({
      method: req.method(),
      url,
      status: res.status(),
      postData,
      response: body,
    });
  });
}

/** 合成 ClipboardEvent 粘贴(确定性路,FM10 路 A):真 File 字节进 DataTransfer。 */
async function pasteFile(page, selector, { name, type, bytesB64, caret }) {
  await page.evaluate(
    ({ selector, name, type, bytesB64, caret }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) throw new Error(`no textarea: ${selector}`);
      ta.focus();
      if (caret != null) ta.setSelectionRange(caret, caret);
      const bytes = Uint8Array.from(atob(bytesB64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      ta.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    { selector, name, type, bytesB64, caret },
  );
}

const waitToken = (page, selector, timeout = 20_000) =>
  page
    .waitForFunction(
      (sel) => (document.querySelector(sel)?.value ?? '').includes('attachment:'),
      selector,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);

const browser = await chromium.launch();
const extra = {};

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 732 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  captureWire(page);

  // 样本 PNG:canvas 生成 24×24(红底白心,缩略图肉眼可辨),字节写进证据目录。
  await page.goto(`${WEB}/app`, { waitUntil: 'domcontentloaded' });
  const pngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e11d48';
    ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, 7, 10, 10);
    return c.toDataURL('image/png').split(',')[1];
  });
  const pngBytes = Buffer.from(pngB64, 'base64');
  const samplePath = join(EVIDENCE, 'paste-sample.png');
  writeFileSync(samplePath, pngBytes);
  extra.sample = { fileName: 'paste-sample.png', bytes: pngBytes.length };

  // ---------- 路径 A:详情页 composer(confirm 相位,revision 发送) ----------
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer-input', { timeout: 15_000 });
  check('composer-ready', true, 'confirm 相位 composer 可编辑面就绪');

  await page.fill('.composer-input', '看看这个截图');
  const beforeShot = '01-detail-before-paste.png';
  await shot(page, beforeShot);

  // caret 落「看看|这个截图」中间(偏移 2)——行中粘贴必须两侧断行。
  await pasteFile(page, '.composer-input', {
    name: 'image.png',
    type: 'image/png',
    bytesB64: pngB64,
    caret: 2,
  });
  const landed = await waitToken(page, '.composer-input');
  const draft = await page.locator('.composer-input').inputValue();
  const tokenMatch = draft.match(/!\[([^\]]+)\]\(attachment:([^)]+)\)/);
  const detailKey = tokenMatch?.[2] ?? '';
  check(
    'detail-token-line-atomic',
    landed &&
      tokenMatch != null &&
      tokenMatch[1] === 'pasted-image-1.png' &&
      draft
        .split('\n')
        .some((line) => line.trim() === tokenMatch[0]),
    `token 独占一行落 caret 位,通名 blob 重命名 pasted-image-1.png(${draft.replace(/\n/g, '\\n')})`,
  );
  const expectedCaret = '看看\n'.length + (tokenMatch?.[0].length ?? 0) + 1;
  const caretNow = await page.locator('.composer-input').evaluate((el) => el.selectionStart);
  check(
    'detail-caret-after-block',
    caretNow === expectedCaret,
    `caret 落 token 块后行首(${caretNow},期望 ${expectedCaret})`,
  );
  await shot(page, '02-detail-draft-token.png');

  // wire:grant 请求体携合成名 + scope=message;upload 200。
  await page.waitForTimeout(300);
  const grantCall = wire.find((w) => w.url.includes('/api/uploads/grant'));
  let grantBody = null;
  try {
    grantBody = JSON.parse(grantCall?.postData ?? 'null');
  } catch {
    grantBody = null;
  }
  const uploadCall = wire.find((w) => w.url.includes('/api/uploads/upload'));
  check(
    'wire-grant-upload',
    grantBody?.fileName === 'pasted-image-1.png' &&
      grantBody?.mimeType === 'image/png' &&
      grantBody?.scope === 'message' &&
      grantCall?.status === 200 &&
      uploadCall?.status === 201,
    `grant(fileName=${grantBody?.fileName},scope=${grantBody?.scope},status=${grantCall?.status}) → upload(status=${uploadCall?.status},201=created)`,
  );

  // Enter 发送 = confirm 关口 revision;反馈行(携 token)落 transcript。
  let revisionStatus = null;
  {
    const resp = page.waitForResponse(
      (r) => r.url().includes(`/api/builds/`) && r.url().includes('/steps') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.locator('.composer-input').press('Enter');
    const r = await resp.catch(() => null);
    revisionStatus = r?.status() ?? null;
  }
  check(
    'send-revision',
    revisionStatus === 200 || revisionStatus === 202,
    `POST /api/builds/:id/steps revision(status=${revisionStatus},202=重规划步入队)`,
  );

  // transcript chip:缩略图像素真加载(naturalWidth>0,dicebear 坑同款等待)。
  const chipImg = page.locator('.chat-md-attachment a.spec-chip--image img').first();
  await chipImg.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const img = document.querySelector('.chat-md-attachment a.spec-chip--image img');
      return img != null && img.naturalWidth > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
  const chipHref = await page.locator('.chat-md-attachment a.spec-chip--image').first().getAttribute('href');
  const detailAttId = detailKey.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  check(
    'transcript-chip-pixels',
    chipHref === `/api/attachments/${detailAttId}`,
    `transcript 缩略 chip 渲染且像素加载(href=${chipHref},naturalWidth>0)`,
  );
  await shot(page, '03-detail-transcript-chip.png');

  // API 真值:会话消息行携 token(content 可能是 JSON 字符串字面量,子串判)。
  const todoNow = await getJson(`${SERVER}/api/todos/${todoId}`);
  const convBuildId = todoNow.latestBuildId;
  if (!convBuildId) throw new Error(`todo ${todoId} 无 latestBuildId,会话面无从取真值`);
  const conv = await getJson(`${SERVER}/api/conversations/${convBuildId}/messages`);
  const msgHit = (conv.messages ?? []).some((m) => String(m.content ?? '').includes(detailKey));
  check('api-message-token', msgHit, `会话消息行携 attachment token(build=${convBuildId})`);

  // ---------- 路径 B:新建任务对话框(首个用稿者,scope=spec) ----------
  // 顺序纪律:B 必须在真键盘探针(C)之前——C 会消耗对话框 counter 的 1 号,
  // C 先行会把 B 的合成名顶成 pasted-image-2(每 draft 递增是设计行为,
  // 但证据要的是每面各自从 1 起的干净形态)。
  await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
  await page.click('.sidebar-new-task');
  await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
  await page.fill('.new-task-spec', '粘贴验证任务\n第二行正文');
  await pasteFile(page, '.new-task-spec', {
    name: 'image.png',
    type: 'image/png',
    bytesB64: pngB64,
    caret: 6, // 「粘贴验证任务」行尾
  });
  const specLanded = await waitToken(page, '.new-task-spec');
  const specValue = await page.locator('.new-task-spec').inputValue();
  const specMatch = specValue.match(/!\[([^\]]+)\]\(attachment:([^)]+)\)/);
  const specKey = specMatch?.[2] ?? '';
  check(
    'newtask-token-line-atomic',
    specLanded &&
      specMatch != null &&
      specMatch[1] === 'pasted-image-1.png' &&
      specValue === `粘贴验证任务\n${specMatch[0]}\n第二行正文`,
    `spec 面 token 独占一行落 caret 位(${specValue.replace(/\n/g, '\\n')})`,
  );
  await shot(page, '04-newtask-spec-token.png');

  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  const todos = await getJson(`${SERVER}/api/todos`);
  const newTodo = (Array.isArray(todos) ? todos : []).find((t) => t.title === '粘贴验证任务');
  check(
    'newtask-save-carries-token',
    typeof newTodo?.spec === 'string' && newTodo.spec.includes(specKey),
    `保存后 todo.spec 携 token(${newTodo ? '命中任务' : '任务缺失'})`,
  );
  extra.newTodoId = newTodo?.id ?? null;

  // 详情 spec 卡片:缩略 chip 渲染 + 像素加载(既有面回归钉)。
  if (newTodo?.id) {
    await page.goto(`${WEB}/app/todo/${newTodo.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.spec-block a.spec-chip--image', { timeout: 15_000 });
    await page.waitForFunction(
      () => {
        const img = document.querySelector('.spec-block a.spec-chip--image img');
        return img != null && img.naturalWidth > 0;
      },
      undefined,
      { timeout: 15_000 },
    );
    const specChipHref = await page.locator('.spec-block a.spec-chip--image').getAttribute('href');
    const specAttId = specKey.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
    check(
      'spec-card-chip-pixels',
      specChipHref === `/api/attachments/${specAttId}`,
      `spec 卡片缩略 chip 渲染且像素加载(href=${specChipHref})`,
    );
    await shot(page, '05-newtask-spec-card-chip.png');
  } else {
    check('spec-card-chip-pixels', false, '新建任务未落库,详情面无从验证');
  }

  // ---------- 路径 C:真键盘探针(FM10 路 B,不作硬断言,verdict 进证据) ----------
  let realKeyboard = { fired: false, note: 'not attempted' };
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
    await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
    await page.click('.sidebar-new-task');
    await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
    await page.locator('.new-task-spec').click();
    const wrote = await page.evaluate(async (b64) => {
      try {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
        ]);
        return true;
      } catch (err) {
        return String(err?.message ?? err);
      }
    }, pngB64);
    if (wrote !== true) {
      realKeyboard = { fired: false, note: `clipboard.write refused: ${wrote}` };
    } else {
      const chord = process.platform === 'darwin' ? 'Meta+v' : 'Control+v';
      await page.keyboard.press(chord);
      const fired = await waitToken(page, '.new-task-spec', 5000);
      realKeyboard = {
        fired,
        chord,
        note: fired
          ? `${chord} 真键盘粘贴触发同一链,token 落 spec`
          : `${chord} 未被引擎送达页面(macOS headless 已知形态);合成事件路已覆盖`,
      };
    }
  } catch (err) {
    realKeyboard = { fired: false, note: String(err?.message ?? err) };
  }
  check(
    'real-keyboard-probe',
    true,
    `真键盘路探针:fired=${realKeyboard.fired}(${realKeyboard.note})`,
  );
  extra.realKeyboard = realKeyboard;
  if (realKeyboard.fired) await shot(page, '06-real-keyboard-token.png');

  // ---------- 真值:SQLite 行 + 磁盘字节 + 读回(两 scope 各一) ----------
  const dbTruth = dbQuery((db) => ({
    rows: db
      .prepare(
        'SELECT id, fileName, mimeType, sizeBytes, storageKey, scope, status FROM attachment WHERE storageKey IN (?, ?)',
      )
      .all(detailKey, specKey),
  }));
  const rows = dbTruth.ok ? dbTruth.rows : [];
  const detailRow = rows.find((r) => r.storageKey === detailKey);
  const specRow = rows.find((r) => r.storageKey === specKey);
  check(
    'db-attachment-rows',
    dbTruth.ok &&
      rows.length === 2 &&
      detailRow?.status === 'ready' &&
      detailRow?.scope === 'message' &&
      specRow?.status === 'ready' &&
      specRow?.scope === 'spec' &&
      rows.every(
        (r) => r.fileName === 'pasted-image-1.png' && r.mimeType === 'image/png' && r.sizeBytes === pngBytes.length,
      ),
    `SQLite 两行 status=ready,detail scope=message / newtask scope=spec,fileName=pasted-image-1.png,sizeBytes=${pngBytes.length}${dbTruth.skipped ? `(跳过:${dbTruth.reason})` : ''}`,
  );
  extra.attachmentRows = rows;

  const diskOk = [detailRow, specRow].every(
    (r) => r?.storageKey && existsSync(join(ATTACH_DIR, r.storageKey)),
  );
  const diskSame =
    diskOk &&
    [detailRow, specRow].every((r) => readFileSync(join(ATTACH_DIR, r.storageKey)).equals(pngBytes));
  check(
    'disk-bytes-equal-sample',
    diskSame,
    `磁盘文件字节 === 样本 PNG(${detailRow?.storageKey ?? '缺'} / ${specRow?.storageKey ?? '缺'})`,
  );

  let readbackOk = true;
  const readbackDetail = [];
  for (const r of [detailRow, specRow]) {
    if (!r?.id) {
      readbackOk = false;
      continue;
    }
    const res = await fetch(`${SERVER}/api/attachments/${r.id}`, { signal: AbortSignal.timeout(8000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const okOne = res.status === 200 && buf.equals(pngBytes);
    readbackOk = readbackOk && okOne;
    readbackDetail.push({ id: r.id, status: res.status, bytesEqual: buf.equals(pngBytes) });
  }
  check('readback-endpoint', readbackOk, `GET /api/attachments/:id 读回字节一致(${JSON.stringify(readbackDetail)})`);

  await context.close();
} finally {
  await browser.close();
}

writeFileSync(join(EVIDENCE, 'wire-captures.json'), `${JSON.stringify(wire, null, 2)}\n`);
artifacts.push('wire-captures.json');
artifacts.push('paste-sample.png');

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'paste',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive paste:PASS' : 'drive paste:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
