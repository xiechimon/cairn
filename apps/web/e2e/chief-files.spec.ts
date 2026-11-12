import { expect, type Page, test } from '@playwright/test';

const TEXT_DEEP_LINK =
  '/app?scenario=chief-files&pane=file&file=team-files/att-test-txt.txt&fileName=test.txt';

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

test('a sent attachment is a 122px card above the bubble that opens the file panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/app?scenario=chief-files');
  const card = page.getByTestId('chief-sent-attachment');
  await expect(card).toBeVisible();
  await expect(card).toContainText('test.txt');
  await expect(card).toContainText('TXT');
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
  const panel = page.getByTestId('file-preview-panel');
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/pane=file/);
  await expect(panel.getByTestId('file-preview-name')).toHaveText('test.txt');
  const lines = panel.getByTestId('file-preview-text').locator('[data-slot="file-line"]');
  await expect(lines).toHaveCount(1);
  await expect(panel.getByTestId('file-preview-text')).toContainText('1');
  await expect(page.getByTestId('tasks-toggle')).toHaveAttribute('aria-pressed', 'false');

  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/pane=file/);
});

test('the file panel deep-links, copies the text, downloads with the name and closes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(
    '/app?scenario=chief-files-long&pane=file&file=team-files/att-verify-log.log&fileName=verify-3877.log',
  );
  const panel = page.getByTestId('file-preview-panel');
  await expect(panel).toBeVisible();
  const viewer = panel.getByTestId('file-preview-text');
  await expect(viewer.locator('[data-slot="file-line"]')).toHaveCount(240);
  await expect(viewer).toContainText('expected 112, received 122');
  const box = await viewer.boundingBox();
  const panelBox = await panel.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (panelBox?.x ?? 0) + (panelBox?.width ?? 0),
  );

  const copy = panel.getByRole('button', { name: '复制' });
  await copy.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制');
  await copy.click();
  await expect(panel.getByRole('button', { name: '已复制' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split('\n')).toHaveLength(240);

  const download = panel.getByRole('link', { name: '下载' });
  await expect(download).toHaveAttribute('download', 'verify-3877.log');

  await panel.getByRole('button', { name: '关闭' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/fileName=/);
});

test('the file panel shows images fitted and a quiet download state for other types', async ({
  page,
}) => {
  await page.goto(
    '/app?scenario=chief-files-image&pane=file&file=team-files/att-home-shot.png&fileName=首页设计稿.png',
  );
  const panel = page.getByTestId('file-preview-panel');
  const image = panel.getByTestId('file-preview-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(960);
  const imageBox = await image.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(imageBox?.width ?? 0).toBeLessThanOrEqual(panelBox?.width ?? 0);
  await expect(panel.getByRole('button', { name: '复制' })).toBeDisabled();

  await page.goto(
    '/app?scenario=chief-files-unsupported&pane=file&file=team-files/att-office.xlsx&fileName=汇总.xlsx',
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
    '/app?scenario=chief-files&pane=file&file=team-files/att-missing.txt&fileName=missing.txt',
  );
  const panel = page.getByTestId('file-preview-panel');
  await expect(panel.getByTestId('query-error')).toContainText('文件没能加载');
  await expect(panel.getByRole('button', { name: '重试' })).toBeVisible();
});

test('opening the file panel hides the sidebar like the other panels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(TEXT_DEEP_LINK);
  await expect(page.getByTestId('file-preview-panel')).toBeVisible();
  await expect(page.getByTestId('side-panel-resize')).toBeAttached();
  await expect(page.locator('.board-sidebar')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-reopen')).toBeVisible();
  await page.getByTestId('file-preview-panel').getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.board-sidebar')).toBeVisible();
  await expect(page.locator('.board-sidebar--collapsed')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-reopen')).toHaveCount(0);
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
  await expect(tile).toContainText('XLSX');
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
  await expect(uploading).not.toContainText('XLSX');
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

test('the file panel fills the phone screen inside the existing panel mechanism', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TEXT_DEEP_LINK);
  const panel = page.getByTestId('file-preview-panel');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width ?? 0).toBeCloseTo(390, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await panel.getByRole('button', { name: '关闭' }).click();
  await expect(panel).toHaveCount(0);
});
