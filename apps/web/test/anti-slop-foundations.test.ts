import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ProjectAvatar } from '../src/board/project-avatar.js';

const SRC = new URL('../src/', import.meta.url).pathname;
const ROOT = new URL('../', import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sourceFiles = walk(SRC)
  .filter((path) => /\.(tsx?|css)$/.test(path))
  .map((path) => ({ path: path.slice(SRC.length), text: readFileSync(path, 'utf8') }));

const appCss = readFileSync(join(SRC, 'styles/app.css'), 'utf8');
const rules = readFileSync(join(ROOT, 'DESIGN-RULES.md'), 'utf8');

function offenders(pattern: RegExp): string[] {
  return sourceFiles.filter(({ text }) => pattern.test(text)).map(({ path }) => path);
}

describe('V11 identity carries no colour', () => {
  test('a project avatar renders no letter and no hue', () => {
    const html = renderToStaticMarkup(createElement(ProjectAvatar, { name: 'cairn', tone: 2 }));
    expect(html).not.toContain('>C<');
    expect(html).not.toMatch(/project-(tile|ink)/);
    expect(html).toContain('<svg');
  });

  test('a chosen icon and colour still render neutral', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectAvatar, { name: 'cairn', tone: 0, icon: 'rocket', color: 'rose' }),
    );
    expect(html).not.toMatch(/project-(tile|ink)/);
  });

  test('no project tile or ink token remains', () => {
    expect(offenders(/project-(tile|ink)/)).toEqual([]);
  });
});

describe('V16 no texture or gradient surfaces', () => {
  test('no surface carries a gradient or a noise texture', () => {
    expect(appCss).not.toMatch(/feTurbulence|radial-gradient|conic-gradient/);
  });

  test('the user bubble is one flat token fill', () => {
    const bubble =
      sourceFiles.find(({ path }) => path === 'components/chat/user-message-bubble.tsx')?.text ?? '';
    expect(bubble).toMatch(/bg-\(--bubble-fill\)/);
    expect(offenders(/bubble-gradient|--bubble-(base|wash|rim)/)).toEqual([]);
  });
});

describe('V3 blur only on the measured claude.ai selection bar', () => {
  test('the selection bar is the one blurred surface', () => {
    expect(offenders(/backdrop-blur|backdrop-filter:\s*blur|filter:\s*blur\(/).sort()).toEqual([
      'chief/selection-reply.tsx',
      'components/ui/alert-dialog.tsx',
      'components/ui/dialog.tsx',
    ]);
  });

  test('the pristine dialog overlays keep their upstream blur class but render none', () => {
    expect(appCss).toMatch(
      /\[data-slot="dialog-overlay"\],\s*\[data-slot="alert-dialog-overlay"\] \{[^}]*backdrop-filter: none;/,
    );
  });

  test('it blurs by the measured 8px', () => {
    const bar = sourceFiles.find(({ path }) => path === 'chief/selection-reply.tsx')?.text ?? '';
    expect(bar.match(/backdrop-blur[\w-]*/g)).toEqual(['backdrop-blur-sm']);
  });
});

describe('palette roles', () => {
  test('chip fill and tile tint tokens are gone', () => {
    expect(offenders(/--(chip-(idle|plan|confirm|done|failed)-(bg|fg)|tile-orange-(bg|fg))/)).toEqual([]);
  });
});

describe('DESIGN-RULES carries the anti-slop rules', () => {
  test.each(['V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18', 'V19', 'V20', 'T3', 'V22', 'V23', 'V24', 'T4'])(
    '%s is a row with a measured baseline',
    (id) => {
      const row = rules.split('\n').find((line) => line.startsWith(`| ${id} |`));
      expect(row).toBeDefined();
      expect(row).toMatch(/\| (M|H)(;| \|)/);
    },
  );

  test('V3 and V16 grant the user bubble no gradient exception', () => {
    for (const id of ['V3', 'V16']) {
      const row = rules.split('\n').find((line) => line.startsWith(`| ${id} |`));
      expect(row).not.toMatch(/`bubble-gradient`/);
    }
  });
});
