import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const BOARD_TASK = { ...TASK, id: 'todo-b', title: '画一张流程图', phase: 'done', seqNum: 14 };

function onePagePdf(line: string): Buffer {
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

const SCENE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    {
      id: 'box-1',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 240,
      height: 120,
      angle: 0,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    },
  ],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
});

const FILES: Record<string, { type: string; body: string | Buffer }> = {
  'att-sheet': { type: 'text/csv', body: '姓名,城市,分数\nAda,London,98\nGrace,"New York, NY",95\n' },
  'att-resume': { type: 'application/pdf', body: onePagePdf('Ada Lovelace, analyst') },
  'att-flow': { type: 'text/plain', body: 'flowchart LR\n  A[需求] --> B[设计] --> C[上线]\n' },
  'att-board': { type: 'application/json', body: SCENE },
};

async function openArtifact(page: Page, key: string, name: string) {
  const saves: string[] = [];
  const base = `/api/todos/${BOARD_TASK.id}/design`;
  const current = {
    id: 'ver-1',
    todoId: BOARD_TASK.id,
    fileName: 'flow.excalidraw',
    seq: 1,
    attachmentId: 'att-board',
    sizeBytes: SCENE.length,
    source: 'agent',
    restoredFromSeq: null,
    createdAt: Date.now() - 60_000,
  };
  await mockLive(page, { threads: [THREAD], messages: [], todos: [BOARD_TASK] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/attachments/att-board/artifact')
      return json({
        todoId: BOARD_TASK.id,
        fileName: 'flow.excalidraw',
        kind: 'whiteboard',
        versionId: 'ver-1',
        versionSeq: 1,
        versionCount: 1,
        openComments: 0,
      });
    if (path === `/api/todos/${BOARD_TASK.id}`) return json(BOARD_TASK);
    if (path === base)
      return json({
        pages: [{ fileName: 'flow.excalidraw', current, versionCount: 1, openComments: 0, shareToken: null }],
        shareOrigin: null,
      });
    if (path === `${base}/flow.excalidraw/versions` && method === 'POST') {
      saves.push((route.request().postDataJSON() as { content: string }).content);
      return json({ ...current, id: 'ver-2', seq: 2, source: 'user' }, 201);
    }
    if (path === `${base}/flow.excalidraw/versions`) return json([current]);
    if (path === `${base}/flow.excalidraw/comments`) return json([]);
    const id = /^\/api\/attachments\/([^/]+)$/.exec(path)?.[1];
    const file = id === undefined ? undefined : FILES[id];
    if (file !== undefined) return route.fulfill({ status: 200, contentType: file.type, body: file.body });
    return undefined;
  });
  await page.goto(`/app?artifact=${encodeURIComponent(key)}&artifactName=${encodeURIComponent(name)}`);
  return { panel: page.getByTestId('artifact-panel'), saves };
}

test('a CSV opens as a table with lettered cells and its source one toggle away', async ({ page }) => {
  const { panel } = await openArtifact(page, 'att-sheet.csv', 'scores.csv');
  const sheet = panel.getByTestId('artifact-sheet');
  await expect(sheet.locator('th')).toHaveText(['姓名', '城市', '分数']);
  await expect(sheet.locator('[data-cell="B3"]')).toHaveText('New York, NY');
  await expect(sheet.locator('tbody tr')).toHaveCount(2);
  await panel.getByTestId('artifact-mode-source').click();
  await expect(panel.getByTestId('file-preview-text')).toContainText('Grace,"New York, NY",95');
  await expect(sheet).toHaveCount(0);
});

test('a PDF renders its pages with selectable text and zooms from fit to a set percentage', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { panel } = await openArtifact(page, 'att-resume.pdf', 'resume.pdf');
  const pages = panel.getByTestId('artifact-pdf-page');
  await expect(pages).toHaveCount(1);
  await expect(pages.first().locator('.textLayer')).toContainText('Ada Lovelace, analyst');
  const fit = panel.getByTestId('artifact-zoom-fit');
  await expect(fit).toHaveText('适应');
  const fitWidth = (await pages.first().boundingBox())?.width ?? 0;
  await panel.getByTestId('artifact-zoom-in').click();
  await expect(fit).toHaveText(/^\d+%$/);
  await expect.poll(async () => (await pages.first().boundingBox())?.width ?? 0).toBeGreaterThan(fitWidth);
  await fit.click();
  await expect(fit).toHaveText('适应');
});

test('a Mermaid file draws its diagram and keeps the source one toggle away', async ({ page }) => {
  const { panel } = await openArtifact(page, 'att-flow.mmd', 'flow.mmd');
  const diagram = panel.getByTestId('artifact-diagram');
  await expect(diagram).toHaveAttribute('data-state', 'drawn');
  await expect(diagram.locator('svg').first()).toBeVisible();
  await expect(diagram).toContainText('设计');
  await panel.getByTestId('artifact-mode-source').click();
  await expect(panel.getByTestId('file-preview-text')).toContainText('flowchart LR');
});

test('a whiteboard opens read-only, edits in place and saves a new version', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { panel, saves } = await openArtifact(page, 'att-board.excalidraw', 'flow.excalidraw');
  const board = panel.getByTestId('artifact-whiteboard');
  await expect(board.locator('canvas').first()).toBeVisible();
  await expect(board).not.toHaveAttribute('data-editing');
  const edit = panel.getByTestId('artifact-whiteboard-edit');
  await expect(edit).toHaveText('编辑');
  await edit.click();
  await expect(board).toHaveAttribute('data-editing', 'true');
  await expect(edit).toHaveText('保存');
  await edit.click();
  await expect(edit).toHaveText('编辑');
  expect(saves).toHaveLength(1);
  const saved = JSON.parse(saves[0] ?? '{}') as { type?: string; elements?: { id: string }[] };
  expect(saved.type).toBe('excalidraw');
  expect(saved.elements?.map((element) => element.id)).toEqual(['box-1']);
});
