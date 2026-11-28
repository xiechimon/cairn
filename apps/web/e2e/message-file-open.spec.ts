import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, type Row, TASK, THREAD } from './chief-home-mock.js';

type Reply = { status: number; body: unknown };
interface FileCall {
  conversation: string;
  message: string;
  method: string;
  body: unknown;
}

const NOW = Date.UTC(2026, 10, 28, 8);
const BUILD = 'build-1';
const FILE_ROUTE = /^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/file$/;
const REPORT_TEXT = '<b>Quarterly</b> adoption report\n# Not a heading\n[not a link](https://example.com)\n';

const TASK_DONE = {
  ...TASK,
  phase: 'done',
  phaseAt: NOW,
  lastRunAt: NOW,
  hasPlan: false,
  buildHistory: [],
};
const BUILD_RECORD = {
  id: BUILD,
  todoId: TASK.id,
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 100_000,
};

const MAIN_TEXT = [
  'Saved the write-up as report.md and the figures in notes/summary.md.',
  'Numbers are in [Q3 numbers](docs/q3\\_report.md), the log is `build.log`, and the vendor copy is [report.md](https://example.com/report.md).',
  'Not files: /etc/hosts.md and ../outside.md and %2e%2e/x.md and C:\\temp\\y.md.',
  '',
  '- notes/list.md',
  '',
  '```sh',
  'cat deliverable.md',
  '```',
].join('\n');

type FlaggedRow = Row & { workspaceFileLinks?: true; workspaceFilePaths?: string[] };
const reply = (id: string, text: string, at: number, flagged = true): FlaggedRow => ({
  id,
  role: 'assistant',
  content: text,
  createdAt: at,
  ...(flagged ? { workspaceFileLinks: true as const, workspaceFilePaths: text === MAIN_TEXT ? ['report.md', 'notes/summary.md', 'docs/q3_report.md', 'build.log', 'notes/list.md'] : [...text.matchAll(/[\w-]+(?:\/[\w.-]+)*\.[\w-]+/g)].map((match) => match[0]) } : {}),
});
const toolRow = (id: string, at: number): Row => ({
  id,
  role: 'assistant',
  createdAt: at,
  content: {
    kind: 'toolcall',
    call: { id: `c-${id}`, name: 'Bash', arguments: { command: 'ls' }, result: 'a.txt', startedAt: at, endedAt: at + 5 },
  },
});

function gate<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const ok = (text: string): Reply => ({ status: 200, body: { status: 'ok', text } });

async function world(page: Page, options: { coordinator?: Row[]; task?: Row[]; locale?: 'en' | 'zh' } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((locale) => {
    if (locale === 'en') localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-theme', 'dark');
  }, options.locale ?? 'en');
  const calls: FileCall[] = [];
  const state = { threads: [THREAD], messages: options.coordinator ?? [], todos: [TASK_DONE] };
  const task = { rows: options.task ?? [] };
  const answer: { current: (call: FileCall) => Promise<Reply> | Reply } = { current: () => ok(REPORT_TEXT) };
  await mockLive(page, state, (path, route, json) => {
    const file = FILE_ROUTE.exec(path);
    if (file !== null) {
      const call: FileCall = {
        conversation: file[1] ?? '',
        message: file[2] ?? '',
        method: route.request().method(),
        body: route.request().postDataJSON(),
      };
      calls.push(call);
      return (async () => {
        const { status, body } = await answer.current(call);
        await json(body, status);
      })();
    }
    if (path === `/api/todos/${TASK.id}`) return json(TASK_DONE);
    if (path === `/api/builds/${BUILD}`) return json(BUILD_RECORD);
    if (path === `/api/builds/${BUILD}/gate`) return json({ state: null });
    if (path === `/api/builds/${BUILD}/changes`) return json({ files: [] });
    if (path === `/api/builds/${BUILD}/steps`) {
      return json([
        { id: 'step-1', buildId: BUILD, machineId: 'm-ready', status: 'done', kind: 'build', createdAt: NOW - 100_000, checkpointCommit: null, skillInjection: null },
      ]);
    }
    if (path === `/api/conversations/${BUILD}/messages`) {
      return json({ messages: task.rows, chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null });
    }
    return undefined;
  });
  return { calls, state, task, answer };
}

interface Surface {
  name: 'task' | 'Coordinator';
  url: string;
  conversation: string;
  root: (page: Page) => Locator;
  message: (root: Locator) => Locator;
  seed: (rows: Row[]) => { coordinator?: Row[]; task?: Row[] };
}

const SURFACES: Surface[] = [
  {
    name: 'task',
    url: `/app/todo/${TASK.id}`,
    conversation: BUILD,
    root: (page) => page.getByTestId('transcript-col'),
    message: (root) => root.getByTestId('agent-text').filter({ hasText: 'Saved the write-up' }),
    seed: (rows) => ({ task: rows }),
  },
  {
    name: 'Coordinator',
    url: '/app',
    conversation: THREAD.id,
    root: (page) => page.getByTestId('home-c'),
    message: (root) => root.getByTestId('chief-msg').filter({ hasText: 'Saved the write-up' }),
    seed: (rows) => ({ coordinator: rows }),
  },
];

const links = (scope: Locator) => scope.getByTestId('message-file-link');
const link = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true });
const preview = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
const rectOf = (locator: Locator) =>
  locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
  });

for (const surface of SURFACES) {
  test.describe(`${surface.name}: a file named in a reply opens a read-only preview`, () => {
    test('links the relative file mentions of the stamped reply, in text, inline code and Markdown targets, and nothing else', async ({ page }) => {
      const owner: FlaggedRow = { id: 'owner', role: 'user', content: 'Please keep report.md', createdAt: 5, workspaceFileLinks: true };
      const w = await world(page, surface.seed([owner, reply('reply', MAIN_TEXT, 10)]));
      await page.goto(surface.url);
      const root = surface.root(page);
      const message = surface.message(root);
      await expect(message).toBeVisible();

      await expect(links(message)).toHaveText(['report.md', 'notes/summary.md', 'Q3 numbers', 'build.log', 'notes/list.md']);
      await expect(link(message, 'build.log').locator('code')).toHaveText('build.log');
      const external = message.locator('a[href="https://example.com/report.md"]');
      await expect(external).toHaveText('report.md');
      await expect(links(external)).toHaveCount(0);
      await expect(links(message.locator('pre'))).toHaveCount(0);
      await expect(message.locator('pre')).toContainText('cat deliverable.md');
      await expect(message).toContainText('/etc/hosts.md and ../outside.md and %2e%2e/x.md');
      await expect(links(root)).toHaveCount(5);
      expect(w.calls).toEqual([]);
    });

    test('only this row’s authoritative paths become buttons, and an absent list stays plain', async ({ page }) => {
      const partial = { ...reply('partial', 'Saved the write-up as first.md and second.md', 10), workspaceFilePaths: ['second.md'] };
      const old = { ...reply('old', 'Saved the write-up as old.md', 11), workspaceFilePaths: undefined };
      await world(page, surface.seed([partial, old]));
      await page.goto(surface.url);
      const root = surface.root(page);
      await expect(links(root)).toHaveText(['second.md']);
      await expect(root).toContainText('first.md');
      await expect(root).toContainText('old.md');
    });

    test('a reply without the flag never links, even beside a flagged one', async ({ page }) => {
      const w = await world(page, surface.seed([reply('plain', 'Saved the write-up as report.md', 10, false)]));
      await page.goto(surface.url);
      const root = surface.root(page);
      await expect(surface.message(root)).toContainText('report.md');
      await expect(links(root)).toHaveCount(0);
      expect(w.calls).toEqual([]);
    });

    test('a click posts the conversation, the exact row and the relative path, and shows the file as raw text without moving the reply', async ({ page }) => {
      const w = await world(page, surface.seed([reply('reply', MAIN_TEXT, 10)]));
      const pending = gate<Reply>();
      w.answer.current = () => pending.promise;
      await page.goto(surface.url);
      const message = surface.message(surface.root(page));
      const trigger = link(message, 'report.md');
      await expect(trigger).toBeVisible();
      const before = await rectOf(message);

      await trigger.click();
      const dialog = preview(page, 'report.md');
      await expect(dialog).toContainText('Opening file…');
      expect(w.calls).toEqual([
        { conversation: surface.conversation, message: 'reply', method: 'POST', body: { path: 'report.md' } },
      ]);
      expect(Math.max(...(await rectOf(message)).map((value, i) => Math.abs(value - (before[i] ?? value))))).toBeLessThanOrEqual(1);

      pending.release(ok(REPORT_TEXT));
      const text = dialog.getByTestId('workspace-file-text');
      await expect(text).toHaveText(REPORT_TEXT.trim());
      await expect(text).toHaveAttribute('translate', 'no');
      await expect(text).toHaveCSS('white-space', /^pre/);
      await expect(dialog.locator('b, h1, a, img')).toHaveCount(0);
      await expect(dialog).not.toContainText('Opening file…');
      expect(Math.max(...(await rectOf(message)).map((value, i) => Math.abs(value - (before[i] ?? value))))).toBeLessThanOrEqual(1);

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(Math.max(...(await rectOf(message)).map((value, i) => Math.abs(value - (before[i] ?? value))))).toBeLessThanOrEqual(1);
    });

    test('a Markdown target and an inline-code name open their own paths, and reopening reads the current file', async ({ page }) => {
      const w = await world(page, surface.seed([reply('reply', MAIN_TEXT, 10)]));
      let version = 1;
      w.answer.current = () => ok(`version ${version}\n`);
      await page.goto(surface.url);
      const message = surface.message(surface.root(page));

      await link(message, 'Q3 numbers').click();
      await expect(preview(page, 'docs/q3_report.md').getByTestId('workspace-file-text')).toHaveText('version 1');
      await page.keyboard.press('Escape');
      await expect(preview(page, 'docs/q3_report.md')).toHaveCount(0);
      version = 2;
      await link(message, 'Q3 numbers').click();
      await expect(preview(page, 'docs/q3_report.md').getByTestId('workspace-file-text')).toHaveText('version 2');
      await page.keyboard.press('Escape');
      await expect(preview(page, 'docs/q3_report.md')).toHaveCount(0);
      await link(message, 'build.log').click();
      await expect(preview(page, 'build.log')).toBeVisible();
      expect(w.calls.map((call) => call.body)).toEqual([{ path: 'docs/q3_report.md' }, { path: 'docs/q3_report.md' }, { path: 'build.log' }]);
    });

    test('the latest click wins: a slow earlier answer never replaces the file last opened', async ({ page }) => {
      const w = await world(page, surface.seed([reply('reply', MAIN_TEXT, 10)]));
      const slow = gate<Reply>();
      w.answer.current = (call) => ((call.body as { path: string }).path === 'report.md' ? slow.promise : ok('SUMMARY TEXT\n'));
      await page.goto(surface.url);
      const message = surface.message(surface.root(page));

      await link(message, 'report.md').click();
      await expect(preview(page, 'report.md')).toContainText('Opening file…');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await link(message, 'notes/summary.md').click();
      const summary = preview(page, 'notes/summary.md');
      await expect(summary.getByTestId('workspace-file-text')).toHaveText('SUMMARY TEXT');

      slow.release(ok('STALE REPORT\n'));
      await page.waitForTimeout(150);
      await expect(summary.getByTestId('workspace-file-text')).toHaveText('SUMMARY TEXT');
      await expect(page.getByText('STALE REPORT')).toHaveCount(0);
    });

    for (const notice of [
      { status: 'gone', http: 410, copy: 'This file is no longer in the step’s workspace' },
      { status: 'offline', http: 503, copy: 'The runner is offline' },
      { status: 'unsupported', http: 422, copy: 'This file cannot be previewed' },
      { status: 'unavailable', http: 404, copy: 'This file is unavailable right now' },
    ] as const) {
      test(`${notice.status} shows its own notice and no file text, and a retry works`, async ({ page }) => {
        const w = await world(page, surface.seed([reply('reply', MAIN_TEXT, 10)]));
        w.answer.current = () => ({ status: notice.http, body: { status: notice.status } });
        await page.goto(surface.url);
        const message = surface.message(surface.root(page));
        await link(message, 'report.md').click();
        const dialog = preview(page, 'report.md');
        await expect(dialog.getByTestId('workspace-file-notice')).toHaveText(notice.copy);
        await expect(dialog.getByTestId('workspace-file-text')).toHaveCount(0);

        w.answer.current = () => ok('back online\n');
        await page.keyboard.press('Escape');
        await link(message, 'report.md').click();
        await expect(preview(page, 'report.md').getByTestId('workspace-file-text')).toHaveText('back online');
      });
    }

    test('a failed request or an invalid file answer reads as unavailable without leaking raw errors', async ({ page }) => {
      const w = await world(page, surface.seed([reply('reply', MAIN_TEXT, 10)]));
      w.answer.current = () => ({ status: 500, body: { error: 'ECONNRESET stack trace' } });
      await page.goto(surface.url);
      const message = surface.message(surface.root(page));
      await link(message, 'report.md').click();
      await expect(preview(page, 'report.md').getByTestId('workspace-file-notice')).toHaveText('This file is unavailable right now');
      await expect(page.getByText('ECONNRESET')).toHaveCount(0);

      w.answer.current = () => ok('a\u0000b');
      await page.keyboard.press('Escape');
      await link(message, 'report.md').click();
      await expect(preview(page, 'report.md').getByTestId('workspace-file-notice')).toHaveText('This file is unavailable right now');
    });

    test('adjacent replies link only their own genuine row', async ({ page }) => {
      const p = surface.name === 'task' ? 't' : 'c';
      const rows =
        surface.name === 'task'
          ? [
              toolRow('t0', 9),
              reply('t-first', 'Saved the write-up as first.md', 10),
              reply('t-plain', 'Saved the write-up as shared.md', 11, false),
              reply('t-second', 'Saved the write-up as shared.md and second.md', 12),
              toolRow('t1', 13),
              reply('t-last', 'Saved the write-up as final.md', 14),
            ]
          : [
              reply('c-first', 'Saved the write-up as first.md', 10),
              reply('c-plain', 'Saved the write-up as shared.md', 11, false),
              reply('c-second', 'Saved the write-up as shared.md and second.md', 12),
            ];
      const w = await world(page, surface.seed(rows));
      await page.goto(surface.url);
      const root = surface.root(page);
      if (surface.name === 'task') {
        const summary = root.getByTestId('work-summary');
        if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
      }
      const holder = (text: string) =>
        surface.name === 'Coordinator'
          ? root.getByTestId('chief-reply').filter({ hasText: text })
          : root.locator('[data-slot="work-say"], [data-testid="agent-text"]').filter({ hasText: text });

      await link(holder('as first.md').first(), 'first.md').click();
      expect(w.calls.at(-1)).toMatchObject({ conversation: surface.conversation, message: `${p}-first`, body: { path: 'first.md' } });
      await page.keyboard.press('Escape');

      const plain = holder('as shared.md').filter({ hasNotText: 'second.md' });
      await expect(plain).toContainText('shared.md');
      await expect(links(plain)).toHaveCount(0);

      const second = holder('second.md');
      await expect(links(second)).toHaveText(['shared.md', 'second.md']);
      await link(second, 'shared.md').click();
      expect(w.calls.at(-1)).toMatchObject({ message: `${p}-second`, body: { path: 'shared.md' } });
      await page.keyboard.press('Escape');
      await link(second, 'second.md').click();
      expect(w.calls.at(-1)).toMatchObject({ message: `${p}-second`, body: { path: 'second.md' } });
      await page.keyboard.press('Escape');

      if (surface.name === 'task') {
        await link(root.getByTestId('agent-text'), 'final.md').click();
        expect(w.calls.at(-1)).toMatchObject({ message: 't-last', body: { path: 'final.md' } });
      }
      expect(w.calls.every((call) => call.conversation === surface.conversation)).toBe(true);
    });

    test('at 390px a long path and long lines stay inside the screen', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      const longName = 'docs/quarterly-adoption-report-for-new-installations-2026-11-28-final-final.md';
      const w = await world(page, surface.seed([reply('reply', `Saved the write-up as ${longName}`, 10)]));
      w.answer.current = () => ok(`${'x'.repeat(400)}\n${Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n')}\n`);
      await page.goto(surface.url);
      await link(page, longName).click();
      const dialog = preview(page, longName);
      await expect(dialog.getByTestId('workspace-file-text')).toContainText('line 79');
      const box = await dialog.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
  });
}

test('a Coordinator reply that arrives live links once its row carries the flag', async ({ page }) => {
  const w = await world(page, { coordinator: [reply('early', 'Nothing to open yet', 5)] });
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  await expect(home).toContainText('Nothing to open yet');
  const stream = `/api/conversations/${THREAD.id}/stream`;
  await page.waitForFunction((u) => window.__es.some((es) => es.url.includes(u)), stream);

  const live = reply('live-reply', 'Saved the write-up as live.md', 20);
  w.state.messages = [...w.state.messages, live];
  await page.evaluate(([u, ev]) => window.__es.find((es) => es.url.includes(u as string))?.emit(ev), [stream, { type: 'message', message: live }] as const);
  await link(home, 'live.md').click();
  await expect(preview(page, 'live.md')).toBeVisible();
  expect(w.calls.at(-1)).toMatchObject({ conversation: THREAD.id, message: 'live-reply', body: { path: 'live.md' } });
});

test('the Coordinator keeps its composer draft and pending question in place while a file opens', async ({ page }) => {
  const question: Row = {
    id: 'row-ask-0000000a',
    role: 'assistant',
    createdAt: 20,
    content: JSON.stringify({
      kind: 'ask_user_question',
      requestId: 'ask-0000000a',
      status: 'pending',
      questions: [{ header: 'Publish', question: 'Publish the report now?', options: [{ label: 'Publish' }, { label: 'Hold', recommended: true }] }],
      answers: null,
      provenance: 'watch:todo-1',
    }),
  };
  const w = await world(page, { coordinator: [reply('reply', MAIN_TEXT, 10), question] });
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  const message = SURFACES[1]?.message(home) ?? home;
  const asked = home.getByText('Publish the report now?');
  await expect(asked).toBeVisible();
  const input = home.getByTestId('chief-composer-input');
  await input.fill('half-written follow-up');
  const before = [await rectOf(message), await rectOf(asked)];

  await link(message, 'report.md').click();
  await expect(preview(page, 'report.md').getByTestId('workspace-file-text')).toBeVisible();
  expect([await rectOf(message), await rectOf(asked)]).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(input).toHaveValue('half-written follow-up');
  expect([await rectOf(message), await rectOf(asked)]).toEqual(before);
  expect(w.calls).toHaveLength(1);
});

test('the preview and its notices are localized in Chinese', async ({ page }) => {
  const w = await world(page, { locale: 'zh', coordinator: [reply('reply', MAIN_TEXT, 10)] });
  const pending = gate<Reply>();
  w.answer.current = () => pending.promise;
  await page.goto('/app');
  const message = page.getByTestId('home-c').getByTestId('chief-msg').filter({ hasText: 'Saved the write-up' });
  await link(message, 'report.md').click();
  const dialog = preview(page, 'report.md');
  await expect(dialog).toContainText('正在打开文件…');
  pending.release({ status: 503, body: { status: 'offline' } });
  const seen = new Set<string>();
  const copies = [
    { status: 'offline', http: 503, copy: '这台执行机已离线' },
    { status: 'gone', http: 410, copy: '这个文件已不在该步骤的工作区中' },
    { status: 'unsupported', http: 422, copy: '这个文件无法预览' },
    { status: 'unavailable', http: 404, copy: '暂时无法打开这个文件' },
  ];
  for (const [index, entry] of copies.entries()) {
    if (index > 0) {
      w.answer.current = () => ({ status: entry.http, body: { status: entry.status } });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await link(message, 'report.md').click();
    }
    await expect(preview(page, 'report.md').getByTestId('workspace-file-notice')).toHaveText(entry.copy);
    seen.add(entry.copy);
  }
  expect(seen.size).toBe(4);
});
