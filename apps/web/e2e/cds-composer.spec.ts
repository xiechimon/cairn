import { expect, test } from '@playwright/test';

test('CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16');
  await page.waitForSelector('[data-testid="composer-card"]');

  const m = await page.locator('[data-testid="composer-card"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--shadow-composer)';
    document.body.appendChild(probe);
    const composerShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    const root = getComputedStyle(document.documentElement);
    const send = el.querySelector('.composer-send');
    const sendCs = send ? getComputedStyle(send) : null;
    const bubble = document.querySelector('[data-testid="user-bubble"]');
    const bubbleCs = bubble ? getComputedStyle(bubble) : null;
    return {
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
      shadow: cs.boxShadow,
      composerShadow,
      radiusComposer: root.getPropertyValue('--radius-composer').trim(),
      composerMaxH: root.getPropertyValue('--composer-max-h').trim(),
      sendRadius: sendCs?.borderTopLeftRadius ?? '',
      bubbleAnim: bubbleCs?.animationName ?? '',
    };
  });

  expect(m.radiusComposer).toBe('20px');
  expect(m.radius).toBe('20px');
  expect(m.border).toBe('0px');
  expect(m.composerMaxH).toBe('384px');
  expect(m.shadow).not.toBe('none');
  expect(m.shadow).toContain('0px 0px 0px 1px');
  expect(m.composerShadow).toContain('0px 0px 0px 1px');
  expect(m.sendRadius).toBe('8px');
  expect(m.bubbleAnim).toContain('message-fade-up');
});
