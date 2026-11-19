import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidencePanelShot } from './evidence';

const installRow = (result?: string): Row => ({
  id: 'm-install',
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: {
      id: 'c-install',
      name: 'install_packages',
      arguments: { packages: ['ffmpeg', 'libpq-dev'] },
      startedAt: 40,
      ...(result === undefined
        ? {}
        : { endedAt: 50, result: [{ type: 'text', text: result }] }),
    },
  },
  createdAt: 40,
});

async function open(page: Page, row: Row, status = 200) {
  const decisions: unknown[] = [];
  await mockLive(page, { threads: [THREAD], messages: [...HISTORY, row] }, (path, route, json) => {
    if (path !== '/api/computers/package-install') return undefined;
    decisions.push(route.request().postDataJSON());
    return status === 200
      ? json({ ok: true })
      : json({ error: status === 403 ? 'owner session required' : 'No install request' }, status);
  });
  await page.goto('/app');
  const card = page.getByTestId('home-c').getByTestId('chief-package-install');
  await expect(card).toBeVisible();
  return { card, decisions };
}

test.describe('package install approval card in the Coordinator chat', () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test('the card names the packages and approving sends exactly them', async ({ page }) => {
    const { card, decisions } = await open(page, installRow());
    await expect(card).toHaveAttribute('data-outcome', 'waiting');
    await expect(card.getByTestId('approval-card-title')).toHaveText(
      '在 Coordinator 的电脑上安装 ffmpeg 和 libpq-dev',
    );
    await expect(card.getByTestId('approval-field-value')).toHaveText(/ffmpeg\s*libpq-dev/);
    await card.scrollIntoViewIfNeeded();
    await evidencePanelShot(page, 'package-install-card-waiting.png', card);
    await card.getByTestId('chief-package-install-approve').click();
    await expect(card).toHaveAttribute('data-outcome', 'approved');
    await expect(card.getByTestId('approval-history-text')).toHaveText(
      '正在安装 · 在 Coordinator 的电脑上安装 ffmpeg 和 libpq-dev',
    );
    await expect(card.getByTestId('chief-package-install-approve')).toHaveCount(0);
    expect(decisions).toEqual([{ packages: ['ffmpeg', 'libpq-dev'], decision: 'approve' }]);
  });

  test('declining sends a decline and hides the buttons', async ({ page }) => {
    const { card, decisions } = await open(page, installRow());
    await card.getByTestId('chief-package-install-decline').click();
    await expect(card).toHaveAttribute('data-outcome', 'declined');
    expect(decisions).toEqual([{ packages: ['ffmpeg', 'libpq-dev'], decision: 'decline' }]);
  });

  test('an installed request reads as installed', async ({ page }) => {
    const { card } = await open(
      page,
      installRow('Installed with the owner approval: ffmpeg libpq-dev.\nSetting up ffmpeg'),
    );
    await expect(card).toHaveAttribute('data-outcome', 'installed');
    await expect(card.getByTestId('approval-history-text')).toHaveText(
      '已安装 · 在 Coordinator 的电脑上安装 ffmpeg 和 libpq-dev',
    );
    await expect(card.getByTestId('chief-package-install-approve')).toHaveCount(0);
    await evidencePanelShot(page, 'package-install-card-installed.png', card);
  });

  test('a paired device that is not the owner is told who can approve', async ({ page }) => {
    const { card } = await open(page, installRow(), 403);
    await card.getByTestId('chief-package-install-approve').click();
    await expect(card.getByTestId('approval-card-problem')).toHaveText(
      '只有这台 Cairn 的所有者能批准安装。',
    );
    await expect(card).toHaveAttribute('data-outcome', 'waiting');
  });
});
