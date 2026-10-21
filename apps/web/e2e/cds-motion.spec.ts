import { expect, test } from '@playwright/test';

test('motion tokens and scroll-fade utility land', async ({ page }) => {
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
      snappy: cs.getPropertyValue('--spring-snappy').trim(),
      snappyDur: cs.getPropertyValue('--spring-snappy-dur').trim(),
      durFast: cs.getPropertyValue('--dur-fast').trim(),
      durOverlay: cs.getPropertyValue('--dur-overlay').trim(),
      easePop: cs.getPropertyValue('--ease-pop').trim(),
      retired: ['--spring-bouncy', '--spring-gentle', '--spring-heavy', '--spring-bubble', '--spring-modal', '--dur-drawer', '--ease-snap', '--ease-overshoot'].filter((name) => cs.getPropertyValue(name).trim() !== ''),
      fadeSize: cs.getPropertyValue('--scroll-fade-size').trim(),
      maskStarts: String(mask).startsWith('linear-gradient'),
      animNames,
      icon,
    };
  });

  const toMs = (v: string) => (v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000);
  const bezier = (v: string) => v.replace(/\s/g, '').replace(/(^|[^\d])0\./g, '$1.');
  expect(vals.snappy.startsWith('linear(')).toBe(true);
  expect(toMs(vals.snappyDur)).toBe(380);
  expect(toMs(vals.durFast)).toBe(150);
  expect(toMs(vals.durOverlay)).toBe(200);
  expect(bezier(vals.easePop)).toBe('cubic-bezier(.22,1,.36,1)');
  expect(vals.retired).toEqual([]);
  expect(vals.fadeSize).toBe('28px');
  expect(vals.maskStarts).toBe(true);
  const axis = await page.evaluate(() => {
    const a = document.createElement('div');
    a.className = 'scroll-fade-h';
    const b = document.createElement('div');
    b.className = 'scroll-fade-both';
    document.body.append(a, b);
    const ha = getComputedStyle(a).maskImage || '';
    const hb = getComputedStyle(b).maskImage || '';
    a.remove();
    b.remove();
    return {
      h: String(ha).startsWith('linear-gradient'),
      both: String(hb).includes('linear-gradient') && String(hb).includes(','),
    };
  });
  expect(axis.h).toBe(true);
  expect(axis.both).toBe(true);
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
    el.className = 'optical-medium';
    el.textContent = 'x';
    document.body.append(el);
    const v = getComputedStyle(el).fontVariationSettings;
    el.remove();
    return v;
  });
  expect(wght.replace(/\s/g, '')).toMatch(/"wght"465|"wght",465/i);
});
