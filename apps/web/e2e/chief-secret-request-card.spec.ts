import { SECRET_REQUEST_CANCELLED, SECRET_REQUEST_NOT_SAVED } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidencePanelShot } from './evidence';

const SENTINEL = 'sk-live-sentinel-5384-b7c1e9f04a';
const NAME = 'CLOAKBROWSER_LICENSE_KEY';
const DESCRIPTION = '要打开 BOSS直聘，隐身浏览器需要 CloakBrowser 许可证，在 cloakbrowser.dev 免费领取。';

const requestRow = (result?: string, args: Record<string, unknown> = {}): Row => ({
  id: 'm-secret',
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: {
      id: 'c-secret',
      name: 'request_secret',
      arguments: { name: NAME, scope: 'team', description: DESCRIPTION, ...args },
      startedAt: 40,
      ...(result === undefined
        ? {}
        : { endedAt: 50, result: [{ type: 'text', text: result }] }),
    },
  },
  createdAt: 40,
});

async function open(
  page: Page,
  opts: { row?: Row; status?: number; secrets?: unknown[] } = {},
) {
  const answers: unknown[] = [];
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await mockLive(
    page,
    { threads: [THREAD], messages: [...HISTORY, opts.row ?? requestRow()] },
    (path, route, json) => {
      if (path === '/api/teams/t1/secrets') return json(opts.secrets ?? []);
      if (path !== '/api/teams/t1/secret-requests') return undefined;
      if (route.request().method() !== 'POST') return json({ error: 'method' }, 405);
      answers.push(route.request().postDataJSON());
      const status = opts.status ?? 200;
      return status === 200 ? json({ name: NAME }) : json({ error: 'refused' }, status);
    },
  );
  await page.goto('/app');
  const card = page.getByTestId('home-c').getByTestId('chief-secret-request');
  await expect(card).toBeVisible();
  return { card, answers, urls };
}

test.describe('secret card in the Coordinator chat', () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test('pending: the owner pastes the value and saves; only the name comes back', async ({
    page,
  }) => {
    const { card, answers, urls } = await open(page);
    await expect(card).toHaveAttribute('data-outcome', 'waiting');
    await expect(card).toContainText(`提供密钥 ${NAME}`);
    await expect(card).toContainText(DESCRIPTION);
    await expect(card).toContainText('加密保存为团队密钥，Coordinator 看不到原文');
    const input = card.getByTestId('chief-secret-request-input');
    await expect(input).toHaveAttribute('type', 'password');
    await input.fill(`  ${SENTINEL}  `);
    await evidencePanelShot(page, 'secret-request-card-pending.png', card);
    await input.press('Enter');
    await expect(card).toHaveAttribute('data-outcome', 'saved');
    await expect(card).toContainText(`已保存 · 提供密钥 ${NAME}`);
    await expect(card.getByTestId('chief-secret-request-input')).toHaveCount(0);
    expect(answers).toEqual([{ decision: 'save', name: NAME, projectId: null, value: SENTINEL }]);
    expect(await page.content()).not.toContain(SENTINEL);
    expect(urls.filter((url) => url.includes(SENTINEL))).toEqual([]);
    await evidencePanelShot(page, 'secret-request-card-saved.png', card);
  });

  test('cancelled: Not now ends the request without a value', async ({ page }) => {
    const { card, answers } = await open(page);
    await card.getByTestId('chief-secret-request-cancel').click();
    await expect(card).toHaveAttribute('data-outcome', 'cancelled');
    await expect(card).toContainText('没有提供');
    expect(answers).toEqual([{ decision: 'cancel', name: NAME, projectId: null }]);
  });

  test('settled rows from history show the cancelled and failed lines', async ({ page }) => {
    for (const [text, outcome, line] of [
      [SECRET_REQUEST_CANCELLED, 'cancelled', '没有提供'],
      [SECRET_REQUEST_NOT_SAVED, 'failed', '请求已结束'],
    ] as const) {
      const { card } = await open(page, { row: requestRow(text) });
      await expect(card).toHaveAttribute('data-outcome', outcome);
      await expect(card).toContainText(line);
      await expect(card.getByTestId('chief-secret-request-input')).toHaveCount(0);
      if (outcome === 'failed') await evidencePanelShot(page, 'secret-request-card-failed.png', card);
    }
  });

  test('a project request with an existing secret says it replaces the value', async ({ page }) => {
    const { card } = await open(page, {
      row: requestRow(undefined, { scope: 'project', projectId: 'p1' }),
      secrets: [{ id: 's1', teamId: 't1', projectId: 'p1', name: NAME, description: null }],
    });
    await expect(card).toContainText('，会替换现有的值');
  });

  test('invalid, ended and not-owner answers keep the card pending with a reason', async ({
    page,
  }) => {
    const { card, answers } = await open(page, { status: 409 });
    await card.getByTestId('chief-secret-request-input').fill('x'.repeat(4097));
    await card.getByTestId('chief-secret-request-save').click();
    await expect(card.getByTestId('approval-card-problem')).toHaveText(
      '值不能为空，不能超过 4096 个字符，也不能带换行。',
    );
    expect(answers).toEqual([]);
    await card.getByTestId('chief-secret-request-input').fill(SENTINEL);
    await card.getByTestId('chief-secret-request-save').click();
    await expect(card.getByTestId('approval-card-problem')).toHaveText('这个请求已经结束。');
    await expect(card).toHaveAttribute('data-outcome', 'waiting');

    const owner = await open(page, { status: 403 });
    await owner.card.getByTestId('chief-secret-request-input').fill(SENTINEL);
    await owner.card.getByTestId('chief-secret-request-save').click();
    await expect(owner.card.getByTestId('approval-card-problem')).toHaveText(
      '只有这台 Cairn 的所有者能保存密钥。',
    );
  });
});
