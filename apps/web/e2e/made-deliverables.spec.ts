import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const PAGE_HTML =
  '<!doctype html><html><body><h1>Export benchmark</h1><p>Parquet halves CSV.</p><img src="https://tracker.example/pixel.png" alt=""></body></html>';
const SCRIPTED_HTML = '<html><body><h1>Live board</h1><script>document.title="ran"</script></body></html>';
const HIDDEN_SCRIPTS: Record<string, string> = {
  'att-handler': '<h1>Chart</h1><svg onload="document.title=1"></svg>',
  'att-jsurl': '<h1>Links</h1><a href="java&#x73;cript&colon;void(document.title=1)">go</a>',
  'att-noscript': '<noscript><p title="</noscript><img src=x onerror=document.title=1>">',
};
const DECK_BYTES = 3_250_586;
const COSTLY_HTML = `<!doctype html><html><head><style>i{display:inline-block;width:6px;height:6px;margin:1px;border-radius:3px;background:#c87533;filter:blur(1px);box-shadow:0 0 8px 2px #0006;animation:p 1s infinite alternate}i:nth-child(3n){animation-delay:.3s}@keyframes p{to{transform:scale(1.6) rotate(45deg);opacity:.3}}</style></head><body><h1>Costly benchmark</h1>${'<i></i>'.repeat(30_000)}</body></html>`;
const THUMB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const page0 = { chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null };

function research(id: string, seqNum: number, title: string, deliverables?: unknown) {
  return {
    ...TASK,
    id,
    seqNum,
    title,
    phase: 'done',
    output: 'info',
    latestBuildId: `build-${id}`,
    ...(deliverables === undefined ? {} : { deliverables }),
  };
}

function reportOf(id: string, text: string) {
  return {
    id: `info-report-build-${id}`,
    role: 'system',
    createdAt: 30,
    content: JSON.stringify({
      kind: 'info-report',
      attachmentId: `att-report-${id}`,
      attachmentToken: `![report.md](attachment:t1/att-report-${id}.md)`,
      content: text,
    }),
  };
}

const RESULTS = [
  research('doc', 10, 'Research export formats'),
  research('page', 11, 'Export benchmark page', {
    items: [{ attachmentId: 'att-page', kind: 'page', name: 'benchmark.html', sizeBytes: 2048 }],
    skipped: [{ name: 'demo.mp4', reason: 'too-large' }],
  }),
  research('scripted', 12, 'Live export board', {
    items: [{ attachmentId: 'att-scripted', kind: 'page', name: 'board.html', sizeBytes: 900 }],
    skipped: [],
  }),
  research('handler', 15, 'Handler chart page', {
    items: [{ attachmentId: 'att-handler', kind: 'page', name: 'chart.html', sizeBytes: 600 }],
    skipped: [],
  }),
  research('jsurl', 16, 'Link list page', {
    items: [{ attachmentId: 'att-jsurl', kind: 'page', name: 'links.html', sizeBytes: 600 }],
    skipped: [],
  }),
  research('noscript', 17, 'Fallback note page', {
    items: [{ attachmentId: 'att-noscript', kind: 'page', name: 'fallback.html', sizeBytes: 600 }],
    skipped: [],
  }),
  research('large', 14, 'Large export table', {
    items: [{ attachmentId: 'att-large', kind: 'page', name: 'table.html', sizeBytes: 300 * 1024 }],
    skipped: [],
  }),
  research('costly', 18, 'Costly benchmark page', {
    items: [
      { attachmentId: 'att-costly', kind: 'page', name: 'costly.html', sizeBytes: COSTLY_HTML.length },
    ],
    skipped: [],
  }),
  research('deck', 13, 'Export review deck', {
    items: [
      { attachmentId: 'att-deck', kind: 'slides', name: 'review.pptx', sizeBytes: DECK_BYTES },
      { attachmentId: 'att-appendix', kind: 'page', name: 'appendix.html', sizeBytes: 2048 },
    ],
    skipped: [],
  }),
];

async function openMade(page: Page, captured: readonly string[] = ['att-page', 'att-costly']) {
  const tracker: string[] = [];
  const fetched: string[] = [];
  const thumbs: string[] = [];
  await page.route('https://tracker.example/**', (route) => {
    tracker.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await mockLive(page, { threads: [THREAD], messages: [], todos: RESULTS }, (path, route, json) => {
    const conversation = /^\/api\/conversations\/build-([^/]+)\/messages$/.exec(path)?.[1];
    if (conversation !== undefined) {
      return json({ messages: [reportOf(conversation, `## ${conversation}\n\nOpening line of ${conversation}.`)], ...page0 });
    }
    const thumb = /^\/api\/attachments\/(att-[a-z]+)\/thumbnail$/.exec(path)?.[1];
    if (thumb !== undefined) {
      thumbs.push(thumb);
      return captured.includes(thumb)
        ? route.fulfill({ status: 200, contentType: 'image/png', body: THUMB_PNG })
        : json({ error: 'no thumbnail' }, 404);
    }
    const attachment = /^\/api\/attachments\/(att-[a-z]+)$/.exec(path)?.[1];
    if (attachment === undefined) return undefined;
    fetched.push(attachment);
    const body =
      attachment === 'att-scripted'
        ? SCRIPTED_HTML
        : attachment === 'att-costly'
          ? COSTLY_HTML
          : (HIDDEN_SCRIPTS[attachment] ?? PAGE_HTML);
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  await page.goto('/app?pane=made');
  return { made: page.getByRole('complementary', { name: '成果' }), tracker, fetched, thumbs };
}

test('Made groups pages and decks, previews a script-free page and never a scripted one', async ({
  page,
}) => {
  const { made, tracker, fetched, thumbs } = await openMade(page);
  await expect(made.getByTestId('made-group').locator('h3')).toHaveText(['文档1', '网页7', 'PPT1']);

  const pageCard = made.getByTestId('made-card').filter({ hasText: 'Export benchmark page' });
  await expect(pageCard.getByTestId('made-card-thumb').locator('img')).toHaveAttribute(
    'src',
    '/api/attachments/att-page/thumbnail',
  );

  const scriptedCard = made.getByTestId('made-card').filter({ hasText: 'Live export board' });
  await expect(scriptedCard.getByTestId('made-card-excerpt')).toHaveText('Opening line of scripted.');
  await expect(scriptedCard.getByTestId('made-card-thumb')).toHaveCount(0);

  const largeCard = made.getByTestId('made-card').filter({ hasText: 'Large export table' });
  await largeCard.scrollIntoViewIfNeeded();
  await expect(largeCard.getByTestId('made-card-excerpt')).toHaveText('Opening line of large.');
  await expect(largeCard.getByTestId('made-card-thumb')).toHaveCount(0);
  expect(fetched).not.toContain('att-large');

  const deckCard = made.getByTestId('made-card').filter({ hasText: 'Export review deck' });
  await expect(deckCard.getByTestId('made-card-meta')).toHaveText(/^3\.1 MB · /);
  await expect(deckCard.getByTestId('made-card-excerpt')).toHaveText('Opening line of deck.');
  await expect(deckCard.getByTestId('made-card-thumb')).toHaveCount(0);
  await expect(made.locator('iframe')).toHaveCount(0);
  expect(thumbs).not.toContain('att-scripted');
  expect(tracker).toEqual([]);
});

test('a page that is costly to render shows its captured image on the card, never a live frame', async ({
  page,
}) => {
  const { made } = await openMade(page);
  const card = made.getByTestId('made-card').filter({ hasText: 'Costly benchmark page' });
  await card.scrollIntoViewIfNeeded();
  const image = card.getByTestId('made-card-thumb').locator('img');
  await expect(image).toHaveAttribute('src', '/api/attachments/att-costly/thumbnail');
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(made.locator('iframe')).toHaveCount(0);
});

test('a page with no captured image falls back to the report lines on its card', async ({ page }) => {
  const { made, thumbs } = await openMade(page, []);
  const card = made.getByTestId('made-card').filter({ hasText: 'Export benchmark page' });
  await expect(card.getByTestId('made-card-excerpt')).toHaveText('Opening line of page.');
  await expect(card.getByTestId('made-card-thumb')).toHaveCount(0);
  expect(thumbs).toContain('att-page');
  await expect(made.locator('iframe')).toHaveCount(0);
});

test('the dialog lists each file with open and download above the report, explains skipped files, and opens a page in the artifact panel', async ({
  page,
}) => {
  const { made, tracker } = await openMade(page);

  await made.getByRole('button', { name: 'Export benchmark page' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export benchmark page' });
  await expect(dialog.getByTestId('research-report-meta')).toHaveText(/^网页\s*·\s*定稿/);
  const files = dialog.getByTestId('made-files');
  await expect(files.getByTestId('made-file')).toHaveText([/^benchmark\.html网页 · 2 KB打开下载$/]);
  const download = files.getByRole('link', { name: '下载 benchmark.html' });
  await expect(download).toHaveAttribute('href', '/api/attachments/att-page?download=1');
  await expect(download).toHaveAttribute('download', 'benchmark.html');
  await expect(files.locator('iframe')).toHaveCount(0);
  await expect(dialog.getByTestId('made-skipped')).toHaveText('未收录 1 个文件：demo.mp4（文件太大）');
  const filesBox = await files.boundingBox();
  const docBox = await page.getByTestId('research-report-doc').boundingBox();
  expect(filesBox!.y + filesBox!.height).toBeLessThan(docBox!.y);
  await files.getByRole('button', { name: '打开 benchmark.html' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/artifact=att-page\.html/);
  await expect(page).toHaveURL(/artifactName=benchmark\.html/);
  await expect(page.getByTestId('artifact-panel')).toBeVisible();
  await expect(page.locator('[data-testid="artifact-tab"][data-active]')).toHaveText('benchmark.html');
  await page.goBack();
  await expect(page.getByTestId('artifact-panel')).toHaveCount(0);

  await page.getByRole('complementary', { name: '成果' }).getByRole('button', { name: 'Export review deck' }).click();
  const deckDialog = page.getByRole('dialog', { name: 'Export review deck' });
  await expect(deckDialog.getByTestId('research-report-meta')).toHaveText(/^PPT\s*·\s*定稿/);
  const deck = deckDialog.getByTestId('made-files');
  await expect(deck.getByTestId('made-file')).toHaveText([
    /^review\.pptxPPT · 3\.1 MB · 下载后打开下载$/,
    /^appendix\.html网页 · 2 KB打开下载$/,
  ]);
  await expect(deck.getByTestId('made-skipped')).toHaveCount(0);
  expect(tracker).toEqual([]);
});

test('a page with a script tag, handler, script URL or noscript gets no preview on its card', async ({
  page,
}) => {
  const { made } = await openMade(page);

  for (const title of ['Live export board', 'Handler chart page', 'Link list page', 'Fallback note page']) {
    const card = made.getByTestId('made-card').filter({ hasText: title });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId('made-card-thumb')).toHaveCount(0);
  }
});
