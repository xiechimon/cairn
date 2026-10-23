// #1011 归因微探针：行环的墨到底画在哪、被谁裁。
//   A = 行聚焦（环在）
//   B = 行聚焦 + row.style.boxShadow='none'  → diff(A,B) = 行 box-shadow 的全部墨
//   C = 行聚焦 + listbox.style.overflow='visible' → diff(A,C) = 裁剪原本藏掉的墨
// 若 diff(A,C) 为空 => 环从未被裁（#883 的裁剪判据在当前几何下不成立）。
// 用法：node e2e/probe-1011-attr.mjs <baseURL> <outDir> [scenario] [triggerName] [dialogName] [key]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8398';
const OUT = process.argv[3] ?? '/tmp/evidence-1011';
const DSF = 4;
mkdirSync(OUT, { recursive: true });

async function diffPngs(browser, a, b) {
  const page = await browser.newPage();
  const out = await page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const cv = (img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c;
      };
      const ca = cv(ia);
      const cb = cv(ib);
      const da = ca.getContext('2d').getImageData(0, 0, ca.width, ca.height);
      const db = cb.getContext('2d').getImageData(0, 0, cb.width, cb.height);
      let changed = 0;
      let minX = ca.width;
      let maxX = -1;
      let minY = ca.height;
      let maxY = -1;
      for (let i = 0; i < da.data.length; i += 4) {
        const d =
          Math.abs(da.data[i] - db.data[i]) +
          Math.abs(da.data[i + 1] - db.data[i + 1]) +
          Math.abs(da.data[i + 2] - db.data[i + 2]);
        if (d > 24) {
          changed++;
          const px = (i / 4) % ca.width;
          const py = Math.floor(i / 4 / ca.width);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
      return { changed, bbox: maxX >= 0 ? { minX, maxX, minY, maxY } : null };
    },
    [a, b],
  );
  await page.close();
  return out;
}
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 732 },
  deviceScaleFactor: DSF,
  colorScheme: 'light',
});
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
const SCENARIO = process.argv[4] ?? '101';
const TRIGGER = process.argv[5] ?? '压缩模型';
const DIALOG = process.argv[6] ?? '压缩模型';
const KEY = process.argv[7] ?? 'settings';
await page.goto(`${BASE}/app?scenario=${SCENARIO}`);
const trigger = page.getByRole('button', { name: TRIGGER });
const menu = page.getByRole('dialog', { name: DIALOG });
await trigger.click();
await menu.waitFor({ state: 'visible' });
await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
const menuBox = await menu.boundingBox();
const clip = {
  x: menuBox.x - 8,
  y: menuBox.y - 8,
  width: menuBox.width + 16,
  height: menuBox.height + 16,
};
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
const shotA = await page.screenshot({ clip });
// 行左缘+上缘放大帧（菜单还在、行还聚焦时拍——抽屉面单行，第二次 Tab 会
// 让弹层随焦点外出而关，补拍就空了）
const zoomRow = await page.evaluate(() => {
  const rr = document.activeElement.getBoundingClientRect();
  return { left: rr.left, top: rr.top, h: rr.height, right: rr.right };
});
writeFileSync(
  join(OUT, `${KEY}-row-left-edge-zoom.png`),
  await page.screenshot({ clip: { x: zoomRow.left - 8, y: zoomRow.top - 8, width: 26, height: zoomRow.h + 16 } }),
);
writeFileSync(
  join(OUT, `${KEY}-row-top-edge-zoom.png`),
  await page.screenshot({ clip: { x: zoomRow.left + 40, y: zoomRow.top - 8, width: 60, height: 20 } }),
);

const geo = await page.evaluate(() => {
  const row = document.activeElement;
  const lb = row.closest('[role="listbox"]');
  const rr = row.getBoundingClientRect();
  const lr = lb.getBoundingClientRect();
  return { row: rr.toJSON(), listbox: lr.toJSON(), lbOverflow: getComputedStyle(lb).overflowY };
});

await page.evaluate(() => {
  document.activeElement.style.boxShadow = 'none';
});
await page.waitForTimeout(400);
const shotB = await page.screenshot({ clip });
await page.evaluate(() => {
  document.activeElement.style.boxShadow = '';
});
await page.waitForTimeout(400);

await page.evaluate(() => {
  document.activeElement.closest('[role="listbox"]').style.overflow = 'visible';
});
await page.waitForTimeout(400);
const shotC = await page.screenshot({ clip });

const dAB = await diffPngs(browser, b64(shotA), b64(shotB));
const dAC = await diffPngs(browser, b64(shotA), b64(shotC));
writeFileSync(join(OUT, `${KEY}-attr-focused-A.png`), shotA);
writeFileSync(join(OUT, `${KEY}-attr-noshadow-B.png`), shotB);
writeFileSync(join(OUT, `${KEY}-attr-overflow-visible-C.png`), shotC);
const result = { key: KEY, geo, diffShadowRemoved: dAB, diffOverflowVisible: dAC };
writeFileSync(join(OUT, `${KEY}-attr.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
