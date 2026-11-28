import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '../src/i18n/provider.js';
import { PageTopbar } from '../src/pages/shell.js';

const WEB_SRC = resolve(import.meta.dirname, '../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(WEB_SRC, relPath), 'utf8');
}

describe('settings-trim', () => {
  test('no Settings section repeats its page heading as a section title', () => {
    const settingsPage = readSrc('settings/settings-page.tsx');
    const importMap = new Map<string, string>();
    for (const match of settingsPage.matchAll(
      /import\s*\{([^}]+)\}\s*from\s*'(\.\.[^']+\.js)'\s*;/g,
    )) {
      const targetRel = resolve(WEB_SRC, 'settings', match[2]!.replace(/\.js$/, '.tsx'));
      for (const spec of match[1]!.split(',')) {
        const name = spec.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) importMap.set(name, targetRel);
      }
    }

    const groupsBlock = settingsPage.match(/const GROUPS: Group\[\] = \[[\s\S]*?\n\];/)?.[0] ?? '';
    expect(groupsBlock.length).toBeGreaterThan(0);

    const sections = [
      ...groupsBlock.matchAll(
        /id:\s*'([^']+)'[\s\S]*?label:\s*'([^']+)'[\s\S]*?element:\s*\(\)\s*=>\s*<([A-Za-z0-9_]+)\s*\/>/g,
      ),
    ];
    expect(sections.length).toBe(10);

    for (const [, id, label, component] of sections) {
      const filePath = component ? importMap.get(component) : undefined;
      expect(filePath, `Missing import for ${id} (${component})`).toBeTruthy();
      if (!filePath) continue;
      const src = readFileSync(filePath, 'utf8');
      expect(
        src,
        `Settings section "${id}" (${filePath}) repeats page title "${label}" in <SettingsSection>`,
      ).not.toMatch(new RegExp(`<SettingsSection[^>]*title=\\{t\\('${label}'\\)\\}`));
      expect(
        src,
        `Settings section "${id}" (${filePath}) repeats page title "${label}" in a heading tag`,
      ).not.toMatch(new RegExp(`<h[1-4][^>]*>\\s*\\{?t\\('${label}'\\)\\}?\\s*</h[1-4]>`));
    }
  });

  test('PageShell supports optional info prop via EmbeddedShell titleMetaSlot and ImConnectionsPage passes overview info to PageShell', () => {
    const shell = readSrc('pages/shell.tsx');
    const settingsPage = readSrc('settings/settings-page.tsx');
    const imPage = readSrc('routes/im-page.tsx');

    expect(shell).toContain('titleMetaSlot');
    expect(shell).toMatch(/info\?:\s*string/);
    expect(shell).toContain('<InfoTip');
    expect(settingsPage).toContain('titleMetaSlot');
    expect(imPage).toMatch(/<PageShell[\s\S]*?info=\{t\(/);
    expect(imPage).not.toContain('SettingsSection');
  });

  test('machine row menu and types remove token rotation and reauth UI while keeping default/delete actions', () => {
    const row = readSrc('resources/machine-row.tsx');
    const hooks = readSrc('api/hooks.ts');
    const mappers = readSrc('api/mappers.ts');
    const records = readSrc('fixtures/records.ts');
    const en = readSrc('i18n/en.ts');

    for (const banned of [
      'machine-menu-rotate-token',
      'machine-token-reauth-status',
      'machine-token-reauth-drawer',
      'confirmRotate',
      'rotateToken',
      'rotateMachineToken',
      '更换令牌',
      '确认更换令牌',
      '令牌已轮换，执行机需重新连接',
      '重新连接执行机',
    ]) {
      expect(row).not.toContain(banned);
    }

    expect(row).toContain('machine-menu-default');
    expect(row).toContain('machine-menu-delete');
    expect(hooks).not.toContain('rotateMachineToken');
    expect(mappers).not.toContain('tokenReauthRequired');
    expect(records).not.toContain('tokenReauthRequired');
    expect(en).not.toContain('更换令牌');
    expect(en).not.toContain('确认更换令牌');
  });

  test('standalone PageTopbar renders optional info InfoTip right beside its h1 page heading', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(PageTopbar, {
          title: '聊天应用',
          info: '手机连接说明',
        }),
      }),
    );
    expect(html).toMatch(/<header[^>]*data-testid="page-topbar"[\s\S]*?<h1[^>]*>聊天应用<\/h1>/);
    expect(html).toContain('data-testid="info-tip"');
    expect(html).toContain('aria-label="手机连接说明"');
  });
});
