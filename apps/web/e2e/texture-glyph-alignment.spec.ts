import { expect, test } from '@playwright/test';

const SCALE = 16;
const PROGRESS_FILLS = ['quarter', 'half', 'three-quarter'];

test('every status glyph and mark sits on the optical centre of its box; a progress fill is centred by its ring', async ({ page }) => {
  await page.goto('/design.html?only=glyph-alignment');
  const cells = page.locator('[data-glyph-cell]');
  await expect(cells.first()).toBeVisible();
  const offsets = await page.evaluate(async (scale) => {
    const out: Record<string, { dx: number; dy: number }> = {};
    for (const cell of document.querySelectorAll<HTMLElement>('[data-glyph-cell]')) {
      const box = cell.querySelector<HTMLElement>('[data-glyph-box]')!;
      const svg = box.querySelector('svg')!;
      const outer = box.getBoundingClientRect();
      const rect = svg.getBoundingClientRect();
      const copy = svg.cloneNode(true) as SVGSVGElement;
      copy.setAttribute('width', String(rect.width * scale));
      copy.setAttribute('height', String(rect.height * scale));
      copy.setAttribute('color', '#000');
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      for (const node of copy.querySelectorAll('*')) node.removeAttribute('class');
      copy.style.cssText = 'stroke-width: initial';
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = outer.width * scale;
      canvas.height = outer.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, (rect.left - outer.left) * scale, (rect.top - outer.top) * scale);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0, sx = 0, sy = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        if (a === 0) continue;
        const p = i / 4;
        sum += a; sx += a * (p % canvas.width); sy += a * Math.floor(p / canvas.width);
      }
      out[cell.dataset.glyphCell ?? ''] = {
        dx: Math.round(((sx / sum + 0.5) / scale - outer.width / 2) * 100) / 100,
        dy: Math.round(((sy / sum + 0.5) / scale - outer.height / 2) * 100) / 100,
      };
    }
    return out;
  }, SCALE);
  const off = Object.entries(offsets).filter(([name, o]) => !PROGRESS_FILLS.includes(name) && Math.abs(o.dx) > 0.5 || Math.abs(o.dy) > 0.5);
  expect(off).toEqual([]);
});
