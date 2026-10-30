export type FrontmatterValue = string | string[];
export type Frontmatter = Record<string, Record<string, FrontmatterValue>>;
export type GalleryTheme = 'dark' | 'light';

export interface DocCheck {
  key: string;
  expected: string;
  cssExpr: string;
  kind: 'color' | 'length';
}

export const COLOR_VARS: Record<string, string> = {
  canvas: '--canvas',
  sheet: '--background',
  card: '--card',
  popover: '--popover',
  hover: '--sidebar-hover',
  line: '--border',
  rule: '--border',
  divider: '--border',
  ink: '--foreground',
  'ink-2': '--text-secondary',
  'ink-3': '--text-tertiary',
  'ink-4': '--text-dim',
  icon: '--icon',
  accent: '--card-button',
  primary: '--primary',
  'on-primary': '--primary-foreground',
  'on-accent': '--text-on-accent',
  'accent-hover': '--accent-hover',
  'menu-hover': '--menu-hover',
  backdrop: '--dialog-backdrop',
  running: '--running',
  'running-text': '--running-text',
  'running-bar': '--running-bar',
  'running-track': '--running-track',
};

export const RADIUS_EXPRS: Record<string, string> = {
  field: 'calc(var(--radius) * 0.8)',
  control: 'var(--radius-control)',
  'menu-item': 'var(--radius-menu-item)',
  sheet: 'var(--edge-radius)',
  menu: 'var(--radius-popover)',
  bubble: 'var(--radius-bubble)',
  card: 'var(--radius-card)',
  composer: 'var(--radius-composer)',
  window: 'var(--radius-window)',
};

const SECTION_RE = /^([\w-]+):\s*$/;
const ENTRY_RE = /^ {2}([\w-]+):\s*(\[[^\]]*\]|'[^']*'|[^#\s][^#]*?)\s*(?:#.*)?$/;

export function parseFrontmatter(markdown: string): Frontmatter {
  const block = markdown.split(/^---$/m)[1] ?? '';
  const out: Frontmatter = {};
  let section: Record<string, FrontmatterValue> | null = null;
  for (const line of block.split('\n')) {
    const head = SECTION_RE.exec(line);
    if (head?.[1] != null) {
      section = {};
      out[head[1]] = section;
      continue;
    }
    const entry = ENTRY_RE.exec(line);
    if (entry?.[1] == null || entry[2] == null || section == null) continue;
    const raw = entry[2];
    section[entry[1]] = raw.startsWith('[')
      ? [...raw.matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] == null ? [] : [m[1]]))
      : raw.replace(/^'(.*)'$/, '$1');
  }
  return out;
}

export function docChecks(
  doc: Frontmatter,
  theme: GalleryTheme,
): { checks: DocCheck[]; unmapped: string[] } {
  const colors = doc[theme === 'light' ? 'colors' : 'colors-dark'] ?? {};
  const checks: DocCheck[] = [];
  const unmapped: string[] = [];
  for (const [key, value] of Object.entries(colors)) {
    if (Array.isArray(value)) {
      value.forEach((expected, i) => {
        checks.push({
          key: `${key}-${i + 1}`,
          expected,
          cssExpr: `var(--project-tile-${i + 1})`,
          kind: 'color',
        });
      });
      continue;
    }
    const cssVar = COLOR_VARS[key];
    if (cssVar == null) {
      unmapped.push(key);
      continue;
    }
    checks.push({ key, expected: value, cssExpr: `var(${cssVar})`, kind: 'color' });
  }
  for (const [key, value] of Object.entries(doc.rounded ?? {})) {
    const cssExpr = RADIUS_EXPRS[key];
    if (cssExpr == null || Array.isArray(value)) continue;
    checks.push({ key: `rounded.${key}`, expected: value, cssExpr, kind: 'length' });
  }
  return { checks, unmapped };
}
