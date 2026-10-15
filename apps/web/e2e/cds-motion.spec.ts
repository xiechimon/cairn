import { expect, test } from '@playwright/test';

test('CDS spring tokens and scroll-fade utility land', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
  await page.goto('/app?scenario=01');
  await page.waitForSelector('.board-sidebar');

  const vals = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.className = 'scroll-fade';
    probe.style.cssText = 'position:fixed;inset:0;overflow:auto;height:120px';
    probe.innerHTML =
      '<div style="height:400px"></div><span class="icon-baseline"></span><span class="icon-baseline-sm"></span>';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const mask = style.maskImage || style.getPropertyValue('mask-image') || '';
    const icon = getComputedStyle(probe.querySelector('.icon-baseline') as Element).verticalAlign;
    const animNames: Record<string, string> = {};
    for (const cls of ['anim-message-fade-up', 'anim-saved-check', 'anim-grapheme-reveal']) {
      const el = document.createElement('div');
      el.className = cls;
      document.body.append(el);
      animNames[cls] = getComputedStyle(el).animationName;
      el.remove();
    }
    probe.remove();
    return {
      bouncy: cs.getPropertyValue('--spring-bouncy').trim(),
      snappyDur: cs.getPropertyValue('--spring-snappy-dur').trim(),
      gentleDur: cs.getPropertyValue('--spring-gentle-dur').trim(),
      heavyDur: cs.getPropertyValue('--spring-heavy-dur').trim(),
      bubble: cs.getPropertyValue('--spring-bubble').trim(),
      fadeSize: cs.getPropertyValue('--scroll-fade-size').trim(),
      maskStarts: String(mask).startsWith('linear-gradient'),
      animNames,
      icon,
    };
  });

  expect(vals.bouncy.startsWith('linear(')).toBe(true);
  expect(vals.bubble.startsWith('linear(')).toBe(true);
  expect(Number.parseFloat(vals.snappyDur)).toBeGreaterThan(0);
  expect(Number.parseFloat(vals.gentleDur)).toBeGreaterThan(0);
  expect(Number.parseFloat(vals.heavyDur)).toBeGreaterThan(0);
  expect(vals.fadeSize).toBe('28px');
  expect(vals.maskStarts).toBe(true);
  expect(vals.animNames['anim-message-fade-up']).toContain('message-fade-up');
  expect(vals.animNames['anim-saved-check']).toContain('saved-check-decay');
  expect(vals.animNames['anim-grapheme-reveal']).toContain('grapheme-reveal');
  expect(vals.icon).toMatch(/^-?(0\.125em|1\.75px)$/);
});

test('dark optical weight compensation applies outside .light', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'dark'));
  await page.goto('/app?scenario=01');
  await page.waitForSelector('.board-sidebar');
  const wght = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'font-medium';
    el.textContent = 'x';
    document.body.append(el);
    const v = getComputedStyle(el).fontVariationSettings;
    el.remove();
    return v;
  });
  expect(wght.replace(/\s/g, '')).toMatch(/"wght"465|"wght",465/i);
});
