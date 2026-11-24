import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const FILE_TASK = { ...TASK, id: 'todo-f', title: '整理简历', phase: 'done', seqNum: 21 };

function pdf(line: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

interface FileSpec {
  id: string;
  fileName: string;
  kind: string;
  type: string;
  body: string | Buffer;
}

const FILES: Record<string, FileSpec> = {
  resume: {
    id: 'att-resume',
    fileName: 'resume.pdf',
    kind: 'pdf',
    type: 'application/pdf',
    body: pdf('Ada Lovelace, analyst'),
  },
  sheet: {
    id: 'att-sheet',
    fileName: 'scores.csv',
    kind: 'sheet',
    type: 'text/csv',
    body: '姓名,城市,分数\nAda,London,98\nGrace,"New York, NY",95\n',
  },
  code: {
    id: 'att-code',
    fileName: 'pace.py',
    kind: 'code',
    type: 'text/plain',
    body: 'def pace(km, climb):\n    flat = km / 4\n    up = climb / 600\n    return flat + up\n',
  },
};

type Comment = Record<string, unknown> & { id: string; pin: number; status: string };

async function openFile(page: Page, file: FileSpec, seeded: Comment[] = []) {
  const state = {
    comments: seeded,
    writes: [] as string[],
    sends: [] as { content: string; designCommentIds?: string[] }[],
  };
  const version = (seq: number) => ({
    id: `ver-${seq}`,
    todoId: FILE_TASK.id,
    fileName: file.fileName,
    seq,
    attachmentId: file.id,
    sizeBytes: 100,
    source: 'agent',
    restoredFromSeq: null,
    createdAt: Date.now() - (3 - seq) * 60_000,
  });
  const versions = [version(1), version(2)];
  const base = `/api/todos/${FILE_TASK.id}/design`;
  const mock = { threads: [THREAD], messages: [] as unknown[], todos: [FILE_TASK] };
  await mockLive(page, mock, (path, route, json) => {
    const method = route.request().method();
    if (path === `/api/attachments/${file.id}/artifact`)
      return json({
        todoId: FILE_TASK.id,
        fileName: file.fileName,
        kind: file.kind,
        versionId: 'ver-2',
        versionSeq: 2,
        versionCount: 2,
        openComments: state.comments.filter((c) => c.status === 'open').length,
      });
    if (path === `/api/todos/${FILE_TASK.id}`) return json(FILE_TASK);
    if (path === base)
      return json({
        pages: [
          {
            fileName: file.fileName,
            kind: file.kind,
            current: versions[1],
            versionCount: 2,
            openComments: state.comments.filter((c) => c.status === 'open').length,
            shareToken: null,
          },
        ],
        shareOrigin: null,
      });
    if (path === `${base}/${file.fileName}/versions`) return json([...versions].reverse());
    if (path === `${base}/${file.fileName}/comments`) return json(state.comments);
    if (path === `${base}/comments` && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const row: Comment = {
        ...body,
        id: `cmt-${state.comments.length + 1}`,
        todoId: FILE_TASK.id,
        fileName: file.fileName,
        versionSeq: 2,
        pin: Math.max(0, ...state.comments.map((c) => c.pin)) + 1,
        markAttachmentId: null,
        status: 'open',
        messageId: null,
        sentAt: null,
        handledSeq: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.comments = [...state.comments, row];
      state.writes.push(`create ${JSON.stringify(body.anchor)}`);
      return json(row, 201);
    }
    const commentId = /\/design\/comments\/([^/]+)$/.exec(path)?.[1];
    if (commentId !== undefined && method === 'PATCH') {
      const patch = route.request().postDataJSON() as { retarget?: Record<string, unknown> };
      state.writes.push(`patch ${commentId} ${JSON.stringify(patch.retarget?.anchor ?? patch)}`);
      state.comments = state.comments.map((c) =>
        c.id !== commentId
          ? c
          : patch.retarget !== undefined
            ? { ...c, ...patch.retarget, status: 'open', sentAt: null, handledSeq: null }
            : { ...c, ...patch },
      );
      return json(state.comments.find((c) => c.id === commentId));
    }
    if (/^\/api\/conversations\/[^/]+\/messages$/.test(path) && method === 'POST') {
      const body = route.request().postDataJSON() as { content: string; designCommentIds?: string[] };
      state.sends.push(body);
      const ids = new Set(body.designCommentIds ?? []);
      state.comments = state.comments.map((c) =>
        ids.has(c.id) ? { ...c, status: 'sent', sentAt: Date.now() } : c,
      );
      mock.messages = [
        ...mock.messages,
        { id: `n${mock.messages.length + 1}`, role: 'user', content: body.content, createdAt: Date.now() },
      ];
      return json({ thread: THREAD }, 201);
    }
    if (path === `/api/attachments/${file.id}`)
      return route.fulfill({ status: 200, contentType: file.type, body: file.body });
    return undefined;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/app?artifact=${file.id}.${file.fileName.split('.').pop()}&artifactName=${file.fileName}`,
  );
  return { panel: page.getByTestId('artifact-panel'), state };
}

test('a box drawn on a PDF page saves as a pinned comment and the list sends it to the Coordinator', async ({
  page,
}) => {
  const { panel, state } = await openFile(page, FILES.resume as FileSpec);
  const layer = panel.locator('[data-testid="artifact-region-layer"][data-page="1"]');
  await expect(panel.getByTestId('artifact-pdf-page')).toHaveCount(1);
  await panel.getByTestId('artifact-comment-toggle').click();
  await expect(panel.getByTestId('artifact-comment-strip')).toBeVisible();
  await expect(panel.getByTestId('design-comment-list')).toBeVisible();
  const box = await layer.boundingBox();
  if (box === null) throw new Error('no page box');
  await page.mouse.move(box.x + 60, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 140, { steps: 4 });
  await page.mouse.up();
  const composer = panel.getByTestId('artifact-comment-composer');
  await expect(composer).toContainText('第 1 页的选区');
  await composer.getByTestId('artifact-comment-note').fill('把这段经历挪到前面');
  await composer.getByTestId('artifact-comment-save').click();
  await expect(composer).toHaveCount(0);
  const anchor = JSON.parse(state.writes[0]?.replace(/^create /, '') ?? '{}') as {
    type: string;
    page: number;
    rect: { width: number; height: number };
  };
  expect(anchor).toMatchObject({ type: 'region', page: 1 });
  expect(anchor.rect.width).toBeGreaterThan(0.1);
  await expect(layer.locator('[data-testid="design-pin"][data-pin="1"]')).toBeVisible();
  await expect(panel.getByTestId('artifact-comment-count')).toHaveText('1');
  const row = panel.locator('[data-testid="design-comment-row"][data-pin="1"]');
  await expect(row.getByTestId('design-comment-state')).toHaveText('待处理');
  await panel.getByTestId('design-comment-send-all').click();
  await expect.poll(() => state.sends.length).toBe(1);
  expect(state.sends[0]).toMatchObject({ designCommentIds: ['cmt-1'] });
  await expect(row.getByTestId('design-comment-state')).toHaveText('处理中');
  await expect(panel.getByTestId('design-comment-send-all')).toHaveCount(0);
});

test('a sheet takes a dragged cell range and code takes a clicked line', async ({ page }) => {
  const sheet = await openFile(page, FILES.sheet as FileSpec);
  await sheet.panel.getByTestId('artifact-comment-toggle').click();
  await sheet.panel.locator('[data-cell="B2"]').hover();
  await page.mouse.down();
  await sheet.panel.locator('[data-cell="C3"]').hover();
  await page.mouse.up();
  const composer = sheet.panel.getByTestId('artifact-comment-composer');
  await expect(composer).toContainText('B2:C3');
  await composer.getByTestId('artifact-comment-note').fill('分数保留一位小数');
  await composer.getByTestId('artifact-comment-save').click();
  expect(sheet.state.writes).toEqual(['create {"type":"cells","r1":1,"c1":1,"r2":2,"c2":2}']);
  await expect(sheet.panel.getByTestId('design-comment-row')).toContainText('B2:C3');

  const code = await openFile(page, FILES.code as FileSpec);
  await code.panel.getByTestId('artifact-comment-toggle').click();
  await code.panel.locator('[data-line="3"] > span').first().click();
  const lineComposer = code.panel.getByTestId('artifact-comment-composer');
  await expect(lineComposer).toContainText('第 3 行');
  await lineComposer.getByTestId('artifact-comment-note').fill('爬升按 10 分钟每百米算');
  await lineComposer.getByTestId('artifact-comment-save').click();
  expect(code.state.writes).toEqual(['create {"type":"lines","from":3,"to":3}']);
  await expect(code.panel.locator('[data-line="3"] [data-testid="design-pin"]')).toBeVisible();
});

test('a sent comment whose lines are gone in the newer version shows 已失效 and can be pointed again', async ({
  page,
}) => {
  const stale: Comment = {
    id: 'cmt-1',
    todoId: FILE_TASK.id,
    fileName: 'pace.py',
    versionId: 'ver-1',
    versionSeq: 1,
    pin: 1,
    viewport: 'desktop',
    note: '这里改成每 600 米一小时',
    markAttachmentId: null,
    status: 'sent',
    messageId: 'm1',
    anchor: { type: 'lines', from: 40, to: 41 },
    sentAt: Date.now() - 120_000,
    handledSeq: 2,
    elementId: '',
    selector: '',
    label: '第 40–41 行',
    text: '',
    htmlHint: '',
    position: { x: 0, y: 0, width: 0, height: 0 },
    style: null,
    createdAt: Date.now() - 180_000,
    updatedAt: Date.now() - 120_000,
  };
  const { panel, state } = await openFile(page, FILES.code as FileSpec, [stale]);
  await panel.getByTestId('artifact-comment-toggle').click();
  const row = panel.locator('[data-testid="design-comment-row"][data-pin="1"]');
  await expect(row.getByTestId('design-comment-state')).toHaveText('已失效');
  await expect(row).toContainText('原来的位置在新版里找不到了');
  await row.getByTestId('design-comment-retarget').click();
  await expect(panel.getByTestId('artifact-comment-strip')).toContainText('点一个新位置');
  await panel.locator('[data-line="2"] > span').first().click();
  await expect.poll(() => state.writes).toEqual(['patch cmt-1 {"type":"lines","from":2,"to":2}']);
  await expect(row.getByTestId('design-comment-state')).toHaveText('待处理');
});

test('a PDF box keeps the text it covers, and on a newer version its pin follows that text or turns 已失效', async ({
  page,
}) => {
  const sent = (id: string, pin: number, text: string, page: number): Comment => ({
    id,
    todoId: FILE_TASK.id,
    fileName: 'resume.pdf',
    versionId: 'ver-1',
    versionSeq: 1,
    pin,
    viewport: 'desktop',
    note: '这段挪到前面',
    markAttachmentId: null,
    status: 'sent',
    messageId: 'm1',
    anchor: { type: 'region', page, rect: { x: 0.1, y: 0.6, width: 0.8, height: 0.1 } },
    sentAt: Date.now() - 120_000,
    handledSeq: 2,
    elementId: '',
    selector: '',
    label: `第 ${page} 页的选区`,
    text,
    htmlHint: '',
    position: { x: 0, y: 0, width: 0, height: 0 },
    style: null,
    createdAt: Date.now() - 180_000,
    updatedAt: Date.now() - 120_000,
  });
  const { panel, state } = await openFile(page, FILES.resume as FileSpec, [
    sent('cmt-1', 1, 'Lovelace, analyst', 2),
    sent('cmt-2', 2, 'Babbage, engineer', 1),
  ]);
  await panel.getByTestId('artifact-comment-toggle').click();
  const moved = panel.locator('[data-testid="design-comment-row"][data-pin="1"]');
  const gone = panel.locator('[data-testid="design-comment-row"][data-pin="2"]');
  await expect(moved.getByTestId('design-comment-state')).toHaveText('已改');
  await expect(gone.getByTestId('design-comment-state')).toHaveText('已失效');
  const layer = panel.locator('[data-testid="artifact-region-layer"][data-page="1"]');
  const pin = layer.locator('[data-testid="design-pin"][data-pin="1"]');
  await expect
    .poll(async () => {
      const [pinBox, layerBox] = await Promise.all([pin.boundingBox(), layer.boundingBox()]);
      return pinBox === null || layerBox === null ? 1 : (pinBox.y - layerBox.y) / layerBox.height;
    })
    .toBeLessThan(0.2);
  await expect(layer.locator('[data-testid="design-pin"][data-pin="2"]')).toHaveCount(0);
  const pageBox = await layer.boundingBox();
  if (pageBox === null) throw new Error('no page');
  await gone.getByTestId('design-comment-retarget').click();
  await page.mouse.move(pageBox.x + pageBox.width * 0.05, pageBox.y + pageBox.height * 0.03);
  await page.mouse.down();
  await page.mouse.move(pageBox.x + pageBox.width * 0.9, pageBox.y + pageBox.height * 0.14, {
    steps: 4,
  });
  await page.mouse.up();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.comments.find((c) => c.id === 'cmt-2')?.text).toBe('Ada Lovelace, analyst');
});
