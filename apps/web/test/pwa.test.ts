// PWA byte-level seam (issue #74, 01-stack-v2 §7 acceptance point 7):
// manifest.webmanifest + sw.js were carried over verbatim from the r1
// capture originals during the 复刻 phase (素材替换计划 D3 先原样).
// apple-mobile-web-app-title 槽：r1 原件与复刻 index.html 均无该 meta
// （r1 捕获未含），复刻面 N/A——无需切换，登记于此。
// D3 已触发（2026-09-23, #109）：品牌槽已切 replacement 值，本 gate 的新
// 契约 = 冻结面只允许素材替换计划 §3.4 的品牌槽 divergence——manifest
// name/short_name = Cairn + description 自写 + sw.js 通知兜底标题 =
// Cairn；其余字段/字节仍须与 docs/research/assets/r1/ 原件逐字节一致。
// #1430 追加 divergence：theme_color / background_color 对齐 Paper 暗色
// canvas token（manifest 不支持 media，取默认暗档 #1a1612）。
// #249 素材核账追加两处 divergence（D8 批次收口）：related_applications
// 原站指针整段移除（产品无关联应用可指）；screenshots 换复刻 UI 实拍
// （scripts/capture-pwa-screenshots.mjs）+ 自写 label，且文件必须真在
// public/screenshots/（r1 冻结面的 src 曾指向不存在的文件）。
// sw.js keeps its push handler file shape although the server never sends
// push (04-验收口径 §5 divergence A5: dead code tolerated, registered).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const R1_DIR = resolve(ROOT, 'docs/research/assets/r1');
const PUBLIC_DIR = resolve(ROOT, 'apps/web/public');

/** manifest 品牌槽替换值（素材替换计划 §3.4：`Cairn` + 自写 description）。 */
const MANIFEST_BRAND = {
  name: 'Cairn',
  shortName: 'Cairn',
  description:
    'Cairn — a local-first, self-hosted workspace where humans direct the work and agents execute it.',
} as const;

/** manifest screenshots 自写 label（#249；capture 脚本再生时同步此处）。 */
const MANIFEST_SCREENSHOT_LABEL = 'Cairn task board — humans direct, agents execute';

/** manifest theme_color / background_color（#1430：Paper 暗色 --canvas）。 */
const MANIFEST_DARK_PAPER = '#1a1612';

describe('PWA files vs r1 capture originals (D3 replacement-phase gate)', () => {
  it('manifest.webmanifest diverges only in the §3.4 brand slots + #249 D8 收口两处', () => {
    const original = JSON.parse(readFileSync(resolve(R1_DIR, 'manifest.webmanifest'), 'utf8'));
    const shipped = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8'));
    expect(shipped.name).toBe(MANIFEST_BRAND.name);
    expect(shipped.short_name).toBe(MANIFEST_BRAND.shortName);
    expect(shipped.description).toBe(MANIFEST_BRAND.description);
    // #1430：manifest 无 media，取默认暗档 Paper token
    expect(shipped.theme_color).toBe(MANIFEST_DARK_PAPER);
    expect(shipped.background_color).toBe(MANIFEST_DARK_PAPER);
    // #249：原站 related_applications 指针移除，产品面无关联应用可指
    expect(shipped.related_applications).toBeUndefined();
    // #249：screenshots = 复刻 UI 实拍 + 自写 label，文件真在 public/
    expect(shipped.screenshots).toEqual([
      {
        src: '/screenshots/narrow.png',
        sizes: '780x1688',
        type: 'image/png',
        form_factor: 'narrow',
        label: MANIFEST_SCREENSHOT_LABEL,
      },
      {
        src: '/screenshots/wide.png',
        sizes: '2560x1600',
        type: 'image/png',
        form_factor: 'wide',
        label: MANIFEST_SCREENSHOT_LABEL,
      },
    ]);
    for (const { src } of shipped.screenshots) {
      expect(existsSync(resolve(PUBLIC_DIR, `.${src}`))).toBe(true);
    }
    // 其余字段与 r1 原件冻结一致（start_url 形状保留）
    const {
      name: _n,
      short_name: _s,
      description: _d,
      related_applications: _ra,
      screenshots: _sc,
      theme_color: _tc,
      background_color: _bc,
      ...restShipped
    } = shipped;
    const {
      name: _on,
      short_name: _os,
      description: _od,
      related_applications: _ora,
      screenshots: _osc,
      theme_color: _otc,
      background_color: _obc,
      ...restOriginal
    } = original;
    expect(restShipped).toEqual(restOriginal);
  });

  it('sw.js diverges only in the notification-title brand slot', () => {
    const original = readFileSync(resolve(R1_DIR, 'sw.js'), 'utf8');
    const shipped = readFileSync(resolve(PUBLIC_DIR, 'sw.js'), 'utf8');
    expect(shipped).toBe(original.replace("n.title || 'Todos'", "n.title || 'Cairn'"));
  });

  it('sw.js keeps the push + notificationclick handler shape', () => {
    const sw = readFileSync(resolve(PUBLIC_DIR, 'sw.js'), 'utf8');
    expect(sw).toContain("self.addEventListener('push'");
    expect(sw).toContain("self.addEventListener('notificationclick'");
    // no fetch handler — the capture's defining property (r1 §5.3 point 2)
    expect(sw).not.toContain("addEventListener('fetch'");
  });

  it('index.html links the manifest and carries the replaced title', () => {
    const html = readFileSync(resolve(ROOT, 'apps/web/index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    // 站点 <title> 品牌词槽（素材替换计划 §3.4：自写，从产品定位 = 产品名）
    expect(html).toContain('<title>Cairn</title>');
  });
});
