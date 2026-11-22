import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';

const WORKSPACE =
  '~/Library/Application\\ Support/@cairn/desktop/runner/workspaces/01a1f92d-b4be-73f5-affa-3856b9ab42a6';

const shellRow = (n: number, command: string, running = false): Row => ({
  id: `m-mac-${n}`,
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: {
      id: `c-mac-${n}`,
      name: 'user_computer_shell',
      arguments: { command },
      startedAt: 40 + n,
      ...(running ? {} : { result: [{ type: 'text', text: 'ok' }], endedAt: 41 + n }),
    },
  },
  createdAt: 40 + n,
});

const ask: Row = {
  id: 'm-ask',
  role: 'user',
  content: '#2344 现在进展到哪了？卡在哪一步，还要多久？',
  createdAt: 39,
};
const reply: Row = {
  id: 'm-reply',
  role: 'assistant',
  content: [{ type: 'text', text: '#2344 已经过了验收，剩下合并这一步。' }],
  createdAt: 50,
};

test('C26: commands on the Mac leave no row in the Coordinator chat; the reply still shows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      ...HISTORY,
      ask,
      shellRow(0, `cd ${WORKSPACE} && git status -sb`),
      shellRow(1, `cd ${WORKSPACE} && git log -1`),
      reply,
      shellRow(2, `cd ${WORKSPACE} && sed -n 1,94p docs/verify/2344/README.md`, true),
    ],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  await expect(stream).toContainText('剩下合并这一步');
  for (const hidden of ['git status', 'Library', '01a1f92d', 'sed -n', '跑了', '在你的 Mac 上'])
    await expect(stream).not.toContainText(hidden);
  await expect(stream.getByTestId('work-block')).toHaveCount(0);
});
