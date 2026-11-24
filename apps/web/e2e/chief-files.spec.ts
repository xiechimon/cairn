import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, THREAD } from './chief-home-mock';

const TEXT_DEEP_LINK =
  '/app?scenario=chief-files&artifact=team-files/att-test-txt.txt&artifactName=test.txt';

async function dropFiles(page: Page, selector: string, files: { name: string; type: string; body: string }[]) {
  await page.evaluate(
    ({ selector, files }) => {
      const target = document.querySelector(selector);
      if (target === null) throw new Error(`no drop target: ${selector}`);
      const data = new DataTransfer();
      for (const file of files) data.items.add(new File([file.body], file.name, { type: file.type }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }),
        );
      }
    },
    { selector, files },
  );
}

test('a sent attachment is a 122px card with its type icon that opens the artifact panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/app?scenario=chief-files');
  const card = page.getByTestId('chief-sent-attachment');
  await expect(card).toBeVisible();
  await expect(card).toContainText('test.txt');
  await expect(card.locator('[data-file-icon="text"]').first()).toBeVisible();
  await expect(card.getByTestId('attachment-tile-preview')).toHaveCount(0);
  const cardBox = await card.boundingBox();
  expect(cardBox?.width).toBe(122);
  expect(cardBox?.height).toBe(122);
  const column = card.locator('xpath=ancestor::*[@data-testid="chief-msg-col"]');
  const bubble = column.getByTestId('chief-bubble');
  await expect(bubble).toHaveText('查看内容');
  await expect(bubble).not.toContainText('attachment:');
  const bubbleBox = await bubble.boundingBox();
  expect(bubbleBox?.y ?? 0).toBeGreaterThan((cardBox?.y ?? 0) + 122);
  expect(Math.abs((bubbleBox?.x ?? 0) + (bubbleBox?.width ?? 0) - (cardBox?.x ?? 0) - 122)).toBeLessThan(1);

  await card.getByRole('button', { name: 'test.txt', exact: true }).click();
  const panel = page.getByTestId('artifact-panel');
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/artifact=team-files/);
  await expect(page).not.toHaveURL(/pane=/);
  await expect(panel.locator('[data-testid="artifact-tab"][data-active]')).toHaveText('test.txt');
  const lines = panel.getByTestId('file-preview-text').locator('[data-slot="file-line"]');
  await expect(lines).toHaveCount(1);
  await expect(panel.getByTestId('file-preview-text')).toContainText('1');
  await expect(panel.getByTestId('artifact-name')).toHaveText('test· TXT');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  await expect(page.getByTestId('tasks-toggle')).toHaveAttribute('aria-pressed', 'false');

  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/artifact=/);
});

test('the artifact panel deep-links, copies the text, downloads with the name and closes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(
    '/app?scenario=chief-files-long&artifact=team-files/att-verify-log.log&artifactName=verify-3877.log',
  );
  const panel = page.getByTestId('artifact-panel');
  await expect(panel).toBeVisible();
  const viewer = panel.getByTestId('file-preview-text');
  await expect(viewer.locator('[data-slot="file-line"]')).toHaveCount(240);
  await expect(viewer).toContainText('expected 112, received 122');
  const box = await viewer.boundingBox();
  const panelBox = await panel.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (panelBox?.x ?? 0) + (panelBox?.width ?? 0),
  );

  const copy = panel.getByTestId('artifact-copy');
  await copy.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制');
  await copy.click();
  await expect(panel.getByRole('button', { name: '已复制' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split('\n')).toHaveLength(240);

  await panel.getByTestId('artifact-name').click();
  await expect(page.getByTestId('artifact-download')).toHaveAttribute('download', 'verify-3877.log');
  await page.keyboard.press('Escape');

  await panel.getByTestId('artifact-close').click();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/artifactName=/);
});

test('a Markdown file renders as a document, the toggle shows the source and copy keeps the source', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(
    '/app?scenario=chief-files-markdown&artifact=team-files/att-release-notes.md&artifactName=release-notes.md',
  );
  const panel = page.getByTestId('artifact-panel');
  const rendered = panel.getByTestId('file-preview-markdown');
  await expect(rendered.getByRole('heading', { name: '发布检查清单', level: 1 })).toBeVisible();
  await expect(rendered.getByRole('heading', { name: '必做', level: 2 })).toBeVisible();
  await expect(rendered.getByTestId('md-list-bullet').getByTestId('md-item-bullet')).toHaveCount(3);
  await expect(rendered.getByTestId('md-table')).toBeVisible();
  await expect(rendered.getByTestId('md-code-block')).toBeVisible();
  const link = rendered.getByRole('link', { name: '发布流程' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(panel.getByTestId('file-preview-text')).toHaveCount(0);
  const box = await rendered.boundingBox();
  const panelBox = await panel.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (panelBox?.x ?? 0) + (panelBox?.width ?? 0),
  );

  await panel.getByTestId('artifact-copy').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('# 发布检查清单');
  expect(copied).toContain('- 跑完 `pnpm prepush`');

  await panel.getByTestId('artifact-mode-source').click();
  await expect(rendered).toHaveCount(0);
  await expect(panel.getByTestId('file-preview-text')).toContainText('# 发布检查清单');
  await panel.getByTestId('artifact-name').click();
  await expect(page.getByTestId('artifact-download')).toHaveAttribute('download', 'release-notes.md');
  await page.keyboard.press('Escape');
  await panel.getByTestId('artifact-mode-preview').click();
  await expect(panel.getByTestId('file-preview-markdown')).toBeVisible();
});

test('a plain text file keeps the line view and has no source toggle', async ({ page }) => {
  await page.goto(TEXT_DEEP_LINK);
  const panel = page.getByTestId('artifact-panel');
  await expect(panel.getByTestId('file-preview-text')).toBeVisible();
  await expect(panel.getByTestId('file-preview-markdown')).toHaveCount(0);
  await expect(panel.getByTestId('artifact-mode-source')).toHaveCount(0);
});

test('the artifact panel shows images fitted and a quiet download state for other types', async ({
  page,
}) => {
  await page.goto(
    '/app?scenario=chief-files-image&artifact=team-files/att-home-shot.png&artifactName=首页设计稿.png',
  );
  const panel = page.getByTestId('artifact-body');
  const image = panel.getByTestId('file-preview-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(960);
  const imageBox = await image.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(imageBox?.width ?? 0).toBeLessThanOrEqual(panelBox?.width ?? 0);
  expect(imageBox?.height ?? 0).toBeLessThanOrEqual(panelBox?.height ?? 0);
  await expect(page.getByTestId('artifact-copy')).toHaveCount(0);

  await page.goto(
    '/app?scenario=chief-files-unsupported&artifact=team-files/att-office.xlsx&artifactName=汇总.xlsx',
  );
  const unsupported = page.getByTestId('file-preview-unsupported');
  await expect(unsupported).toContainText('无法预览，下载查看');
  await expect(unsupported.getByRole('button', { name: '下载' })).toBeVisible();
});

test('a text file that fails to load shows the error state with retry', async ({ page }) => {
  await page.route('**/api/attachments/**', (route) =>
    route.fulfill({ status: 500, body: 'boom' }),
  );
  await page.goto(
    '/app?scenario=chief-files&artifact=team-files/att-missing.txt&artifactName=missing.txt',
  );
  const panel = page.getByTestId('artifact-panel');
  await expect(panel.getByTestId('query-error')).toContainText('文件未能加载');
  await expect(panel.getByRole('button', { name: '重试' })).toBeVisible();
});

test('images, video and documents open as tabs in one artifact panel beside the chat', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const files = [
    ['att-shot', 'png', 'shot.png'],
    ['att-clip', 'mp4', 'clip.mp4'],
    ['att-plan', 'docx', 'plan.docx'],
  ];
  const message = `${files.map(([id, ext, name]) => `![${name}](attachment:team-files/${id}.${ext})`).join('\n')}\n看看`;
  await mockLive(
    page,
    { threads: [THREAD], messages: [...HISTORY, { id: 'm9', role: 'user', content: message, createdAt: 40 }] },
    (path, route) =>
      path === '/api/attachments/att-plan/document-preview'
        ? route.fulfill({
            json: { kind: 'document', title: '第一阶段计划', sections: [{ title: '目标', lines: ['先做桌面端'] }] },
          })
        : path.startsWith('/api/attachments/')
          ? route.fulfill({ status: 404, body: '' })
          : undefined,
  );
  await page.goto('/app');
  const tiles = page.getByTestId('chief-sent-attachment');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(2).locator('[data-file-icon="word"]').first()).toBeVisible();
  await expect(tiles.nth(2).getByTestId('attachment-tile-preview')).toContainText('第一阶段计划');
  await tiles.nth(0).getByRole('button', { name: 'shot.png', exact: true }).click();
  const panel = page.getByTestId('artifact-panel');
  const selected = panel.locator('[data-testid="artifact-tab"][data-active]');
  await expect(selected).toHaveText('shot.png');
  await expect(panel.getByTestId('artifact-body')).toHaveAttribute('data-kind', 'image');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();

  await tiles.nth(1).getByRole('button', { name: 'clip.mp4', exact: true }).click();
  await expect(selected).toHaveText('clip.mp4');
  await expect(panel.getByTestId('artifact-body')).toHaveAttribute('data-kind', 'video');
  await tiles.nth(2).getByRole('button', { name: 'plan.docx', exact: true }).click();
  await expect(selected).toHaveText('plan.docx');
  await expect(panel.getByTestId('file-preview-document')).toContainText('先做桌面端');
  await expect(panel.getByTestId('artifact-tab')).toHaveCount(3);

  await tiles.nth(0).getByRole('button', { name: 'shot.png', exact: true }).click();
  await expect(panel.getByTestId('artifact-tab')).toHaveCount(3);
  await expect(selected).toHaveText('shot.png');
  await panel.getByTestId('artifact-tab').nth(0).getByTestId('artifact-tab-close').click();
  await expect(panel.getByTestId('artifact-tab')).toHaveCount(2);

  await panel.getByTestId('artifact-close').click();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/artifact=/);
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
});


test('composer tiles: 122px, remove tooltip names the file, keyboard removal returns focus', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-files-composer');
  const tile = page.getByTestId('composer-attachments').locator('[data-slot="attachment-tile"]');
  await expect(tile).toHaveCount(1);
  const box = await tile.boundingBox();
  expect(box?.width).toBe(122);
  expect(box?.height).toBe(122);
  await expect(tile.locator('[data-file-icon="excel"]').first()).toBeVisible();
  const remove = tile.getByRole('button', { name: /^移除附件：第一阶段交付/ });
  await expect(remove).toHaveCSS('opacity', '0');
  await tile.hover();
  await remove.hover();
  await expect(remove).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    '移除附件：第一阶段交付-功能清单进度-261029-汇总.xlsx',
  );
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
});

test('composer tiles: uploading pulses without a progress bar and failed keeps a removable tile', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-files-uploading');
  const uploading = page.getByTestId('attachment-pending');
  await expect(uploading).toHaveAttribute('data-state', 'uploading');
  await expect(uploading).toContainText('上传中');
  await expect(uploading).toHaveCSS('animation-name', 'pulse');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(uploading).toHaveCSS('animation-name', 'none');

  await page.goto('/app?scenario=chief-files-failed');
  const failed = page.getByTestId('attachment-pending');
  await expect(failed).toHaveAttribute('data-state', 'error');
  await expect(failed).toContainText('上传失败');
  await failed.hover();
  await failed.getByRole('button', { name: '移除附件：test.txt' }).click();
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0);
});

test('dropping files on the conversation highlights the composer and uploads them', async ({
  page,
}) => {
  await page.route('**/api/uploads/grant', (route) =>
    route.fulfill({
      json: {
        uploadUrl: '/api/uploads',
        grant: 'grant-1',
        key: 'team-files/att-drop.txt',
        attachmentId: 'att-drop',
      },
    }),
  );
  await page.route('**/api/uploads/upload', (route) =>
    route.fulfill({ status: 201, json: { id: 'att-drop', key: 'team-files/att-drop.txt' } }),
  );
  await page.goto('/app?scenario=chief-files');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();

  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="chief-body"]');
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    target?.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true }));
  });
  await expect(page.locator('[data-drop-target]')).toHaveCount(1);
  await expect(page.getByTestId('chief-composer-placeholder')).toHaveText('松开即可添加附件');

  await dropFiles(page, '[data-testid="chief-body"]', [
    { name: 'notes.txt', type: 'text/plain', body: 'hello' },
  ]);
  await expect(page.locator('[data-drop-target]')).toHaveCount(0);
  const tile = page.getByTestId('composer-attachments').locator('[data-state="ready"]');
  await expect(tile).toContainText('notes.txt');
});

test('a failed drop upload leaves an error tile and a toast, and keeps the draft', async ({
  page,
}) => {
  await page.route('**/api/uploads/grant', (route) =>
    route.fulfill({ status: 500, json: { error: 'boom' } }),
  );
  await page.goto('/app?scenario=chief-files');
  const input = page.getByTestId('chief-composer-input');
  await input.fill('这段话要留着');
  await dropFiles(page, '[data-testid="chief-composer-block"]', [
    { name: 'notes.txt', type: 'text/plain', body: 'hello' },
  ]);
  await expect(page.locator('[data-sonner-toast]')).toContainText('附件上传失败');
  await expect(page.getByTestId('attachment-pending')).toHaveAttribute('data-state', 'error');
  await expect(input).toHaveValue('这段话要留着');
});

test('the artifact panel fills the phone screen and switches to the chat', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TEXT_DEEP_LINK);
  const panel = page.getByTestId('artifact-panel');
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByTestId('chief-composer-input')).toBeHidden();
  await page.getByTestId('artifact-focus-chat').click();
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  await page.getByTestId('artifact-focus-artifact').click();
  await panel.getByTestId('artifact-close').click();
  await expect(panel).toHaveCount(0);
});

test('a live file downloads through the endpoint that names the file', async ({ page }) => {
  await mockLive(page, { threads: [], messages: HISTORY }, (path, route) =>
    path === '/api/attachments/att-notes'
      ? route.fulfill({ contentType: 'text/plain', body: 'one\ntwo\n' })
      : undefined,
  );
  await page.goto('/app?artifact=team-files/att-notes.log&artifactName=notes.log');
  const panel = page.getByTestId('artifact-panel');
  await expect(panel.getByTestId('file-preview-text').locator('[data-slot="file-line"]')).toHaveCount(2);
  await panel.getByTestId('artifact-name').click();
  const download = page.getByTestId('artifact-download');
  await expect(download).toHaveAttribute('href', '/api/attachments/att-notes?download=1');
  await expect(download).toHaveAttribute('download', 'notes.log');
});

test('an office file shows its extracted text, and one the server cannot read offers the download', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: HISTORY }, (path, route) =>
    path === '/api/attachments/att-plan/document-preview'
      ? route.fulfill({
          json: {
            kind: 'document',
            title: '第一阶段计划',
            sections: [{ title: '目标', lines: ['三周内上线定价页', '先做桌面端'] }],
          },
        })
      : path === '/api/attachments/att-broken/document-preview'
        ? route.fulfill({ status: 422, json: { error: 'unreadable' } })
        : undefined,
  );
  await page.goto('/app?artifact=team-files/att-plan.docx&artifactName=计划.docx');
  const panel = page.getByTestId('artifact-panel');
  await expect(panel.getByTestId('artifact-name')).toContainText('DOCX');
  const document = panel.getByTestId('file-preview-document');
  await expect(document.getByRole('heading', { name: '第一阶段计划', level: 2 })).toBeVisible();
  await expect(document.getByRole('heading', { name: '目标', level: 3 })).toBeVisible();
  await expect(document).toContainText('三周内上线定价页');

  await page.goto('/app?artifact=team-files/att-broken.xlsx&artifactName=汇总.xlsx');
  const fallback = page.getByTestId('file-preview-unsupported');
  await expect(fallback).toContainText('无法预览，下载查看');
  await expect(fallback.getByRole('button', { name: '下载' })).toBeVisible();
});
