// #1011 再评探针：model picker 两面的行焦点环渲染实测 + 行内缩实测。
// 判据形态（全部取运行时真值，不读源码推断）：
//   1. 几何：focused row rect vs listbox clip rect vs dialog rect（行盒缘 ==
//      裁剪盒缘 => 画在盒外的环必被裁）；
//   2. 像素：同一 clip 区域「开面即拍（鼠标模态、清单容器无环）」vs「Tab 到
//      行（环在）」两帧逐像素 diff；变化像素按「行盒外左/右/上/下」四条带
//      计数 = 环的四段各自有没有墨（被裁的段计数归零）；diff 染红叠加导出；
//   3. 阳性对照：触发钮自身（弹层外，无裁剪祖先）focus-visible 环完整可见；
//   4. 键盘导航压测（break-ui 焦点面）：Tab 进入首行、再 Tab、Shift+Tab 回退、
//      Escape 关面焦点归还，逐步记录 activeElement 与 :focus-visible。
// 基线帧必须在任何键盘输入之前拍：清单容器 tabIndex=-1，键盘模态下程序聚焦
// 会让它吃到焦点环（#1095 前是 UA 蓝环、之后是仓内配方环；:focus-visible
// 命中），基线就不干净。
// 用法：node e2e/probe-1011.mjs <baseURL> <outDir>
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8411';
const OUT = process.argv[3] ?? '/tmp/evidence-1011';
const DSF = 4;
mkdirSync(OUT, { recursive: true });

/** 浏览器页内 diff 两张 data-URL PNG：变化像素数、bbox、四带计数、染红叠加图。 */
async function diffPngs(browser, base64A, base64B, bands) {
  const page = await browser.newPage();
  const out = await page.evaluate(
    async ([a, b, bands]) => {
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
      const w = ca.width;
      const h = ca.height;
      const over = cb.getContext('2d').getImageData(0, 0, w, h);
      const bandCounts = Object.fromEntries(Object.keys(bands).map((k) => [k, 0]));
      let changed = 0;
      let minX = w;
      let maxX = -1;
      let minY = h;
      let maxY = -1;
      for (let i = 0; i < da.data.length; i += 4) {
        const d =
          Math.abs(da.data[i] - db.data[i]) +
          Math.abs(da.data[i + 1] - db.data[i + 1]) +
          Math.abs(da.data[i + 2] - db.data[i + 2]);
        if (d > 24) {
          changed++;
          const px = (i / 4) % w;
          const py = Math.floor(i / 4 / w);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          for (const [k, r] of Object.entries(bands)) {
            if (px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) bandCounts[k]++;
          }
          over.data[i] = 255;
          over.data[i + 1] = 0;
          over.data[i + 2] = 0;
          over.data[i + 3] = 255;
        }
      }
      const oc = document.createElement('canvas');
      oc.width = w;
      oc.height = h;
      oc.getContext('2d').putImageData(over, 0, 0);
      return {
        changed,
        width: w,
        height: h,
        bbox: maxX >= 0 ? { minX, maxX, minY, maxY } : null,
        bandCounts,
        overlay: oc.toDataURL('image/png'),
      };
    },
    [base64A, base64B, bands],
  );
  await page.close();
  return out;
}

const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

async function probeFace(browser, face) {
  const { scenario, triggerName, dialogName, key } = face;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 732 },
    deviceScaleFactor: DSF,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto(`${BASE}/app?scenario=${scenario}`);

  const trigger = page.getByRole('button', { name: triggerName });
  const menu = page.getByRole('dialog', { name: dialogName });
  const openMenu = async () => {
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();
    await menu.waitFor({ state: 'visible' });
    await menu.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
    );
  };
  const active = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (el == null) return null;
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        text: (el.textContent ?? '').trim().slice(0, 40),
        matchesFocusVisible: el.matches(':focus-visible'),
      };
    });

  const r = { scenario, triggerName, dialogName };

  // —— 相位 A：环渲染实测。必须先于本 context 内任何键盘输入：基线帧要鼠标
  //    模态（开面零环）。旧序把导航压测放前面，压测的 Tab/Escape 把输入模态
  //    留在键盘，第二次开面的容器程序焦点命中 :focus-visible 吃环——基线帧
  //    带环，base-vs-focused 的 diff 归因全错（#1095 实测踩到）。导航压测移
  //    到相位 B，顺带拍键盘模态开面的容器环帧。 ——
  await openMenu();
  // 基线帧：开面即拍——此刻焦点在清单容器但输入模态是鼠标，:focus-visible
  // 不命中，全菜单零环。
  const menuBox = await menu.boundingBox();
  const clip = {
    x: Math.max(0, menuBox.x - 8),
    y: Math.max(0, menuBox.y - 8),
    width: menuBox.width + 16,
    height: menuBox.height + 16,
  };
  const baseShot = await page.screenshot({ clip });
  writeFileSync(join(OUT, `${key}-menu-base-no-ring.png`), baseShot);

  await page.keyboard.press('Tab');
  await page.waitForTimeout(400); // Button 底座 transition-all：等环落定
  const rowState = await active();
  r.focusLandedOnRow = rowState?.role === 'option';
  if (!r.focusLandedOnRow) {
    r.error = `Tab did not land on a row: ${JSON.stringify(rowState)}`;
    await context.close();
    return r;
  }

  r.geo = await page.evaluate(() => {
    const row = document.activeElement;
    const listbox = row.closest('[role="listbox"]');
    const dialog = row.closest('[role="dialog"]');
    const cs = getComputedStyle(row);
    const lcs = getComputedStyle(listbox);
    const dcs = getComputedStyle(dialog);
    const rr = row.getBoundingClientRect();
    const lr = listbox.getBoundingClientRect();
    const dr = dialog.getBoundingClientRect();
    const name = row.querySelector('[data-testid="model-pick-name"]');
    const tokens = getComputedStyle(document.documentElement);
    return {
      row: { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom, w: rr.width, h: rr.height },
      listbox: { left: lr.left, right: lr.right, top: lr.top, bottom: lr.bottom, w: lr.width, h: lr.height },
      dialog: { left: dr.left, right: dr.right, top: dr.top, bottom: dr.bottom, w: dr.width, borderLeft: dcs.borderLeftWidth },
      rowPadding: { left: cs.paddingLeft, right: cs.paddingRight },
      nameInkInsetFromDialogInner: name
        ? name.getBoundingClientRect().left - (dr.left + parseFloat(dcs.borderLeftWidth))
        : null,
      listboxOverflow: { x: lcs.overflowX, y: lcs.overflowY },
      listboxPadding: { left: lcs.paddingLeft, right: lcs.paddingRight, top: lcs.paddingTop, bottom: lcs.paddingBottom },
      listboxScroll: {
        scrollHeight: listbox.scrollHeight,
        clientHeight: listbox.clientHeight,
        scrollWidth: listbox.scrollWidth,
        clientWidth: listbox.clientWidth,
      },
      rowFocusStyle: {
        focusVisible: row.matches(':focus-visible'),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineOffset: cs.outlineOffset,
        boxShadow: cs.boxShadow,
      },
      tokens: {
        ring: tokens.getPropertyValue('--ring').trim(),
        focusRing: tokens.getPropertyValue('--focus-ring').trim(),
      },
      rowFlushWithListbox: {
        left: Math.abs(rr.left - lr.left) < 0.5,
        right: Math.abs(rr.right - lr.right) < 0.5,
        top: Math.abs(rr.top - lr.top) < 0.5,
      },
    };
  });

  const focusedShot = await page.screenshot({ clip });
  writeFileSync(join(OUT, `${key}-menu-focused-row1.png`), focusedShot);

  // 四带：行盒外 0.5–4px 的左/右/上/下条带（shot 坐标 = (css - clip) * DSF）
  const g = r.geo;
  const sx = (v) => (v - clip.x) * DSF;
  const sy = (v) => (v - clip.y) * DSF;
  const bandsFor = (row) => ({
    left: { x0: sx(row.left - 4), x1: sx(row.left - 0.5), y0: sy(row.top + 2), y1: sy(row.bottom - 2) },
    right: { x0: sx(row.right + 0.5), x1: sx(row.right + 4), y0: sy(row.top + 2), y1: sy(row.bottom - 2) },
    top: { x0: sx(row.left + 2), x1: sx(row.right - 2), y0: sy(row.top - 4), y1: sy(row.top - 0.5) },
    bottom: { x0: sx(row.left + 2), x1: sx(row.right - 2), y0: sy(row.bottom + 0.5), y1: sy(row.bottom + 4) },
  });
  const diff1 = await diffPngs(browser, b64(baseShot), b64(focusedShot), bandsFor(g.row));
  r.ringRow1 = { changedPixels: diff1.changed, bbox: diff1.bbox, bands: diff1.bandCounts };
  writeFileSync(
    join(OUT, `${key}-ring-diff-overlay-row1.png`),
    Buffer.from(diff1.overlay.split(',')[1], 'base64'),
  );

  // 第二行（中部行）：上下段在内容区内、左右段仍贴裁剪盒
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  const row2State = await active();
  if (row2State?.role === 'option') {
    const geo2 = await page.evaluate(() => {
      const rr = document.activeElement.getBoundingClientRect();
      return { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom };
    });
    const row2Shot = await page.screenshot({ clip });
    writeFileSync(join(OUT, `${key}-menu-focused-row2.png`), row2Shot);
    const diff2 = await diffPngs(browser, b64(baseShot), b64(row2Shot), bandsFor(geo2));
    r.ringRow2 = { changedPixels: diff2.changed, bbox: diff2.bbox, bands: diff2.bandCounts };
    writeFileSync(
      join(OUT, `${key}-ring-diff-overlay-row2.png`),
      Buffer.from(diff2.overlay.split(',')[1], 'base64'),
    );
  } else {
    r.ringRow2 = { skipped: 'single-row face', focusAfterSecondTab: row2State };
  }

  // 行左缘/上缘放大帧（肉眼复核带计数）
  const zoomClip = {
    x: g.row.left - 8,
    y: g.row.top - 8,
    width: 26,
    height: g.row.h + 16,
  };
  writeFileSync(join(OUT, `${key}-row1-left-edge-zoom.png`), await page.screenshot({ clip: zoomClip }));

  // —— 相位 B：键盘导航压测（第二次开面；此刻输入模态已是键盘，开面时容器
  //    程序焦点命中 :focus-visible——顺带拍容器环帧，#1095 附带修的容器焦点
  //    配方（UA 蓝环 → 仓内 --focus-ring 内描）的证据帧就是它）。 ——
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await page.waitForTimeout(200);
  // 键盘开面（focus + Enter，不用 openMenu 的鼠标 click）：鼠标 click 会把
  // 输入模态拉回 mouse，容器程序焦点就不命中 :focus-visible，容器环帧拍不到
  // （#1095 实测：两面一真一假）。键盘路径下触发钮先 focus-visible，程序焦点
  // 移进容器按「前一焦点有环则继环」启发式必命中。
  await trigger.focus();
  await page.keyboard.press('Enter');
  await menu.waitFor({ state: 'visible' });
  await menu.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
  );
  writeFileSync(join(OUT, `${key}-container-focus-ring.png`), await page.screenshot({ clip }));
  const nav = [{ step: 'after-open(keyboard-modality)', ...(await active()) }];
  await page.keyboard.press('Tab');
  nav.push({ step: 'tab-1', ...(await active()) });
  await page.keyboard.press('Tab');
  nav.push({ step: 'tab-2', ...(await active()) });
  await page.keyboard.press('Shift+Tab');
  nav.push({ step: 'shift-tab', ...(await active()) });
  nav.push({ step: 'menu-still-open', open: await menu.count() });
  r.nav = nav;

  // —— 相位 C：阳性对照（触发钮环，弹层外无裁剪祖先） ——
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await page.waitForTimeout(400);
  const trigState = await active();
  r.control = { afterEscape: trigState };
  if (trigState?.matchesFocusVisible) {
    const tb = await trigger.boundingBox();
    const tclip = { x: tb.x - 10, y: tb.y - 10, width: tb.width + 20, height: tb.height + 20 };
    const trigShot = await page.screenshot({ clip: tclip });
    writeFileSync(join(OUT, `${key}-trigger-ring-control.png`), trigShot);
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(400);
    const trigBase = await page.screenshot({ clip: tclip });
    const tsx = (v) => (v - tclip.x) * DSF;
    const tsy = (v) => (v - tclip.y) * DSF;
    const tdiff = await diffPngs(browser, b64(trigBase), b64(trigShot), {
      left: { x0: tsx(tb.x - 4), x1: tsx(tb.x - 0.5), y0: tsy(tb.y + 2), y1: tsy(tb.y + tb.height - 2) },
      right: { x0: tsx(tb.x + tb.width + 0.5), x1: tsx(tb.x + tb.width + 4), y0: tsy(tb.y + 2), y1: tsy(tb.y + tb.height - 2) },
      top: { x0: tsx(tb.x + 2), x1: tsx(tb.x + tb.width - 2), y0: tsy(tb.y - 4), y1: tsy(tb.y - 0.5) },
      bottom: { x0: tsx(tb.x + 2), x1: tsx(tb.x + tb.width - 2), y0: tsy(tb.y + tb.height + 0.5), y1: tsy(tb.y + tb.height + 4) },
    });
    r.control.ringBands = tdiff.bandCounts;
    r.control.changedPixels = tdiff.changed;
  }

  await context.close();
  return r;
}

const browser = await chromium.launch();
const results = {};
try {
  results.drawer = await probeFace(browser, {
    scenario: '111',
    triggerName: '总管主模型',
    dialogName: '模型',
    key: 'drawer',
  });
  results.settings = await probeFace(browser, {
    scenario: '101',
    triggerName: '压缩模型',
    dialogName: '压缩模型',
    key: 'settings',
  });
} finally {
  await browser.close();
}

writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(results, null, 2));
console.log('written', join(OUT, 'measurements.json'));
