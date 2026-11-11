import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '../src');
const DESIGN = join(SRC, 'design');
const COMPONENTS = join(SRC, 'components');

const NOT_IN_GALLERY: Record<string, string> = {
  'chat/earlier-loader.tsx':
    'Renders nothing: it requests earlier history pages when the reader nears the top and restores the reading position.',
  'ui/alert-dialog.tsx':
    'Registry copy with no consumer; confirm surfaces use alert-dialog-shell.tsx, shown in the Dialog section.',
  'model-select-core.tsx':
    'Gap: rendered only through src/routes/agent-model-select.tsx on the routing settings page; no specimen yet.',
  'conversation-skeleton.tsx':
    'Gap: rendered only by src/board/home-c.tsx while the Coordinator data loads; no specimen yet.',
  'queued-capsules.tsx':
    'Rendered inside the Queued messages specimen through src/detail/composer.tsx.',
  'shortcut-hint.tsx':
    'Rendered inside the Question card specimen (the Ctrl and return keycaps) and the search panel.',
  'subtree-error-boundary.tsx':
    'Class boundary around routes and the conversation. It renders the gallery EmptyState only after a child throws, so a static specimen cannot show it; recovery is covered by error-boundary tests.',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else return null;
  base = base.replace(/\.js$/, '');
  const candidates = [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function inGalleryGraph(path: string): boolean {
  return path.startsWith(`${DESIGN}/`) || path.startsWith(`${COMPONENTS}/`);
}

function reachedFromGallery(): Set<string> {
  const reached = new Set<string>();
  const queue = walk(DESIGN).filter((f) => /\.tsx?$/.test(f));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, spec = ''] of source.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+'([^']+)'/gm)) {
      const target = resolveImport(file, spec);
      if (target != null && inGalleryGraph(target)) queue.push(target);
    }
  }
  return reached;
}

const inventory = walk(COMPONENTS)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => relative(COMPONENTS, f))
  .sort();
const reached = new Set(
  [...reachedFromGallery()]
    .filter((f) => f.startsWith(`${COMPONENTS}/`))
    .map((f) => relative(COMPONENTS, f)),
);

describe('gallery covers src/components', () => {
  it('finds the component inventory', () => {
    expect(inventory.length).toBeGreaterThan(50);
  });

  it('renders every component file in /design.html or names why not', () => {
    const missing = inventory.filter((f) => !reached.has(f) && NOT_IN_GALLERY[f] == null);
    expect(
      missing,
      'These src/components files are not imported by the gallery (src/design, through src/design and src/components only). Add a specimen for each, or list it in NOT_IN_GALLERY with the reason.',
    ).toEqual([]);
  });

  it('keeps NOT_IN_GALLERY limited to files that exist and are still missing', () => {
    const stale = Object.keys(NOT_IN_GALLERY).filter((f) => !inventory.includes(f) || reached.has(f));
    expect(stale, 'Remove these entries from NOT_IN_GALLERY').toEqual([]);
  });
});
