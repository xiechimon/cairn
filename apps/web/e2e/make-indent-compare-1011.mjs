import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? '/tmp/evidence-1011';
const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(
  async ([drawer, settings]) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    const [id, is] = await Promise.all([load(drawer), load(settings)]);
    const labelH = 56;
    const pad = 24;
    const w = Math.max(id.naturalWidth, is.naturalWidth) + pad * 2;
    const h = labelH * 2 + id.naturalHeight + is.naturalHeight + pad * 3;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111111';
    g.font = '600 30px system-ui, sans-serif';
    g.fillText('抽屉面（总管主模型）行内缩实测 20px', pad, labelH - 14);
    g.drawImage(id, pad, labelH);
    const y2 = labelH + id.naturalHeight + pad + labelH;
    g.fillText('设置面（压缩模型）行内缩实测 12px', pad, y2 - 14);
    g.drawImage(is, pad, y2);
    return c.toDataURL('image/png');
  },
  [
    b64(join(DIR, 'drawer-menu-focused-row1.png')),
    b64(join(DIR, 'settings-menu-focused-row1.png')),
  ],
);
await browser.close();
writeFileSync(join(DIR, 'indent-compare.png'), Buffer.from(out.split(',')[1], 'base64'));
console.log('written', join(DIR, 'indent-compare.png'));
