import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const PAGE_HTML =
  '<!doctype html><html><body><h1>Export benchmark</h1><p>Parquet halves CSV.</p><img src="https://tracker.example/pixel.png" alt=""></body></html>';
const SCRIPTED_HTML = '<html><body><h1>Live board</h1><script>document.title="ran"</script></body></html>';
const DECK_BYTES = 3_250_586;

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
  research('deck', 13, 'Export review deck', {
    items: [
      { attachmentId: 'att-deck', kind: 'slides', name: 'review.pptx', sizeBytes: DECK_BYTES },
      { attachmentId: 'att-appendix', kind: 'page', name: 'appendix.html', sizeBytes: 2048 },
    ],
    skipped: [],
  }),
];

async function openMade(page: Page) {
  const tracker: string[] = [];
  await page.route('https://tracker.example/**', (route) => {
    tracker.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await mockLive(page, { threads: [THREAD], messages: [], todos: RESULTS }, (path, route, json) => {
    const conversation = /^\/api\/conversations\/build-([^/]+)\/messages$/.exec(path)?.[1];
    if (conversation !== undefined) {
      return json({ messages: [reportOf(conversation, `## ${conversation}\n\nOpening line of ${conversation}.`)], ...page0 });
    }
    const attachment = /^\/api\/attachments\/(att-[a-z]+)$/.exec(path)?.[1];
    if (attachment === undefined) return undefined;
    const body = attachment === 'att-scripted' ? SCRIPTED_HTML : PAGE_HTML;
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  await page.goto('/app?pane=made');
  return { made: page.getByRole('complementary', { name: '成果' }), tracker };
}

test('Made groups pages and decks, previews a script-free page and never a scripted one', async ({
  page,
}) => {
  const { made, tracker } = await openMade(page);
  await expect(made.getByTestId('made-group').locator('h3')).toHaveText(['文档1', '网页2', 'PPT1']);

  const pageCard = made.getByTestId('made-card').filter({ hasText: 'Export benchmark page' });
  const thumb = pageCard.getByTestId('made-page-frame');
  await expect(thumb).toHaveAttribute('sandbox', '');
  await expect(thumb).toHaveAttribute('tabindex', '-1');
  expect(await thumb.getAttribute('srcdoc')).toMatch(
    /^<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*img-src data: blob:;/,
  );

  const scriptedCard = made.getByTestId('made-card').filter({ hasText: 'Live export board' });
  await expect(scriptedCard.getByTestId('made-card-excerpt')).toHaveText('Opening line of scripted.');
  await expect(scriptedCard.getByTestId('made-page-frame')).toHaveCount(0);

  const deckCard = made.getByTestId('made-card').filter({ hasText: 'Export review deck' });
  await expect(deckCard.getByTestId('made-card-meta')).toHaveText(/^3\.1 MB · /);
  await expect(deckCard.getByTestId('made-card-excerpt')).toHaveText('Opening line of deck.');
  await expect(deckCard.getByTestId('made-page-frame')).toHaveCount(0);
  expect(tracker).toEqual([]);
});

test('the dialog lists each file with a download above the report and explains skipped files', async ({
  page,
}) => {
  const { made, tracker } = await openMade(page);

  await made.getByRole('button', { name: 'Export benchmark page' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export benchmark page' });
  const files = dialog.getByTestId('made-files');
  await expect(files.getByTestId('made-file')).toHaveText([/^benchmark\.html网页 · 2 KB · 预览不运行脚本下载$/]);
  const download = files.getByRole('link', { name: '下载 benchmark.html' });
  await expect(download).toHaveAttribute('href', '/api/attachments/att-page?download=1');
  await expect(download).toHaveAttribute('download', 'benchmark.html');
  const preview = files.getByTestId('made-page-frame');
  await expect(preview).toHaveAttribute('sandbox', '');
  await expect(preview.contentFrame().getByRole('heading', { name: 'Export benchmark' })).toBeVisible();
  await expect(dialog.getByTestId('made-skipped')).toHaveText('未收录 1 个文件：demo.mp4（文件太大）');
  const filesBox = await files.boundingBox();
  const docBox = await page.getByTestId('research-report-doc').boundingBox();
  expect(filesBox!.y + filesBox!.height).toBeLessThan(docBox!.y);
  await page.keyboard.press('Escape');

  await made.getByRole('button', { name: 'Live export board' }).click();
  const scripted = page.getByRole('dialog', { name: 'Live export board' }).getByTestId('made-files');
  await expect(scripted.getByTestId('made-file')).toContainText('含脚本，下载后打开');
  await expect(scripted.getByTestId('made-page-frame')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await made.getByRole('button', { name: 'Export review deck' }).click();
  const deck = page.getByRole('dialog', { name: 'Export review deck' }).getByTestId('made-files');
  await expect(deck.getByTestId('made-file')).toHaveText([
    /^review\.pptxPPT · 3\.1 MB · 下载后打开下载$/,
    /^appendix\.html网页 · 2 KB · 预览不运行脚本下载$/,
  ]);
  await expect(deck.getByTestId('made-page-frame')).toHaveCount(1);
  await expect(deck.getByTestId('made-skipped')).toHaveCount(0);
  expect(tracker).toEqual([]);
});
