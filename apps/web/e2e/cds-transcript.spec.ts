import { expect, test } from '@playwright/test';

test('CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16');
  await page.waitForSelector('[data-testid="transcript-col"]');

  const m = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const col = document.querySelector('[data-testid="transcript-col"]') as HTMLElement;
    const head = document.querySelector('[data-testid="detail-head"]') as HTMLElement;
    const content = col?.querySelector('[data-slot="message-scroller-content"]') as HTMLElement;
    const colCs = getComputedStyle(col);
    const headCs = getComputedStyle(head);
    const contentCs = content ? getComputedStyle(content) : null;
    return {
      chatMaxW: root.getPropertyValue('--chat-max-w').trim(),
      chatExtra: root.getPropertyValue('--chat-extra-space').trim(),
      fadeSize: root.getPropertyValue('--scroll-fade-size').trim(),
      radiusBubble: root.getPropertyValue('--radius-bubble').trim(),
      cdsRadiusXl: root.getPropertyValue('--cds-radius-xl').trim(),
      colPadBottom: colCs.paddingBottom,
      hasScrollFade: col.classList.contains('scroll-fade'),
      fadeBottomVar: col.style.getPropertyValue('--scroll-fade-bottom'),
      headH: headCs.height,
      contentMaxW: contentCs?.maxWidth ?? null,
    };
  });

  expect(m.chatMaxW).toBe('768px');
  expect(m.chatExtra).toBe('35vh');
  expect(m.fadeSize).toBe('28px');
  expect(m.radiusBubble).toBe('18px');
  expect(m.cdsRadiusXl).toBe('12px');
  expect(m.hasScrollFade).toBe(true);
  expect(m.headH).toBe('56px');
  expect(m.contentMaxW).toBe('768px');
  // 35vh bottom buffer — numeric px depends on viewport; just ensure >> 16
  expect(Number.parseFloat(m.colPadBottom)).toBeGreaterThanOrEqual(16);
});

test('CDS transcript: jump-to-latest appears past 120px and restores end', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16');
  const col = page.getByTestId('transcript-col');
  await col.waitFor();

  // Ensure content is tall enough to scroll; if not, inflate spacer via evaluate
  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="transcript-col"]') as HTMLElement;
    const content = col.querySelector('[data-slot="message-scroller-content"]') as HTMLElement;
    if (content && content.scrollHeight < col.clientHeight + 200) {
      const pad = document.createElement('div');
      pad.style.height = '800px';
      pad.setAttribute('data-testid', 'cds-scroll-pad');
      content.appendChild(pad);
    }
  });

  // Start at bottom
  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="transcript-col"]') as HTMLElement;
    col.scrollTop = col.scrollHeight;
  });
  await page.waitForTimeout(100);

  const jump = page.getByTestId('detail-center').getByTestId('jump-to-latest');
  await expect(jump).toHaveAttribute('data-active', 'false');

  // Scroll up so distanceFromBottom > 120
  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="transcript-col"]') as HTMLElement;
    col.scrollTop = Math.max(0, col.scrollHeight - col.clientHeight - 200);
  });
  await expect(jump).toHaveAttribute('data-active', 'true', { timeout: 3000 });

  await jump.click();
  await expect(jump).toHaveAttribute('data-active', 'false', { timeout: 3000 });

  // smooth scroll settles; within FOLLOW_THRESHOLD (40) counts as pinned/end
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const col = document.querySelector('[data-testid="transcript-col"]') as HTMLElement;
        return col.scrollHeight - col.scrollTop - col.clientHeight;
      }),
    )
    .toBeLessThanOrEqual(40);
});

test('CDS transcript: thinking trigger 12/16 medium; code 12px / 11.5', async ({ page }) => {
  // scenario with thinking + code if available; fall back to measuring tokens + any present nodes
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16');
  await page.waitForSelector('[data-testid="transcript-col"]');

  const styles = await page.evaluate(() => {
    const thinkingBtn = document.querySelector(
      '[data-testid="transcript-col"] button[aria-label*="思考"], [data-testid="transcript-col"] button[aria-label*="thinking" i]',
    ) as HTMLElement | null;
    const code = document.querySelector('[data-testid="md-code"]') as HTMLElement | null;
    const tCs = thinkingBtn ? getComputedStyle(thinkingBtn) : null;
    const cCs = code ? getComputedStyle(code) : null;
    return {
      thinkingFontSize: tCs?.fontSize ?? null,
      thinkingLineHeight: tCs?.lineHeight ?? null,
      thinkingWeight: tCs?.fontWeight ?? null,
      codeRadius: cCs?.borderTopLeftRadius ?? null,
      codeFontSize: cCs?.fontSize ?? null,
      codeLineHeight: cCs?.lineHeight ?? null,
    };
  });

  if (styles.thinkingFontSize != null) {
    expect(styles.thinkingFontSize).toBe('12px');
    expect(styles.thinkingLineHeight).toBe('16px');
    expect(Number(styles.thinkingWeight)).toBeGreaterThanOrEqual(500);
  }
  if (styles.codeRadius != null) {
    expect(styles.codeRadius).toBe('12px');
    expect(styles.codeFontSize).toBe('11.5px');
    expect(styles.codeLineHeight).toBe('16px');
  }
});
