import { expect, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

for (const theme of ['light', 'dark'] as const) {
  test(`a focused answer owns digits even with a thread panel open (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/app?scenario=home-c&thread=home-c-review');
    const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
    const first = page.getByTestId('chief-question-option-0-0');
    await expect(first).toBeVisible();
    await composer.focus();
    await page.keyboard.press('1');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(composer).toHaveValue('');
    await page.screenshot({ path: testInfo.outputPath(`question-${theme}.png`) });
  });
}

for (const threadPanel of [false, true]) {
  test(`a quoted chat reply keeps its digits with a pending question (thread panel: ${threadPanel})`, async ({ page }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        { id: 'request', role: 'user', content: 'Choose a deployment region', createdAt: 10 },
        {
          id: 'ask', role: 'assistant', createdAt: 11,
          content: JSON.stringify({
            kind: 'ask_user_question', requestId: 'req-quote-digits', status: 'pending', answers: null,
            questions: [{ header: 'Region', question: 'Where should this run?', options: [{ label: 'Europe' }, { label: 'Asia' }] }],
          }),
        },
      ],
    }, (path, _route, json) => path === `/api/todos/${TASK.id}` ? json(TASK) : undefined);
    await page.goto(threadPanel ? `/app?thread=${TASK.id}` : '/app');
    const home = page.getByTestId('home-c');
    const composer = home.getByTestId('chief-composer-input');
    const second = home.getByTestId('chief-question-option-0-1');
    await expect(second).toBeVisible();
    await page.evaluate(() => {
      const source = document.querySelector('[data-reply-source="request"]');
      if (source === null) throw new Error('missing quote source');
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.getByTestId('selection-reply').click();
    await expect(home.getByTestId('composer-reply-quote')).toBeVisible();
    await expect(composer).toBeFocused();
    await page.keyboard.press('2');
    await expect(composer).toHaveValue('2');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await composer.fill('');
    await home.getByTestId('composer-reply-quote-remove').click();
    await composer.focus();
    await page.keyboard.press('2');
    await expect(composer).toHaveValue('');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
  });
}

test('digits respect composition, modifiers, other dialogs, typed answers and ordinary chat', async ({ page }, testInfo) => {
  await mockLive(page, {
    threads: [THREAD],
    todos: [],
    messages: [
      { id: 'request', role: 'user', content: 'Choose a deployment region', createdAt: 10 },
      {
        id: 'ask', role: 'assistant', createdAt: 11,
        content: JSON.stringify({
          kind: 'ask_user_question', requestId: 'req-digits', status: 'pending', answers: null,
          questions: [{ header: 'Region', question: 'Where should this run?', multiSelect: true, options: Array.from({ length: 8 }, (_, i) => ({ label: `Region ${i + 1}` })) }],
        }),
      },
    ],
  });
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  const option = (i: number) => page.getByTestId(`chief-question-option-0-${i}`);
  await expect(option(0)).toBeVisible();
  await composer.focus();
  for (let n = 1; n <= 8; n++) {
    await page.keyboard.press(String(n));
    for (let i = 0; i < n; i++) await expect(option(i)).toHaveAttribute('aria-pressed', 'true');
    await expect(composer).toHaveValue('');
  }
  for (let n = 1; n <= 8; n++) await page.keyboard.press(String(n));
  await page.keyboard.press('1');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(option(0)).toBeVisible();
    await composer.focus();
    await page.keyboard.press('1');
    await expect(option(0)).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('chief-composer-block').screenshot({ path: testInfo.outputPath(`generic-question-${theme}.png`) });
  }
  for (let n = 1; n <= 8; n++) {
    const shiftedDigit = { key: String(n), code: `Digit${n}`, shiftKey: true };
    const initiallySelected = n === 1;
    await composer.dispatchEvent('keydown', shiftedDigit);
    await expect(option(n - 1)).toHaveAttribute('aria-pressed', String(!initiallySelected));
    await expect(composer).toHaveValue('');
    await composer.dispatchEvent('keydown', shiftedDigit);
    await expect(option(n - 1)).toHaveAttribute('aria-pressed', String(initiallySelected));
  }
  await composer.dispatchEvent('keydown', { key: '2', code: 'Numpad2' });
  await expect(option(1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('2');
  for (const event of [
    { key: '2', isComposing: true },
    { key: '2', keyCode: 229 },
    { key: '2', repeat: true },
    { key: '@', code: 'Digit2', shiftKey: true },
    { key: 'é', code: 'Digit2' },
    { key: '2', ctrlKey: true },
    { key: '2', metaKey: true },
    { key: '2', altKey: true },
    { key: '2abc' },
  ]) {
    await composer.dispatchEvent('keydown', event);
    await expect(option(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(option(1)).toHaveAttribute('aria-pressed', 'false');
  }
  await composer.fill('Prefer region ');
  await page.keyboard.press('2');
  await expect(composer).toHaveValue('Prefer region 2');
  await composer.fill('');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('');
  await page.keyboard.press('2');
  await expect(dialog.getByRole('textbox')).toHaveValue('2');
  await expect(option(1)).toHaveAttribute('aria-pressed', 'false');
});
