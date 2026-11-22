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

type Comment = Record<string, unknown> & { id: string; pin: number; status: string };

function lostComment(): Comment {
  return {
    id: 'cmt-lost',
    todoId: PAGE_TASK.id,
    fileName: 'pricing.html',
    versionId: 'ver-1',
    versionSeq: 1,
    pin: 1,
    viewport: 'desktop',
    note: '这一块删掉',
    markAttachmentId: null,
    status: 'sent',
    messageId: 'm-old',
    createdAt: 1,
    updatedAt: 1,
    elementId: 'promo',
    selector: '[data-od-id="promo"]',
    label: 'section',
    text: '限时优惠',
    htmlHint: '<section data-od-id="promo">',
    position: { x: 10, y: 10, width: 200, height: 40 },
    style: null,
  };
}

async function openDesign(
  page: Page,
  seeded: Comment[] = [],
  shareOrigin: string | null = null,
  html = { ...HTML },
) {
  const state = {
    versions: [version(1), version(2)],
    restored: [] as string[],
    comments: seeded,
    sends: [] as { content: string; designCommentIds?: string[] }[],
    writes: [] as string[],
    marks: [] as Buffer[],
    shareToken: null as string | null,
    shareCalls: [] as string[],
  };
  const mock = { threads: [THREAD], messages: [] as unknown[], todos: [PAGE_TASK] };
  await mockLive(page, mock, (path, route, json) => {
    const method = route.request().method();
    const base = `/api/todos/${PAGE_TASK.id}/design`;
    if (path === `${base}/pricing.html/comments`) return json(state.comments);
    if (path === `${base}/comments` && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const version = state.versions.find((v) => v.id === body.versionId);
      const row: Comment = {
        ...body,
        id: `cmt-${state.comments.length + 1}`,
        todoId: PAGE_TASK.id,
        fileName: 'pricing.html',
        versionSeq: version?.seq ?? 0,
        pin: Math.max(0, ...state.comments.map((c) => c.pin)) + 1,
        markAttachmentId: body.markAttachmentId ?? null,
        status: 'open',
        messageId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.comments = [...state.comments, row];
      state.writes.push(`create ${row.id}`);
      return json(row, 201);
    }
    if (path === `${base}/pricing.html/share`) {
      state.shareCalls.push(method);
      if (method === 'DELETE') {
        state.shareToken = null;
        return json({ ok: true });
      }
      state.shareToken = 'tok-abc';
      return json({ token: 'tok-abc', path: '/s/tok-abc', createdAt: Date.now() }, 201);
    }
    if (path === `${base}/marks` && method === 'POST') {
      const { pngBase64 } = route.request().postDataJSON() as { pngBase64: string };
      state.marks.push(Buffer.from(pngBase64, 'base64'));
      return json({ attachmentId: `att-mark-${state.marks.length}` }, 201);
    }
    const markId = /^\/api\/attachments\/att-mark-(\d+)$/.exec(path)?.[1];
    if (markId !== undefined) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: state.marks[Number(markId) - 1] ?? Buffer.alloc(0),
      });
    }
    const commentId = /\/design\/comments\/([^/]+)$/.exec(path)?.[1];
    if (commentId !== undefined && method === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      state.comments = state.comments.map((c) => (c.id === commentId ? { ...c, ...patch } : c));
      state.writes.push(`patch ${commentId} ${JSON.stringify(patch)}`);
      return json(state.comments.find((c) => c.id === commentId));
    }
    if (commentId !== undefined && method === 'DELETE') {
      state.comments = state.comments.filter((c) => c.id !== commentId);
      state.writes.push(`delete ${commentId}`);
      return route.fulfill({ status: 204 });
    }
    if (/^\/api\/conversations\/[^/]+\/messages$/.test(path) && method === 'POST') {
      const body = route.request().postDataJSON() as {
        content: string;
        designCommentIds?: string[];
      };
      state.sends.push(body);
      const ids = new Set(body.designCommentIds ?? []);
      state.comments = state.comments.map((c) => (ids.has(c.id) ? { ...c, status: 'sent' } : c));
      mock.messages = [
        ...mock.messages,
        { id: `n${mock.messages.length + 1}`, role: 'user', content: body.content, createdAt: Date.now() },
      ];
      return json({ thread: THREAD }, 201);
    }
    if (path === `/api/todos/${PAGE_TASK.id}`) return json(PAGE_TASK);
    if (path === base) {
      const current = state.versions[state.versions.length - 1];
      return json({
        pages: [
          {
            fileName: 'pricing.html',
            current,
            versionCount: state.versions.length,
            openComments: state.comments.filter((c) => c.status === 'open').length,
            shareToken: state.shareToken,
          },
        ],
        shareOrigin,
      });
    }
    if (path === `${base}/pricing.html/versions`) return json(state.versions);
    const restore = /\/design\/versions\/(ver-\d+)\/restore$/.exec(path)?.[1];
    if (restore !== undefined && method === 'POST') {
      const from = state.versions.find((v) => v.id === restore);
      const next = version(state.versions.length + 1, {
        source: 'restore',
        restoredFromSeq: from?.seq ?? null,
        attachmentId: from?.attachmentId ?? '',
      });
      html[next.id] = html[restore] ?? '';
      state.versions = [...state.versions, next];
      state.restored.push(restore);
      return json(next, 201);
    }
    const pageId = /^\/api\/design\/versions\/([^/]+)\/page$/.exec(path)?.[1];
    if (pageId !== undefined) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html[pageId] ?? '' });
    }
    return undefined;
  });
  await page.goto(`/app?view=design&thread=${PAGE_TASK.id}&page=pricing.html`, {
    waitUntil: 'domcontentloaded',
  });
  return state;
}

test.describe('artifact parser', () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
    );
  });

  test('keeps the policy and bridges outside literal closing tags', async ({ page }) => {
    const html = `<!doctype html><title>HTML examples</title><body>
      <!-- Example markup: </body> -->
      <script type="application/json" id="example-config">{"closingTag":"</body>"}</script>
      <h1 data-example="</body>">HTML examples</h1>`;
    await openDesign(page, [], null, { 'ver-2': html });
    const ownerFrame = page.getByTestId('design-frame');
    await expect(ownerFrame).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-downloads');
    const frame = ownerFrame.contentFrame();
    const heading = frame.getByRole('heading', { name: 'HTML examples' });
    await expect(frame.locator('head > :first-child')).toHaveAttribute('http-equiv', 'Content-Security-Policy');
    await expect(heading).toHaveAttribute('data-example', '</body>');
    expect(await frame.locator('#example-config').textContent()).toBe('{"closingTag":"</body>"}');
    await expect(frame.locator('head > script[data-od-sandbox-shim]')).toHaveCount(1);
    const enforcement = await heading.evaluate(() => {
      const originalBase = document.baseURI;
      const base = document.createElement('base');
      base.href = new URL('/html-examples/', originalBase).href;
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => resolve(null), 1500);
        document.addEventListener('securitypolicyviolation', (event) => {
          window.clearTimeout(timer);
          resolve({ directive: event.effectiveDirective, unchanged: document.baseURI === originalBase });
        }, { once: true });
        document.head.append(base);
      });
    });
    expect(enforcement).toEqual({ directive: 'base-uri', unchanged: true });
    await page.getByTestId('design-comment-mode').click();
    await heading.click();
    await expect(page.getByTestId('design-comment-popover')).toBeVisible();
  });

  test('opens an artifact without calling DOMParser in the board', async ({ page }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      const calls: string[] = [];
      Object.assign(window, { previewParserCalls: calls });
      const parse = DOMParser.prototype.parseFromString;
      DOMParser.prototype.parseFromString = function (source, type) {
        calls.push(type);
        return parse.call(this, source, type);
      };
    });
    await openDesign(page, [], null, { 'ver-2': '<h1>Quarterly pricing</h1>' });
    const frame = page.getByTestId('design-frame').contentFrame();
    await expect(frame.getByRole('heading', { name: 'Quarterly pricing' })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'previewParserCalls'))).toEqual([]);
  });

  test('renders dense short comments without parsing fragments in the board', async ({ page }) => {
    const comment = '<!--x-->';
    const html = comment.repeat(8192) + '<h1>Dense comment report</h1>';
    await page.addInitScript((comment) => {
      if (window !== window.top) return;
      const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      Object.assign(window, { previewFragmentParses: 0 });
      Object.defineProperty(Element.prototype, 'innerHTML', {
        ...innerHTML,
        set(this: Element, value: string) {
          if (this instanceof HTMLTemplateElement && value === comment) {
            Reflect.set(window, 'previewFragmentParses', Reflect.get(window, 'previewFragmentParses') + 1);
          }
          innerHTML?.set?.call(this, value);
        },
      });
    }, comment);
    await openDesign(page, [], null, { 'ver-2': html });
    const frame = page.getByTestId('design-frame').contentFrame();
    await expect(frame.getByRole('heading', { name: 'Dense comment report' })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'previewFragmentParses'))).toBe(0);
  });

  test('renders 10 MiB documents with leading whitespace or a leading comment', async ({ page }) => {
    const size = 10 * 1024 * 1024;
    const whitespacePage = '<!doctype html><h1>Whitespace report</h1>';
    const commentPage = '<!doctype html><h1>Comment report</h1>';
    const commentOpen = '<!--';
    const commentClose = '-->';
    await openDesign(page, [], null, {
      'ver-2': ' '.repeat(size - whitespacePage.length) + whitespacePage,
      'ver-1': `${commentOpen}${'x'.repeat(size - commentPage.length - commentOpen.length - commentClose.length)}${commentClose}${commentPage}`,
    });
    const frame = page.getByTestId('design-frame').contentFrame();
    await expect(frame.getByRole('heading', { name: 'Whitespace report' })).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('design-versions').click();
    await page.getByTestId('design-version-item').filter({ hasText: 'v1' }).click();
    await expect(frame.getByRole('heading', { name: 'Comment report' })).toBeVisible({ timeout: 20_000 });
  });

  test('preserves active HTML and metadata outside the documented prefix differences', async ({ page, context }) => {
    const html = `\uFEFF<!-- Opening -- note --><!doctype html SYSTEM "about:legacy-compat">
      <html lang="en"><!-- Inside the root --><head id="pricing" data-label=A\u00a0B>
      <noscript><style>.fallback { color: red }</style></noscript><title>Pricing</title></head>
      <body><h1>Pending</h1><noscript><p>Pricing &amp; plans</p></noscript>
      <template><p data-label="A > B">Starter &amp; Pro</p></template>
      <script>document.querySelector('h1').textContent = 'Pricing is ready'</script>
      </body></html><!-- Closing note -->`;
    const metadata = () => ({
      doctype: document.doctype?.systemId ?? null,
      charset: document.characterSet,
      compatMode: document.compatMode,
      lang: document.documentElement.lang,
      head: [document.head.id, document.head.dataset.label],
      comments: [document, document.documentElement, document.head].map((parent) =>
        [...parent.childNodes].filter((node) => node instanceof Comment).map((node) => node.data),
      ),
      noscript: [...document.querySelectorAll('noscript')].map((node) => [
        node.parentElement?.tagName,
        node.textContent,
        node.childElementCount,
      ]),
      template: document.querySelector('template')?.content.firstElementChild?.outerHTML,
      heading: document.querySelector('h1')?.textContent,
    });
    const direct = await context.newPage();
    await direct.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const expected = await direct.locator('html').evaluate(metadata);
    await direct.close();
    expect(expected).toMatchObject({ doctype: 'about:legacy-compat', heading: 'Pricing is ready' });
    const [[opening, closing], rootComments, headComments] = expected.comments;

    await openDesign(page, [], null, { 'ver-2': html });
    const frame = page.getByTestId('design-frame').contentFrame();
    await expect(frame.getByRole('heading', { name: 'Pricing is ready' })).toBeVisible();
    expect(await frame.locator('html').evaluate(metadata)).toEqual({
      ...expected,
      doctype: '',
      head: ['', undefined],
      comments: [[closing], [], [opening, ...rootComments, ...headComments]],
    });
  });

  test('previews plaintext in standards mode and preserves a frameset', async ({ page }) => {
    await openDesign(page, [], null, {
      'ver-2': 'Pricing is being drafted.',
      'ver-1': '<!doctype html><title>Archived plans</title><frameset cols="100%"><frame title="Archived plans" src="data:text/html,Archived%20plans"></frameset>',
    });
    const frame = page.getByTestId('design-frame').contentFrame();
    await expect(frame.locator('body')).toHaveText('Pricing is being drafted.');
    expect(await frame.locator('html').evaluate(() => document.compatMode)).toBe('CSS1Compat');
    await page.getByTestId('design-versions').click();
    await page.getByTestId('design-version-item').filter({ hasText: 'v1' }).click();
    const child = frame.locator('frameset > frame[title="Archived plans"]');
    await expect(child.contentFrame().locator('body')).toHaveText('Archived plans');
  });

  test('uses storage immediately and supports comments and snapshots before a deferred script runs', async ({
    page,
  }, testInfo) => {
    const pending = Promise.withResolvers<void>();
    await page.route('**/preview-deferred.js', async (route) => {
      await pending.promise;
      await route.fulfill({
        contentType: 'application/javascript',
        body: "document.documentElement.dataset.deferred = 'finished'",
      });
    });
    const html = `<!doctype html><head><title>Workspace pricing</title>
      <script>
        localStorage.setItem('plan', 'starter');
        sessionStorage.setItem('section', 'pricing');
        document.documentElement.dataset.storage = localStorage.getItem('plan') + '/' + sessionStorage.getItem('section');
      </script>
      <script defer src="/preview-deferred.js"></script></head>
      <body><h1 data-od-id="title">Workspace pricing</h1><p>One plan for your whole team.</p></body>`;
    try {
      const [request, state] = await Promise.all([
        page.waitForRequest('**/preview-deferred.js'),
        openDesign(page, [], null, { 'ver-2': html }),
      ]);
      expect(request.frame().parentFrame()).toBe(page.mainFrame());
      const frame = page.getByTestId('design-frame').contentFrame();
      const heading = frame.getByRole('heading', { name: 'Workspace pricing' });
      await expect(heading).toBeVisible();
      await expect.soft(frame.locator('html')).toHaveAttribute('data-storage', 'starter/pricing', {
        timeout: 1000,
      });
      await page.getByTestId('design-comment-mode').click();
      await expect(frame.locator('html')).toHaveAttribute('data-od-comment-mode', '', { timeout: 5000 });
      await expect(page.getByTestId('design-comment-unsupported')).toHaveCount(0);
      await heading.click();
      const note = page.getByTestId('design-comment-note');
      await note.fill('Lead with the team plan');
      await page.screenshot({ path: testInfo.outputPath('preview-commenting.png') });
      await page.getByTestId('design-comment-save').click();
      await expect(page.getByTestId('design-pin')).toBeVisible();
      expect(state.comments).toHaveLength(1);

      await page.getByTestId('design-export').click();
      const [png] = await Promise.all([
        page.waitForEvent('download', { timeout: 12_000 }),
        page.getByTestId('design-export-png').click(),
      ]);
      expect(png.suggestedFilename()).toBe('pricing.png');
      expect(await heading.evaluate(() => document.readyState)).toBe('interactive');
    } finally {
      pending.resolve();
    }
    await expect(page.getByTestId('design-frame').contentFrame().locator('html')).toHaveAttribute(
      'data-deferred',
      'finished',
    );
  });

  for (const registration of ['inline', 'deferred', 'module', 'late'] as const) {
    test(`artifact activation fallbacks yield to ${registration} handlers`, async ({ page }) => {
      const handlers = `
        const view = document.getElementById('view');
        const submissions = [];
        function routeLink(event, linkId, title) {
          if (event.defaultPrevented || event.target.id !== linkId) return;
          event.preventDefault();
          view.textContent = title;
        }
        document.addEventListener('click', (event) => routeLink(event, 'details', 'details'));
        window.addEventListener('click', (event) => routeLink(event, 'billing', 'billing'));
        document.addEventListener('click', (event) => {
          if (event.target.id === 'send') event.target.setAttribute('form', 'details-form');
        }, true);
        document.addEventListener('submit', (event) => {
          event.preventDefault();
          submissions.push(event.target.id + ':' + event.submitter.id);
          document.getElementById('last-submitter').textContent = event.submitter.id;
        });
        window.addEventListener('click', (event) => {
          if (event.target.id === 'send') setTimeout(() => setTimeout(() => {
            document.getElementById('submissions').textContent = submissions.join(', ');
          }, 0), 0);
        });
        document.documentElement.dataset.handlers = 'ready';`;
      const pending = Promise.withResolvers<void>();
      await page.route('**/preview-activation.js', async (route) => {
        if (registration === 'inline') await pending.promise;
        await route.fulfill({
          contentType: 'application/javascript',
          body: registration === 'deferred' ? handlers : '',
        });
      });
      const script = {
        inline: `<script>${handlers}</script><script defer src="/preview-activation.js"></script>`,
        deferred: '<script defer src="/preview-activation.js"></script>',
        module: `<script type="module">${handlers}</script>`,
        late: `<script>window.addEventListener('load', () => setTimeout(() => {${handlers}}, 0))</script>`,
      }[registration];
      const html = `<!doctype html><body>
        <a id="details" href="#details">Plan details</a>
        <a id="billing" href="#billing">Billing details</a>
        <a href="#terms">Terms</a><p id="terms">Monthly renewal</p>
        <h1 id="view">home</h1>
        <form id="account-form"></form><form id="details-form"></form>
        <button id="send" type="submit" form="account-form">Confirm plan</button>
        <form><input aria-label="Billing email" type="email"><button id="save-email" type="submit">Save email</button></form>
        <output id="submissions"></output><output id="last-submitter"></output>${script}`;
      try {
        await openDesign(page, [], null, { 'ver-2': html });
        const frame = page.getByTestId('design-frame').contentFrame();
        await expect(frame.locator('html')).toHaveAttribute('data-handlers', 'ready');
        const view = frame.getByRole('heading');
        await frame.getByRole('link', { name: 'Plan details' }).click();
        expect.soft(await view.textContent(), 'document router').toBe('details');
        await frame.getByRole('link', { name: 'Billing details' }).click();
        expect.soft(await view.textContent(), 'window router').toBe('billing');
        await frame.getByRole('button', { name: 'Confirm plan' }).click();
        const submissions = frame.locator('#submissions');
        await expect(submissions).not.toBeEmpty();
        expect.soft(await submissions.textContent(), 'form selected by the artifact').toBe(
          'details-form:send',
        );
        await frame.getByRole('textbox', { name: 'Billing email' }).dispatchEvent('keydown', {
          key: 'Enter',
        });
        await expect(frame.locator('#last-submitter')).toHaveText('save-email');
        await frame.getByRole('link', { name: 'Terms' }).click();
        await expect.poll(() => view.evaluate(() => location.hash)).toBe('#terms');
        if (registration === 'inline') {
          expect(await view.evaluate(() => document.readyState)).toBe('interactive');
        }
      } finally {
        pending.resolve();
      }
    });
  }

  test('keeps an unterminated inline script inert as in a direct opening', async ({ page, context }) => {
    const html = `<!doctype html><body><h1>Pricing draft</h1>
      <script>document.querySelector('h1').textContent = 'Pricing published'`;
    const direct = await context.newPage();
    await direct.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await expect(direct.getByRole('heading')).toHaveText('Pricing draft');
    await direct.close();
    await openDesign(page, [], null, { 'ver-2': html });
    const frame = page.getByTestId('design-frame').contentFrame();
    await expect.poll(() => frame.locator('body').evaluate(() => ({
      readyState: document.readyState,
      title: document.querySelector('h1')?.textContent,
    }))).toEqual({ readyState: 'complete', title: 'Pricing draft' });
  });
});

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

test('comments: pick an element, save, edit, delete, send with the next message, resolve, and show a lost anchor', async ({
  page,
}) => {
  const state = await openDesign(page, [lostComment()]);
  const pane = page.getByTestId('design-pane');
  const frame = pane.getByTestId('design-frame').contentFrame();
  await expect(frame.getByRole('heading', { name: '随你一起长大的定价' })).toBeVisible();

  await pane.getByTestId('design-comment-mode').click();
  await expect(pane.getByTestId('design-comment-mode')).toHaveAttribute('aria-pressed', 'true');
  await frame.getByRole('button', { name: '升级到 Pro' }).hover();
  await expect(pane.getByTestId('design-hover-outline')).toBeVisible();
  await frame.getByRole('button', { name: '升级到 Pro' }).click();
  const popover = pane.getByTestId('design-comment-popover');
  await expect(popover.getByTestId('design-comment-target')).toHaveText('button · 「升级到 Pro」');
  await expect(popover.getByTestId('design-inspect')).toContainText('尺寸');
  await popover.getByTestId('design-comment-note').fill('只让 Pro 的按钮是实心');
  await popover.getByTestId('design-comment-save').click();
  await expect(popover).toHaveCount(0);
  await expect(pane.locator('[data-testid="design-pin"][data-pin="2"]')).toBeVisible();

  await frame.getByRole('heading').click();
  await pane.getByTestId('design-comment-note').fill('标题短一点');
  await pane.getByTestId('design-comment-save').click();
  const chips = page.getByTestId('design-comment-chip');
  await expect(chips).toHaveText([/^2升级到 Pro · 只让 Pro 的按钮是实心$/, /^3随你一起长大的定价 · 标题短一点$/]);
  await expect(page.getByTestId('chief-send-comments')).toHaveText('发送（含 2 条评论）');
  const created = state.comments.find((c) => c.id === 'cmt-2');
  expect(created).toMatchObject({ versionId: 'ver-2', viewport: 'desktop', label: 'button', text: '升级到 Pro' });

  await pane.getByTestId('design-comments-toggle').click();
  const rows = pane.getByTestId('design-comment-row');
  await expect(rows).toHaveCount(3);
  const lost = rows.filter({ has: page.getByTestId('design-comment-lost') });
  await expect(lost).toHaveAttribute('data-anchor', 'lost');
  await expect(lost).toContainText('在 v1 上提出，这一版中未找到');
  await expect(pane.locator('[data-testid="design-pin"][data-pin="1"]')).toHaveCount(0);
  const second = pane.locator('[data-testid="design-comment-row"][data-pin="2"]');
  await expect(second).toContainText('未发送');
  await second.getByTestId('design-comment-edit').click();
  await second.getByTestId('design-comment-edit-note').fill('只让 Pro 的按钮是实心，另外两个描边');
  await second.getByTestId('design-comment-edit-save').click();
  await expect(second).toContainText('另外两个描边');
  await pane.locator('[data-testid="design-comment-row"][data-pin="3"]').getByTestId('design-comment-delete').click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('chief-send-comments')).toHaveText('发送（含 1 条评论）');
  expect(state.writes).toEqual([
    'create cmt-2',
    'create cmt-3',
    'patch cmt-2 {"note":"只让 Pro 的按钮是实心，另外两个描边"}',
    'delete cmt-3',
  ]);

  await page.getByTestId('chief-composer-input').fill('按评论改');
  await page.getByTestId('chief-send-comments').click();
  await expect.poll(() => state.sends.length).toBe(1);
  expect(state.sends[0]).toMatchObject({ content: '按评论改', designCommentIds: ['cmt-2'] });
  await expect(page.getByTestId('design-comment-chip')).toHaveCount(0);
  await expect(second).toContainText('已发给 agent');
  await expect(second.getByTestId('design-comment-delete')).toHaveCount(0);
  await second.getByTestId('design-comment-resolve').click();
  await expect(second).toHaveAttribute('data-status', 'resolved');
  await expect(pane.locator('[data-testid="design-pin"][data-pin="2"]')).toHaveCount(0);
  await second.getByTestId('design-comment-reopen').click();
  await expect(second).toHaveAttribute('data-status', 'open');

  await frame.getByText('一个工作区').click();
  await pane.getByTestId('design-comment-note').fill('这句去掉');
  await pane.getByTestId('design-comment-send').click();
  await expect.poll(() => state.sends.length).toBe(2);
  expect(state.sends[1]).toMatchObject({ content: '按下面的设计评论改。', designCommentIds: ['cmt-3'] });

  await page.keyboard.press('Escape');
  await expect(pane.getByTestId('design-comment-mode')).toHaveAttribute('aria-pressed', 'false');
});

test('mark-up: draw a box, a stroke and text, undo and redo, then save a PNG mark as a comment', async ({
  page,
}) => {
  const state = await openDesign(page);
  await expect(page.frameLocator('[data-testid="design-frame"]').getByRole('heading')).toBeVisible();
  await page.getByTestId('design-mark-mode').click();
  await expect(page.getByTestId('design-mark-mode')).toHaveAttribute('aria-pressed', 'true');
  const bar = page.getByTestId('design-mark-bar');
  await expect(bar).toBeVisible();
  const layer = page.getByTestId('design-draw-layer');
  const box = await layer.boundingBox();
  if (box === null) throw new Error('draw layer has no box');
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  const drag = async (points: { x: number; y: number }[]) => {
    const [first, ...rest] = points;
    if (first === undefined) return;
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.mouse.up();
  };
  await drag([at(0.1, 0.1), at(0.5, 0.3)]);
  await expect(page.getByTestId('design-mark-undo')).toBeEnabled();
  await page.getByTestId('design-mark-note').fill('标题区域太挤');
  await expect(page.getByTestId('design-mark-save')).toBeEnabled();
  await page.getByTestId('design-mark-undo').click();
  await expect(page.getByTestId('design-mark-save')).toBeDisabled();
  await expect(page.getByTestId('design-mark-redo')).toBeEnabled();
  await page.getByTestId('design-mark-redo').click();
  await expect(page.getByTestId('design-mark-save')).toBeEnabled();

  await page.getByTestId('design-mark-tool-pen').click();
  await drag([at(0.6, 0.6), at(0.7, 0.65), at(0.8, 0.6)]);
  await page.getByTestId('design-mark-tool-text').click();
  await page.mouse.click(at(0.2, 0.5).x, at(0.2, 0.5).y);
  await expect(page.getByTestId('design-draw-text')).toBeFocused();
  await page.keyboard.type('加大间距');
  await page.getByTestId('design-mark-save').click();

  await expect(bar).toBeHidden();
  await expect(page.getByTestId('design-mark-mode')).toHaveAttribute('aria-pressed', 'false');
  expect(state.marks).toHaveLength(1);
  expect(state.marks[0]?.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(state.writes).toEqual(['create cmt-1']);
  const created = state.comments[0];
  expect(created).toMatchObject({
    markAttachmentId: 'att-mark-1',
    note: '标题区域太挤',
    selector: 'body',
    versionId: 'ver-2',
  });
  await expect(page.locator('[data-testid="design-pin"][data-pin="1"]')).toBeVisible();
  await expect(page.getByTestId('design-comment-chip')).toHaveCount(1);
  await page.getByTestId('design-comments-toggle').click();
  const mark = page.getByTestId('design-comment-mark').locator('img');
  await expect(mark).toBeVisible();
  await expect.poll(() => mark.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await page.getByTestId('design-mark-mode').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('design-mark-bar')).toBeHidden();
});

test('export: the page as HTML without bridges, a ZIP with handoff and manifest, a PNG snapshot and a print link', async ({
  page,
}) => {
  await openDesign(page);
  await expect(page.frameLocator('[data-testid="design-frame"]').getByRole('heading')).toBeVisible();
  const download = async (item: string) => {
    await page.getByTestId('design-export').click();
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(item).click()]);
    const path = await file.path();
    return { name: file.suggestedFilename(), bytes: (await import('node:fs')).readFileSync(path) };
  };

  const html = await download('design-export-html');
  expect(html.name).toBe('pricing.html');
  expect(html.bytes.toString('utf8')).toBe(HTML['ver-2']);

  const zip = await download('design-export-zip');
  expect(zip.name).toBe('pricing.zip');
  expect(zip.bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  const listing = zip.bytes.toString('utf8');
  for (const entry of ['pricing/index.html', 'pricing/DESIGN-HANDOFF.md', 'pricing/DESIGN-MANIFEST.json'])
    expect(listing).toContain(entry);
  expect(listing).toContain(HTML['ver-2']);
  expect(listing).not.toContain('od:comment');

  const png = await download('design-export-png');
  expect(png.name).toBe('pricing.png');
  expect(png.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  await page.getByTestId('design-export').click();
  const pdf = page.getByTestId('design-export-pdf');
  await expect(pdf).toHaveAttribute('href', '/api/design/versions/ver-2/page?print=1');
  await expect(pdf).toHaveAttribute('target', '_blank');
});

test('share without a relay downloads the page and points at remote access', async ({ page }) => {
  const state = await openDesign(page);
  await expect(page.frameLocator('[data-testid="design-frame"]').getByRole('heading')).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('design-share').click()]);
  expect(file.suggestedFilename()).toBe('pricing.html');
  const popover = page.getByTestId('design-share-popover');
  await expect(popover.getByTestId('design-share-no-relay')).toContainText('生成链接需要先配置中继（远程访问）');
  await expect(popover.getByTestId('design-share-create')).toHaveCount(0);
  expect(state.shareCalls).toEqual([]);
  await popover.getByTestId('design-share-relay-settings').click();
  await expect(page).toHaveURL(/\/app\/settings\/remote/);
});

test('share with a relay creates a link, copies it and stops sharing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const state = await openDesign(page, [], 'https://relay.example');
  await expect(page.frameLocator('[data-testid="design-frame"]').getByRole('heading')).toBeVisible();
  await page.getByTestId('design-share').click();
  const popover = page.getByTestId('design-share-popover');
  await expect(popover.getByTestId('design-share-off')).toBeVisible();
  await popover.getByTestId('design-share-create').click();
  await expect(popover.getByTestId('design-share-url')).toHaveText('https://relay.example/s/tok-abc');
  await popover.getByTestId('design-share-copy').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('https://relay.example/s/tok-abc');
  await popover.getByTestId('design-share-stop').click();
  await expect(popover.getByTestId('design-share-off')).toBeVisible();
  expect(state.shareCalls).toEqual(['POST', 'DELETE']);
});
