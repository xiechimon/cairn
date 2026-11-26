import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const SHOT_DIR = '/Users/xmon/Pictures/cairn-review/copy-as-markdown';

async function saveShot(page: Page, name: string) {
  if (process.env.CI || process.platform !== 'darwin') return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}` });
}

test('research report copies exact raw Markdown, confirms copied state, and works in light and dark', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = [
    '# Research Summary',
    '',
    'Parquet halves the size of [CSV](https://example.com/csv).',
    '',
    '- Keeps schema types',
    '- Supports predicate pushdown',
    '',
    '```sql',
    "COPY events TO 'events.parquet';",
    '```',
  ].join('\n');
  const research = {
    ...TASK,
    id: 'todo-research-copy',
    seqNum: 33,
    title: 'Storage format comparison',
    phase: 'done',
    output: 'info',
    latestBuildId: 'build-research-copy',
  };
  const report = {
    id: 'info-report-build-research-copy',
    role: 'system',
    createdAt: 30,
    content: JSON.stringify({
      kind: 'info-report',
      attachmentId: 'att-research-copy',
      attachmentToken: '![report.md](attachment:t1/att-research-copy.md)',
      content: source,
    }),
  };
  await mockLive(page, { threads: [THREAD], messages: [], todos: [research] }, (path, route, json) =>
    path === '/api/conversations/build-research-copy/messages'
      ? json({ messages: [report], chips: null, historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null })
      : path === '/api/attachments/att-research-copy'
        ? route.fulfill({ status: 200, contentType: 'text/markdown; charset=utf-8', body: source })
        : undefined,
  );

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/app?pane=made');
  await page
    .getByRole('complementary', { name: '成果' })
    .getByRole('button', { name: 'Storage format comparison' })
    .click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel = page.getByTestId('artifact-panel');
  const copy = panel.getByTestId('artifact-copy');
  await expect(copy).toHaveAccessibleName('复制为 Markdown');
  await saveShot(page, 'research-report-light.png');

  await copy.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制为 Markdown');

  await copy.click();
  await expect(copy).toHaveAttribute('data-copied', '');
  await expect(copy).toHaveAccessibleName('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);

  await page.emulateMedia({ colorScheme: 'dark' });
  await saveShot(page, 'research-report-dark.png');
});

test('markdown file artifact labels preview copy as Copy as Markdown and copies raw source', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(
    '/app?scenario=chief-files-markdown&artifact=team-files/att-release-notes.md&artifactName=release-notes.md',
  );

  const panel = page.getByTestId('artifact-panel');
  await expect(panel.getByTestId('file-preview-markdown')).toBeVisible();
  const copy = panel.getByTestId('artifact-copy');
  await expect(copy).toHaveAccessibleName('复制为 Markdown');
  await copy.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制为 Markdown');
  await saveShot(page, 'artifact-markdown-light.png');

  await copy.click();
  await expect(copy).toHaveAttribute('data-copied', '');
  await expect(copy).toHaveAccessibleName('已复制');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('# 发布检查清单');
  expect(copied).toContain('- 跑完 `pnpm prepush`');
  expect(copied).toContain('[发布流程](https://example.com/release)');
  expect(copied).toContain('```sh');

  await page.emulateMedia({ colorScheme: 'dark' });
  await saveShot(page, 'artifact-markdown-dark.png');

  await panel.getByTestId('artifact-mode-source').click();
  await expect(copy).toHaveAccessibleName('复制');
});

test('task plan dialog copies exact raw Markdown from dialog head beside close', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const planSource = [
    '# Rollout Plan',
    '',
    '## Changes',
    '- Update [guide](https://example.com/guide)',
    '- Run `pnpm typecheck` before landing',
    '',
    '```bash',
    'pnpm --filter @cairn/web test',
    '```',
  ].join('\n');
  const todo = {
    ...TASK,
    id: 'todo-plan-copy',
    seqNum: 41,
    title: 'Implement Markdown copy',
    phase: 'confirm',
    hasPlan: true,
    latestBuildId: 'build-plan-copy',
  };
  await mockLive(page, { threads: [THREAD], messages: [], todos: [todo] }, (path, _route, json) => {
    if (path === '/api/todos/todo-plan-copy') return json(todo);
    if (path === '/api/builds/build-plan-copy') {
      return json({
        id: 'build-plan-copy',
        todoId: todo.id,
        withPlan: true,
        prevPhase: 'todo',
        triggerSource: 'user',
        planDocId: 'plan-copy-1',
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        diffHash: null,
        reportAttachmentId: null,
        createdAt: 1,
      });
    }
    if (path === '/api/builds/build-plan-copy/steps') return json([]);
    if (path === '/api/builds/build-plan-copy/changes') return json({ files: [], reported: true });
    if (path === '/api/builds/build-plan-copy/usage') return json([]);
    if (path === '/api/builds/build-plan-copy/plans') {
      return json([
        {
          id: 'plan-copy-1',
          buildId: 'build-plan-copy',
          version: 1,
          content: planSource,
          stepId: 'step-plan-1',
          createdAt: 1,
        },
      ]);
    }
    return undefined;
  });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/app?pane=tasks&thread=todo-plan-copy');
  await page.getByRole('button', { name: '查看计划' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel = page.getByTestId('artifact-panel');
  await expect(panel.getByTestId('research-report-meta')).toHaveText('计划');
  await expect(panel.getByTestId('research-report-doc')).toContainText('Rollout Plan');
  const copy = panel.getByTestId('artifact-copy');
  await expect(copy).toBeVisible();
  await expect(copy).toHaveText('');
  await expect(copy).toHaveAccessibleName('复制为 Markdown');

  await copy.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制为 Markdown');
  await saveShot(page, 'plan-dialog-light.png');

  await copy.click();
  await expect(copy).toHaveAttribute('data-copied', '');
  await expect(copy).toHaveAccessibleName('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(planSource);

  await page.emulateMedia({ colorScheme: 'dark' });
  await saveShot(page, 'plan-dialog-dark.png');
});
