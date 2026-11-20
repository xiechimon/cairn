import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const PAGE_TASK = { ...TASK, id: 'todo-p', title: '做一个定价页', phase: 'done', seqNum: 12 };

const HTML: Record<string, string> = {
  'ver-1':
    '<!doctype html><html><body><h1 data-od-id="title">Simple pricing</h1><button>升级到 Pro</button></body></html>',
  'ver-2':
    '<!doctype html><html><body><h1 data-od-id="title">随你一起长大的定价</h1><p>一个工作区</p><button>升级到 Pro</button></body></html>',
};

interface Version {
  id: string;
  todoId: string;
  fileName: string;
  seq: number;
  attachmentId: string;
  sizeBytes: number;
  source: 'agent' | 'restore';
  restoredFromSeq: number | null;
  createdAt: number;
}

function version(seq: number, over: Partial<Version> = {}): Version {
  return {
    id: `ver-${seq}`,
    todoId: PAGE_TASK.id,
    fileName: 'pricing.html',
    seq,
    attachmentId: `att-${seq}`,
    sizeBytes: 900,
    source: 'agent',
    restoredFromSeq: null,
    createdAt: Date.now() - (5 - seq) * 60_000,
    ...over,
  };
}

async function openDesign(page: Page) {
  const state = { versions: [version(1), version(2)], restored: [] as string[] };
  await mockLive(page, { threads: [THREAD], messages: [], todos: [PAGE_TASK] }, (path, route, json) => {
    const method = route.request().method();
    if (path === `/api/todos/${PAGE_TASK.id}`) return json(PAGE_TASK);
    if (path === `/api/todos/${PAGE_TASK.id}/design`) {
      const current = state.versions[state.versions.length - 1];
      return json({
        pages: [
          {
            fileName: 'pricing.html',
            current,
            versionCount: state.versions.length,
            openComments: 0,
            shareToken: null,
          },
        ],
        shareOrigin: null,
      });
    }
    if (path === `/api/todos/${PAGE_TASK.id}/design/pricing.html/versions`) return json(state.versions);
    const restore = /\/design\/versions\/(ver-\d+)\/restore$/.exec(path)?.[1];
    if (restore !== undefined && method === 'POST') {
      const from = state.versions.find((v) => v.id === restore);
      const next = version(state.versions.length + 1, {
        source: 'restore',
        restoredFromSeq: from?.seq ?? null,
        attachmentId: from?.attachmentId ?? '',
      });
      HTML[next.id] = HTML[restore] ?? '';
      state.versions = [...state.versions, next];
      state.restored.push(restore);
      return json(next, 201);
    }
    const pageId = /^\/api\/design\/versions\/([^/]+)\/page$/.exec(path)?.[1];
    if (pageId !== undefined) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: HTML[pageId] ?? '' });
    }
    return undefined;
  });
  await page.goto(`/app?view=design&thread=${PAGE_TASK.id}&file=pricing.html`);
  return state;
}

test('the design view runs the page in a sandboxed frame beside the Coordinator, fits each viewport, and switches and restores versions', async ({
  page,
}) => {
  const state = await openDesign(page);
  const pane = page.getByTestId('design-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('home-c')).toBeVisible();
  const frame = pane.getByTestId('design-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-downloads');
  await expect(frame.contentFrame().getByRole('heading', { name: '随你一起长大的定价' })).toBeVisible();
  await expect(pane.getByTestId('design-version-meta')).toHaveText('v2 · 当前');
  expect(await frame.getAttribute('srcdoc')).toContain('data-od-sandbox-shim');

  await pane.getByTestId('design-viewport-mobile').click();
  const stage = pane.getByTestId('design-stage');
  await expect(pane.getByTestId('design-canvas')).toHaveAttribute('data-viewport', 'mobile');
  const mobile = await stage.boundingBox();
  expect(mobile?.width).toBeLessThanOrEqual(390);
  expect(mobile?.height).toBeLessThanOrEqual(844);
  expect(Math.abs((mobile?.width ?? 0) / (mobile?.height ?? 1) - 390 / 844)).toBeLessThan(0.01);
  await pane.getByTestId('design-viewport-tablet').click();
  const tablet = await stage.boundingBox();
  const canvas = await pane.getByTestId('design-canvas').boundingBox();
  expect(tablet?.height).toBeLessThanOrEqual((canvas?.height ?? 0) - 48 + 1);
  expect(Math.abs((tablet?.width ?? 0) / (tablet?.height ?? 1) - 820 / 1180)).toBeLessThan(0.01);
  await pane.getByTestId('design-viewport-desktop').click();

  await pane.getByTestId('design-versions').click();
  await page.getByTestId('design-version-item').filter({ hasText: 'v1' }).click();
  await expect(pane.getByTestId('design-version-banner')).toContainText('正在看 v1');
  await expect(frame.contentFrame().getByRole('heading', { name: 'Simple pricing' })).toBeVisible();
  await pane.getByTestId('design-version-current').click();
  await expect(pane.getByTestId('design-version-banner')).toHaveCount(0);
  await expect(frame.contentFrame().getByRole('heading', { name: '随你一起长大的定价' })).toBeVisible();

  await pane.getByTestId('design-versions').click();
  await page.getByTestId('design-version-item').filter({ hasText: 'v1' }).click();
  await pane.getByTestId('design-version-restore').click();
  await expect(pane.getByTestId('design-version-banner')).toHaveCount(0);
  await expect(pane.getByTestId('design-version-meta')).toHaveText('v3 · 当前');
  expect(state.restored).toEqual(['ver-1']);
  await expect(frame.contentFrame().getByRole('heading', { name: 'Simple pricing' })).toBeVisible();
  await pane.getByTestId('design-versions').click();
  await expect(page.getByTestId('design-version-item').first()).toContainText('从 v1 恢复 · 当前');
  await page.keyboard.press('Escape');

  await pane.getByTestId('design-source-toggle').click();
  await expect(pane.getByTestId('design-source')).toContainText('Simple pricing');
  await pane.getByTestId('design-source-toggle').click();

  await pane.getByTestId('design-more').click();
  await expect(page.getByTestId('design-open-browser')).toHaveAttribute(
    'href',
    '/api/design/versions/ver-3/page',
  );
  await expect(page.getByTestId('design-open-browser')).toHaveAttribute('target', '_blank');
  await page.keyboard.press('Escape');

  await pane.getByTestId('design-close').click();
  await expect(pane).toHaveCount(0);
  await expect(page).not.toHaveURL(/view=design/);
});

test('below 1100px the design view is one pane with a chat and design switch', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openDesign(page);
  const pane = page.getByTestId('design-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('home-c')).toBeHidden();
  await pane.getByTestId('design-focus-chat').click();
  await expect(pane).toBeHidden();
  await expect(page.getByTestId('home-c')).toBeVisible();
  await page.getByTestId('design-chat-bar').getByTestId('design-focus-design').click();
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId('design-frame').contentFrame().getByRole('heading')).toHaveText(
    '随你一起长大的定价',
  );
});
