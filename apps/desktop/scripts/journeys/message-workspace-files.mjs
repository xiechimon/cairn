import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startStubProvider, useAsCoordinatorModel } from '../coordinator-journey-model.mjs';

// Real in the packaged app: the Coordinator turn (stub model provider -> real
// Coordinator -> real persisted reply), the Coordinator transcript UI, and the
// click on the real `message-file-link` button.
//
// MOCK BOUNDARY (Playwright interception, nothing else is faked):
//  1. GET /api/conversations/<thread>/messages: the real response is passed
//     through, but the real reply row gets `workspaceFileLinks: true`. The
//     server only stamps that flag when the row has a Runner file source, and a
//     packaged walk has no Runner with a step workspace.
//  2. POST /api/conversations/<thread>/messages/<row>/file: answered by this
//     script in place of the Runner-backed workspace read, with the same wire
//     shapes routes-message-files.ts returns. Server-side behaviour is covered
//     by apps/server/test/message-file-open.test.ts.
const FILE = 'report.md';
const FILE_TEXT = '<b>Quarterly</b> adoption report\n# Not a heading\n';
const REPLY = `Saved the write-up as ${FILE} in the step workspace.`;
const MESSAGES = /^\/api\/conversations\/[^/]+\/messages$/;
const FILE_ROUTE = /^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/file$/;

function replyChunks(request) {
  const isTurn = (request.tools?.length ?? 0) > 0;
  const text = {
    choices: [{ index: 0, delta: { role: 'assistant', content: isTurn ? REPLY : '' } }],
  };
  const stop = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  const usage = { prompt_tokens: 12_000, completion_tokens: 12, total_tokens: 12_012 };
  return isTurn ? [text, stop, { choices: [], usage }] : [text, stop];
}

async function interceptWorkspaceFiles(window, answer, calls) {
  await window.route(
    (url) => /^\/api\/conversations\//.test(url.pathname),
    async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const file = FILE_ROUTE.exec(pathname);
      if (file !== null && request.method() === 'POST') {
        calls.push({ conversation: file[1], message: file[2], body: request.postDataJSON() });
        const { status, body } = answer.current;
        return route.fulfill({
          status,
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          body: JSON.stringify(body),
        });
      }
      if (request.method() !== 'GET' || !MESSAGES.test(pathname)) return route.fallback();
      const response = await route.fetch();
      const json = await response.json();
      if (!Array.isArray(json?.messages)) return route.fulfill({ response, json });
      const messages = json.messages.map((row) => {
        const mentionsFile =
          typeof row.content === 'string'
            ? row.content.includes(FILE)
            : Array.isArray(row.content) &&
              row.content.some((block) => block?.type === 'text' && block.text?.includes(FILE));
        return row.role === 'assistant' && mentionsFile
          ? { ...row, workspaceFileLinks: true, workspaceFilePaths: [FILE] }
          : row;
      });
      return route.fulfill({ response, json: { ...json, messages } });
    },
  );
}

export default async function messageWorkspaceFiles({ window, mode, evidenceDir }) {
  const provider = await startStubProvider(replyChunks);
  const calls = [];
  const answer = { current: { status: 200, body: { status: 'ok', text: FILE_TEXT } } };
  try {
    await useAsCoordinatorModel(window, provider.url);
    await interceptWorkspaceFiles(window, answer, calls);
    const message = `packaged files ${mode} ${Date.now() % 100000}`;
    await window.goto(new URL('/app', window.url()).toString());
    await window.getByTestId('chief-composer-block').click({ timeout: 30_000 });
    await window.getByTestId('chief-composer-input').first().click();
    await window.keyboard.type(message);
    await window.keyboard.press('Enter');
    await window.getByText(message, { exact: true }).first().waitFor({ timeout: 30_000 });
    await window.getByText(REPLY).first().waitFor({ timeout: 60_000 });

    // Reload so the stamped history row, not the live stream, renders the reply.
    await window.reload();
    const home = window.getByTestId('home-c');
    const link = home.getByTestId('message-file-link');
    await link.first().waitFor({ timeout: 60_000 });
    assert.equal(await link.count(), 1, 'only the one file named in the reply is a link');
    assert.equal((await link.first().innerText()).trim(), FILE);
    assert.deepEqual(calls, [], 'rendering the reply must not read the file');

    const dialog = window.getByRole('dialog', { name: FILE, exact: true });
    await window.getByTestId('message-file-link').click();
    const text = dialog.getByTestId('workspace-file-text');
    await text.waitFor({ timeout: 30_000 });
    assert.equal((await text.innerText()).trim(), FILE_TEXT.trim(), 'preview shows the raw file');
    assert.equal(await dialog.locator('b, h1').count(), 0, 'the preview must not render markup');
    assert.equal(calls.length, 1, 'one click makes one file read');
    assert.equal(calls[0].body.path, FILE);
    await window.screenshot({ path: join(evidenceDir, `${mode}-message-file-preview.png`) });

    await window.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });

    // The Runner no longer has the file: the preview says so and shows no text.
    answer.current = { status: 404, body: { status: 'gone' } };
    await window.getByTestId('message-file-link').click();
    await dialog.getByTestId('workspace-file-notice').waitFor({ timeout: 30_000 });
    assert.equal(
      await dialog.getByTestId('workspace-file-text').count(),
      0,
      'gone file shows text',
    );
    assert.equal(calls.length, 2, 'reopening reads the file again');
    await window.screenshot({ path: join(evidenceDir, `${mode}-message-file-gone.png`) });
    await window.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  } finally {
    provider.close();
  }
}
