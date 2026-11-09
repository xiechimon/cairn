import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { EN } from '../src/i18n/en.js';

const SRC = new URL('../src/', import.meta.url).pathname;

interface Sign {
  id: string;
  name: string;
  pattern: RegExp;
  allowed: string[];
}

const SIGNS: Sign[] = [
  {
    id: 'V22',
    name: 'uppercase label',
    pattern: /(?<![\w-])uppercase(?![\w-])|text-transform:\s*uppercase/,
    allowed: [],
  },
  {
    id: 'V22',
    name: 'letter spacing',
    pattern: /(?<![\w-])tracking-(?!normal(?![\w-]))[\w[\].-]+|letter-spacing:\s*(?!\s|normal\b|0\s*[;}])/,
    allowed: ['components/ui/empty.tsx'],
  },
  {
    id: 'V23',
    name: 'heavy weight',
    pattern: /(?<![\w-])font-(?:extrabold|black)(?![\w-])|font-weight:\s*[89]00|font-\[[89]00\]/,
    allowed: [],
  },
  {
    id: 'V23',
    name: 'italic chrome',
    pattern: /(?<![\w-])italic(?![\w-])|font-style:\s*italic/,
    allowed: [],
  },
  {
    id: 'V24',
    name: 'transition all',
    pattern: /(?<![\w-])transition-all(?![\w-])|transition(?:-property)?:\s*all(?![a-z-])/,
    allowed: ['components/ui/badge.tsx', 'components/ui/switch.tsx', 'components/ui/tabs.tsx'],
  },
  {
    id: 'V24',
    name: 'state transform',
    pattern: /(?<![\w-])(?:group-|peer-)?(?:hover|focus|focus-visible):-?(?:scale|translate|rotate)-/,
    allowed: [],
  },
  {
    id: 'V24',
    name: 'attention loop',
    pattern: /(?<![\w-])animate-(?:ping|bounce)(?![\w-])/,
    allowed: [],
  },
  {
    id: 'V24',
    name: 'pulse outside loading',
    pattern: /(?<![\w-])animate-pulse(?![\w-])/,
    allowed: ['components/composer-attachment-tile.tsx', 'components/ui/skeleton.tsx'],
  },
  {
    id: 'V24',
    name: 'layout transition',
    pattern:
      /transition-\[[^\]]*(?:width|height|top|left|right|bottom|margin|padding|inset)[^\]]*\]|transition(?:-property)?:[^;\n{}'"`]*\b(?:width|height|top|left|margin|padding)(?![a-z-])/,
    allowed: ['components/segmented.tsx', 'components/ui/trace.tsx'],
  },
  {
    id: 'V3',
    name: 'gradient text',
    pattern: /(?<![\w-])bg-clip-text(?![\w-])|background-clip:\s*text/,
    allowed: [],
  },
  {
    id: 'V3',
    name: 'colored glow',
    pattern: /(?<![\w-])drop-shadow(?![\w])|shadow-\[[^\]]*(?:#|rgba?\(|hsla?\(|oklch\()/,
    allowed: [],
  },
  {
    id: 'V3',
    name: 'sparkle icon',
    pattern: /\b(?:Sparkles?|WandSparkles|Wand2?|BotMessageSquare)(?:Icon)?\b/,
    allowed: [],
  },
];

const OVERSHOOT = /cubic-bezier\(\s*([-\d.]+)[\s,_]+([-\d.]+)[\s,_]+([-\d.]+)[\s,_]+([-\d.]+)\s*\)/g;
const LAYOUT_KEYFRAME = /(?:^|[{;\s])(?:width|height|top|left|right|bottom|inset|margin[\w-]*|padding[\w-]*)\s*:/;
const HYPE =
  /\b(?:supercharge[sd]?|seamless(?:ly)?|unlock(?:s|ed|ing)?|magic(?:al|ally)?|revolutioni[sz]e[sd]?|game-?changing|effortless(?:ly)?|blazing(?:ly)?|ai-powered|next-gen)\b/i;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const stripBlockComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

const SHIMMER = /@utility shimmer \{[\s\S]*?\n\}\n/;

const sourceFiles = walk(SRC)
  .filter((path) => /\.(tsx?|css)$/.test(path))
  .map((path) => {
    const rel = path.slice(SRC.length);
    const raw = stripBlockComments(readFileSync(path, 'utf8'));
    return { path: rel, text: rel === 'styles/app.css' ? raw.replace(SHIMMER, '') : raw };
  });

function signsIn(text: string): string[] {
  const found = SIGNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
  for (const m of text.matchAll(OVERSHOOT)) {
    const y1 = Number(m[2]);
    const y2 = Number(m[4]);
    if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) found.push('overshoot easing');
  }
  for (const m of text.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) {
    if (LAYOUT_KEYFRAME.test(m[1] ?? '')) found.push('layout keyframe');
  }
  return [...new Set(found)];
}

function copySignsIn(text: string): string[] {
  const found: string[] = [];
  if (/[!！]/.test(text)) found.push('exclamation');
  if (PICTOGRAPH.test(text)) found.push('emoji');
  if (HYPE.test(text)) found.push('hype word');
  return found;
}

const offendersOf = (name: string) =>
  sourceFiles
    .filter(({ text }) => signsIn(text).includes(name))
    .map(({ path }) => path)
    .sort();

const T_LITERAL = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const LABEL_LITERAL = /\b(?:title|label|aria-label)(?:=\{|:\s*)t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function endsLikeASentenceLabel(text: string): boolean {
  if (!/[。.!！]$/.test(text) || /(?:\.\.\.|…)$/.test(text)) return false;
  return !/[。.!！？?]/.test(text.slice(0, -1).replace(/\{[^}]*\}/g, ''));
}

const labelLiterals = (text: string) => [...text.matchAll(LABEL_LITERAL)].map((m) => m[2] ?? '');

const uiStrings = [
  ...new Set([
    ...Object.keys(EN),
    ...Object.values(EN),
    ...sourceFiles.flatMap(({ text }) => [...text.matchAll(T_LITERAL)].map((m) => m[2] ?? '')),
  ]),
];

describe('unslop signs: the scanner catches a seeded violation', () => {
  test.each([
    ['uppercase label', '<span className="text-meta uppercase tracking-wide">Paid this month</span>'],
    ['uppercase label', '.label { text-transform: uppercase; }'],
    ['letter spacing', '<p className="text-meta tracking-[0.02em]">Plan</p>'],
    ['letter spacing', '<h1 className="tracking-tight">Inbox</h1>'],
    ['letter spacing', '.small { letter-spacing: -0.01em; }'],
    ['heavy weight', '<h1 className="font-extrabold">Inbox</h1>'],
    ['heavy weight', 'h1 { font-weight: 900; }'],
    ['italic chrome', '<span className="text-(--text-tertiary) italic">Thinking</span>'],
    ['italic chrome', '.note { font-style: italic; }'],
    ['transition all', '<button className="transition-all duration-200">Save</button>'],
    ['transition all', '.card { transition: all 200ms ease; }'],
    ['transition all', '<div className="[transition:all_200ms_ease]" />'],
    ['state transform', '<div className="hover:scale-105">Card</div>'],
    ['state transform', '<div className="group-hover:-translate-y-1">Card</div>'],
    ['attention loop', '<span className="animate-ping">New</span>'],
    ['pulse outside loading', '<span className="size-2 animate-pulse rounded-full" />'],
    ['layout transition', '<div className="transition-[width] duration-200" />'],
    ['layout transition', '.panel { transition: height 200ms ease; }'],
    ['layout transition', '<div className="[transition:width_200ms_ease]" />'],
    ['gradient text', '<h1 className="bg-gradient-to-r from-violet-500 to-pink-500 bg-clip-text">Cairn</h1>'],
    ['colored glow', '<div className="shadow-[0_0_20px_rgba(139,92,246,0.5)]" />'],
    ['colored glow', '<span className="drop-shadow-lg">AI</span>'],
    ['sparkle icon', "import { Sparkles } from 'lucide-react';"],
    ['overshoot easing', '.pop { transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1); }'],
    ['layout keyframe', '@keyframes grow { from { width: 0; } to { width: 100%; } }'],
  ])('%s: %s', (name, snippet) => {
    expect(signsIn(snippet)).toContain(name);
  });

  test.each([
    '<h1 className="voice-title tracking-normal">Inbox</h1>',
    '.voice { letter-spacing: normal; }',
    '<button className="transition-colors duration-150">Save</button>',
    '<div className="transition-[translate,scale,opacity] duration-200" />',
    '.ease { transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); }',
    '@keyframes in { from { opacity: 0; translate: 0 8px; } to { opacity: 1; } }',
    '<div className="shadow-[inset_1px_0_0_var(--border)]" />',
    '<div className="[transition:visibility_0s_linear_var(--dur-overlay)]" />',
    '<span className="font-semibold">Inbox</span>',
  ])('clean: %s', (snippet) => {
    expect(signsIn(snippet)).toEqual([]);
  });

  test.each([
    ['exclamation', 'Welcome back, Damir!'],
    ['exclamation', '已完成！'],
    ['emoji', '🚀 Launch'],
    ['emoji', '▶ skill: {n}'],
    ['hype word', 'Supercharge your workflow'],
    ['hype word', 'installs unlock it on the next heartbeat'],
  ])('copy %s: %s', (name, text) => {
    expect(copySignsIn(text)).toContain(name);
  });

  test.each([
    ["title={t('尚无密钥。')}", true],
    ["label: t('Save.')", true],
    ["title={t('确定删除该任务？此操作不可撤销。')}", false],
    ["title={t('尚无密钥')}", false],
    ["label: t('Loading…')", false],
  ])('label literal %s ends in a period: %s', (snippet, expected) => {
    expect(labelLiterals(snippet).some(endsLikeASentenceLabel)).toBe(expected);
  });

  test('plain copy passes', () => {
    expect(copySignsIn('Queued: no machine meets the capability requirements')).toEqual([]);
    expect(copySignsIn('⌘K 搜索 · ✕ 已挡下')).toEqual([]);
  });
});

describe('unslop signs: the source carries none outside the named exceptions', () => {
  test.each(SIGNS.map((sign) => [`${sign.id} ${sign.name}`, sign] as const))('%s', (_label, sign) => {
    expect(offendersOf(sign.name)).toEqual([...sign.allowed].sort());
  });

  test('V24 no easing overshoots', () => {
    expect(offendersOf('overshoot easing')).toEqual([]);
  });

  test('V24 no keyframe animates a layout property', () => {
    expect(offendersOf('layout keyframe')).toEqual([]);
  });

  test('V3 gradient text exists only as the neutral shimmer on live trace titles', () => {
    const appCss = readFileSync(join(SRC, 'styles/app.css'), 'utf8');
    expect(appCss.match(SHIMMER)?.[0]).toMatch(/background-clip: text;/);
  });

  test('the pristine primitives keep their upstream classes but render the rule', () => {
    const appCss = readFileSync(join(SRC, 'styles/app.css'), 'utf8');
    expect(appCss).toMatch(
      /\[data-slot="dialog-overlay"\],\s*\[data-slot="alert-dialog-overlay"\],\s*\[data-slot="dialog-content"\] \{[^}]*transition-property: opacity, transform, translate, scale, visibility;/,
    );
    expect(appCss).toMatch(/\[data-slot="empty-title"\] \{[^}]*letter-spacing: normal;/);
    expect(appCss).toMatch(
      /\[data-slot="switch"\],\s*\[data-slot="badge"\],\s*\[data-slot="tabs-trigger"\] \{[^}]*transition-property: color, background-color, border-color;/,
    );
  });

  test('T4 a one-sentence title or label ends without a period', () => {
    const offenders = sourceFiles.flatMap(({ path, text }) =>
      labelLiterals(text)
        .filter(endsLikeASentenceLabel)
        .map((label) => `${path}: ${label}`),
    );
    expect(offenders).toEqual([]);
  });

  test('T4 UI copy has no exclamation, emoji or hype word', () => {
    const offenders = uiStrings
      .map((text) => ({ text, signs: copySignsIn(text) }))
      .filter(({ signs }) => signs.length > 0)
      .map(({ text, signs }) => `${signs.join(',')}: ${text}`);
    expect(offenders).toEqual([]);
  });
});
