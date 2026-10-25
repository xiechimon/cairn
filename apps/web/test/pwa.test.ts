import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const PUBLIC_DIR = resolve(ROOT, 'apps/web/public');

const MANIFEST_BRAND = {
  name: 'Cairn',
  shortName: 'Cairn',
  description:
    'Cairn — a local-first, self-hosted workspace where humans direct the work and agents execute it.',
} as const;

const MANIFEST_SCREENSHOT_LABEL = 'Cairn task board — humans direct, agents execute';

const MANIFEST_DARK_PAPER = '#1a1612';

describe('PWA files', () => {
  it('manifest.webmanifest carries the Cairn brand, Paper colors and shipped screenshots', () => {
    const shipped = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8'));
    expect(shipped.name).toBe(MANIFEST_BRAND.name);
    expect(shipped.short_name).toBe(MANIFEST_BRAND.shortName);
    expect(shipped.description).toBe(MANIFEST_BRAND.description);
    expect(shipped.theme_color).toBe(MANIFEST_DARK_PAPER);
    expect(shipped.background_color).toBe(MANIFEST_DARK_PAPER);
    expect(shipped.related_applications).toBeUndefined();
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
  });

  it('sw.js keeps the push + notificationclick handlers, a Cairn fallback title and no fetch handler', () => {
    const sw = readFileSync(resolve(PUBLIC_DIR, 'sw.js'), 'utf8');
    expect(sw).toContain("self.addEventListener('push'");
    expect(sw).toContain("self.addEventListener('notificationclick'");
    expect(sw).toContain("n.title || 'Cairn'");
    expect(sw).not.toContain("addEventListener('fetch'");
  });

  it('index.html links the manifest and carries the Cairn title', () => {
    const html = readFileSync(resolve(ROOT, 'apps/web/index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<title>Cairn</title>');
  });
});
