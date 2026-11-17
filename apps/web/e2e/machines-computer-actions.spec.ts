import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive } from './chief-home-mock';
import { evidencePanelShot } from './evidence';

const MACHINE = { id: 'm1', name: 'Mac', online: true, kind: 'local', runningSteps: 0 };

type Download = { state: string; doneBytes: number; totalBytes: number } | null;
const TOTAL = 1_453_613_041;

const computer = (kind: 'host' | 'vm', download: Download = null) => ({
  id: 'comp-1',
  scopeKey: 'chief:u1',
  state: 'running',
  controlHolder: 'none',
  browserEnabled: true,
  handoffReason: null,
  kind,
  download,
  machine: { id: 'm1', name: 'Mac', online: true },
});

async function open(
  page: Page,
  kind: 'host' | 'vm',
  answer: (action: string) => unknown,
  download: () => Download = () => null,
) {
  const actions: string[] = [];
  await mockLive(
    page,
    { threads: [], messages: HISTORY, machines: [MACHINE] },
    (path, route, json) => {
      if (path === '/api/computers' && route.request().method() === 'GET')
        return json({ computers: [computer(kind, download())] });
      if (path === '/api/computers/comp-1/commands') return json({ commands: [] });
      if (path === '/api/teams/t1/computers/comp-1/screen')
        return json({ error: 'the computer is not connected' }, 409);
      if (path === '/api/computers/comp-1/actions') {
        const { action } = route.request().postDataJSON() as { action: string };
        actions.push(action);
        const result = answer(action);
        return typeof result === 'number'
          ? json({ error: 'The computer home could not be deleted' }, result)
          : json(result);
      }
      return undefined;
    },
  );
  await page.goto('/app?pane=machines');
  const panel = page.getByRole('complementary', { name: '电脑' });
  return { panel, actions };
}

test.describe('Coordinator computer actions menu', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a host computer has no actions menu', async ({ page }) => {
    const { panel } = await open(page, 'host', () => ({ outcome: 'stopped' }));
    await expect(panel.getByTestId('machine-card')).toBeVisible();
    await expect(panel.getByTestId('computer-actions')).toHaveCount(0);
  });

  for (const [action, outcome, text] of [
    ['stop', 'stopped', '电脑已停止，文件都还在，下次使用时会自动启动。'],
    ['update', 'current', '电脑已经是最新版本。'],
    ['update', 'updated', '电脑已更新到最新版本，文件都还在。'],
    ['recover', 'recovered', '电脑已恢复，文件都还在。'],
  ] as const)
    test(`${action} answering ${outcome} says so under the computer`, async ({ page }) => {
      const { panel, actions } = await open(page, 'vm', () => ({ outcome }));
      await panel.getByTestId('computer-actions').click();
      await page.getByTestId(`computer-action-${action}`).click();
      await expect(panel.getByTestId('computer-action-note')).toHaveText(text);
      expect(actions).toEqual([action]);
    });

  test('reset asks first, names what is lost, and runs only after confirming', async ({ page }) => {
    const { panel, actions } = await open(page, 'vm', () => ({ outcome: 'reset' }));
    await panel.getByTestId('computer-actions').click();
    await evidencePanelShot(page, 'computer-actions-menu.png', panel);
    await page.getByTestId('computer-action-reset').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByTestId('computer-reset-loss')).toContainText('文件和浏览器登录都会删除');
    await evidencePanelShot(page, 'computer-reset-confirm.png', dialog);
    await dialog.getByRole('button', { name: '取消' }).click();
    expect(actions).toEqual([]);
    await panel.getByTestId('computer-actions').click();
    await page.getByTestId('computer-action-reset').click();
    await page.getByRole('alertdialog').getByRole('button', { name: '重置' }).click();
    await expect(panel.getByTestId('computer-action-note')).toHaveText(
      '电脑已重置，现在是一台全新的电脑。',
    );
    expect(actions).toEqual(['reset']);
  });

  test('a Linux VM not yet downloaded offers its download where the screen goes, then shows progress', async ({
    page,
  }) => {
    let download: Download = { state: 'absent', doneBytes: 0, totalBytes: TOTAL };
    const { panel, actions } = await open(
      page,
      'vm',
      () => {
        download = { state: 'downloading', doneBytes: 580_000_000, totalBytes: TOTAL };
        return new Promise(() => {});
      },
      () => download,
    );
    const surface = panel.getByTestId('vm-download');
    await expect(surface).toHaveAttribute('data-state', 'absent');
    await expect(surface).toContainText('1.5 GB');
    await expect(panel.getByTestId('machine-screen')).toHaveCount(0);
    await expect(panel.getByTestId('computer-actions')).toHaveCount(0);
    await surface.getByTestId('vm-download-start').click();
    await expect(surface).toHaveAttribute('data-state', 'downloading');
    await page.reload();
    await expect(panel.getByTestId('vm-download')).toContainText('580 MB / 1.5 GB');
    await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(actions).toEqual(['install']);
  });

  test('a failed Linux VM download says so in place and offers a retry', async ({ page }) => {
    const { panel } = await open(
      page,
      'vm',
      () => ({ outcome: 'installed' }),
      () => ({ state: 'failed', doneBytes: 0, totalBytes: TOTAL }),
    );
    const surface = panel.getByTestId('vm-download');
    await expect(surface).toContainText('下载没完成');
    await expect(surface.getByTestId('vm-download-start')).toHaveText('重试');
  });

  test('a failed action shows a plain sentence, not the raw error', async ({ page }) => {
    const { panel } = await open(page, 'vm', () => 409);
    await panel.getByTestId('computer-actions').click();
    await page.getByTestId('computer-action-recover').click();
    const note = panel.getByTestId('computer-action-note');
    await expect(note).toHaveText('没能恢复电脑，请稍后重试。');
    await expect(note).toHaveAttribute('data-note', 'failed');
  });
});
