import { expect, test } from '@playwright/test';

test('detail composer: 26px radius (#1268 dsh), card-lift, round send, 384 max-h', async ({
  page,
}) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16');
  await page.waitForSelector('[data-testid="composer-card"]');

  const m = await page.locator('[data-testid="composer-card"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--card-lift)';
    document.body.appendChild(probe);
    const cardLiftShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    const root = getComputedStyle(document.documentElement);
    const send = el.querySelector('.composer-send');
    const sendCs = send ? getComputedStyle(send) : null;
    const sendBox = send?.getBoundingClientRect();
    return {
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
      shadow: cs.boxShadow,
      cardLiftShadow,
      radiusComposer: root.getPropertyValue('--radius-composer').trim(),
      composerMaxH: root.getPropertyValue('--composer-max-h').trim(),
      sendWidth: sendBox?.width ?? 0,
      sendHeight: sendBox?.height ?? 0,
      sendRadiusPx: sendCs ? Number.parseFloat(sendCs.borderTopLeftRadius) : 0,
      sendRoundedFull: send?.className.includes('rounded-full') ?? false,
    };
  });

  expect(m.radiusComposer).toBe('26px');
  expect(m.radius).toBe('26px');
  expect(m.border).toBe('0px');
  expect(m.composerMaxH).toBe('384px');
  expect(m.shadow).not.toBe('none');
  expect(m.shadow).toContain('4px 16px');
  expect(m.cardLiftShadow).toContain('4px 16px');
  expect(m.sendWidth).toBe(32);
  expect(m.sendHeight).toBe(32);
  expect(m.sendRoundedFull).toBe(true);
  expect(m.sendRadiusPx).toBeGreaterThanOrEqual(16);
});
