import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidencePanelShot } from './evidence';

const SENTINEL = 'cloak-sentinel-7f3a9c2e-license';
const REJECTED = 'computer error: CloakBrowser license denied or unavailable (the action did not run)';

const licenseRow = (reason: string): Row => ({
  id: 'm-license',
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: {
      id: 'c-license',
      name: 'request_cloak_license',
      arguments: { reason },
      startedAt: 40,
    },
  },
  createdAt: 40,
});

async function open(page: Page, reason: string, status = 200) {
  const saves: unknown[] = [];
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await mockLive(page, { threads: [THREAD], messages: [...HISTORY, licenseRow(reason)] }, (path, route, json) => {
    if (path !== '/api/teams/t1/cloak-license') return undefined;
    if (route.request().method() !== 'PUT') return json({ error: 'method' }, 405);
    saves.push(route.request().postDataJSON());
    return status === 200
      ? json({ name: 'CLOAKBROWSER_LICENSE_KEY' })
      : json({ error: 'Only the instance owner can save the CloakBrowser license' }, status);
  });
  await page.goto('/app');
  const card = page.getByTestId('home-c').getByTestId('chief-cloak-license');
  await expect(card).toBeVisible();
  return { card, saves, urls };
}

test.describe('CloakBrowser license card in the Coordinator chat', () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test('the owner pastes the key, saves it, and the card shows only the secret name', async ({
    page,
  }) => {
    const { card, saves, urls } = await open(page, '要打开 BOSS直聘，隐身浏览器还没有许可证。');
    await expect(card).toHaveAttribute('data-outcome', 'waiting');
    await expect(card).toContainText('需要 CloakBrowser 许可证');
    await expect(card).toContainText('要打开 BOSS直聘，隐身浏览器还没有许可证。');
    await expect(card.getByTestId('chief-cloak-license-get')).toHaveAttribute(
      'href',
      'https://cloakbrowser.dev',
    );
    const input = card.getByTestId('chief-cloak-license-input');
    await expect(input).toHaveAttribute('type', 'password');
    const save = card.getByTestId('chief-cloak-license-save');
    await expect(save).toBeDisabled();
    await input.fill(`  ${SENTINEL}  `);
    await card.scrollIntoViewIfNeeded();
    await evidencePanelShot(page, 'cloak-license-card-waiting.png', card);
    await save.click();
    await expect(card).toHaveAttribute('data-outcome', 'saved');
    await expect(card.getByTestId('chief-cloak-license-saved')).toContainText(
      'CLOAKBROWSER_LICENSE_KEY',
    );
    await expect(card.getByTestId('chief-cloak-license-input')).toHaveCount(0);
    expect(saves).toEqual([{ value: SENTINEL }]);
    expect(await page.content()).not.toContain(SENTINEL);
    expect(urls.filter((url) => url.includes(SENTINEL))).toEqual([]);
    await evidencePanelShot(page, 'cloak-license-card-saved.png', card);
  });

  test('a rejected key shows the CloakBrowser reason and asks again', async ({ page }) => {
    const { card } = await open(page, REJECTED);
    await expect(card).toContainText('CloakBrowser license denied or unavailable');
    await expect(card.getByTestId('chief-cloak-license-input')).toBeVisible();
  });

  test('an oversized key is refused before it is sent', async ({ page }) => {
    const { card, saves } = await open(page, '');
    await card.getByTestId('chief-cloak-license-input').fill('x'.repeat(513));
    await card.getByTestId('chief-cloak-license-save').click();
    await expect(card.getByTestId('chief-cloak-license-problem')).toHaveText(
      '许可证不能为空，不能超过 512 个字符，也不能带换行。',
    );
    expect(saves).toEqual([]);
  });

  test('a paired device that is not the owner is told who can save', async ({ page }) => {
    const { card } = await open(page, '', 403);
    await card.getByTestId('chief-cloak-license-input').fill(SENTINEL);
    await card.getByTestId('chief-cloak-license-save').click();
    await expect(card.getByTestId('chief-cloak-license-problem')).toHaveText(
      '只有这台 Cairn 的所有者能保存许可证。',
    );
    await expect(card).toHaveAttribute('data-outcome', 'waiting');
  });
});
