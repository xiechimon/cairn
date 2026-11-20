import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

  test('ink grain lives only on the brand spiral illustration', () => {
    expect(offenders(/feTurbulence/)).toEqual(['components/ink-spiral.tsx']);
    expect(offenders(/<InkSpiral\b/).sort()).toEqual([
      'board/first-run-setup.tsx',
      'board/home-spiral.tsx',
    ]);
    const publicJs = readdirSync(join(ROOT, 'public')).filter((name) => name.endsWith('.js'));
    expect(
      publicJs.filter((name) => /feTurbulence/.test(readFileSync(join(ROOT, 'public', name), 'utf8'))),
    ).toEqual(['boot-skeleton.js']);
  });

  test('ink specks fill only the filled buttons, under a crisp label', () => {
    const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const design = readFileSync(join(ROOT, 'design.html'), 'utf8');
    expect(index).toContain('id="cairn-ink-specks"');
    expect(design).toContain('id="cairn-ink-specks"');
    const uses = [...appCss.matchAll(/([^{}]+)\{[^{}]*url\(#cairn-ink-specks\)/g)].map((m) => m[1]?.trim());
    expect(uses).toEqual([
      '[data-slot="button"]:is([data-variant="default"], [data-variant="secondary"])::before',
    ]);
    expect(offenders(/cairn-ink-specks/)).toEqual(['styles/app.css']);
  });

  test('the user bubble is one flat token fill', () => {
    const bubble =
      sourceFiles.find(({ path }) => path === 'components/chat/user-message-bubble.tsx')?.text ?? '';
    expect(bubble).toMatch(/bg-\(--bubble-fill\)/);
    expect(offenders(/bubble-gradient|--bubble-(base|wash|rim)/)).toEqual([]);
  });
});

describe('V3 no blurred surfaces', () => {
  test('only the pristine dialog overlays carry a blur class', () => {
    expect(offenders(/backdrop-blur|backdrop-filter:\s*blur|filter:\s*blur\(/).sort()).toEqual([
      'components/ui/alert-dialog.tsx',
      'components/ui/dialog.tsx',
    ]);
  });

  test('the pristine dialog overlays keep their upstream blur class but render none', () => {
    expect(appCss).toMatch(
      /\[data-slot="dialog-overlay"\],\s*\[data-slot="alert-dialog-overlay"\] \{[^}]*backdrop-filter: none;/,
    );
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

const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');
const SOURCE_PATH =
  /`((?:src|e2e|test|components|board|chief|detail|design|lib|api|styles|thread|overlay)\/[^`\s]*?\.(?:tsx?|css|mjs))`/g;
const ruleRows = rules
  .split('\n')
  .filter((line) => /^\| [A-Z]\d+ \|/.test(line))
  .map((line) => {
    const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    return { id: cells[0] ?? '', check: cells[2] ?? '' };
  });
const MEASURED_BY_HAND = [
  'C1', 'C2', 'C3', 'C4', 'C5', 'C7', 'C18', 'V12', 'V13', 'V15', 'V17', 'V18', 'L1', 'L3',
  'L4', 'L6', 'L7', 'T1', 'A1', 'A2',
];

describe('the design docs stay true and checkable', () => {
  test.each([
    ['DESIGN.md', design],
    ['DESIGN-RULES.md', rules],
  ])('every source path %s names exists', (_name, text) => {
    const dead = [...text.matchAll(SOURCE_PATH)]
      .map((match) => match[1] ?? '')
      .filter((path) =>
        [path, `src/${path}`, `src/components/${path}`, `../../${path}`].every(
          (candidate) => !existsSync(join(ROOT, candidate)),
        ),
      );
    expect(dead).toEqual([]);
  });

  test('a measured rule names the spec or test that measures it; the by-hand list only shrinks', () => {
    const unnamed = ruleRows
      .filter((row) => row.check.startsWith('M') && row.check.match(SOURCE_PATH) === null)
      .map((row) => row.id);
    expect(unnamed.filter((id) => !MEASURED_BY_HAND.includes(id))).toEqual([]);
    expect(MEASURED_BY_HAND.filter((id) => !unnamed.includes(id))).toEqual([]);
  });
});
