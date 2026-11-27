import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { EN } from '../src/i18n/en.js';
import { scanFile } from './i18n-scan.js';

const SRC = new URL('../src/', import.meta.url).pathname;
const SHARED_SRC = new URL('../../../packages/shared/src/', import.meta.url).pathname;
const DESKTOP_SRC = new URL('../../desktop/src/', import.meta.url).pathname;
const GLOSSARY = new URL('../../../CONTEXT.md', import.meta.url).pathname;

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
    pattern: /(?<![\w-])font-(?:extrabold|black)(?![\w-])/,
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
      /transition-\[[^\]]*(?:width|height|top|left|right|bottom|margin|padding|inset)[^\]]*\]|transition(?:-property)?:[^;\n{}'"`]*\b(?:width|height|top|left|right|bottom|inset|margin|padding)(?:-[a-z]+)*(?![a-z-])/,
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
    pattern:
      /(?<![\w-])drop-shadow(?![\w])|(?<![\w-])shadow-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|black|white)(?![\w-])/,
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
const SHADOW_DECLARATION = /(?:box-shadow|text-shadow)\s*:\s*([^;{}]*)/gi;
const SHADOW_STYLE_OBJECT = /\bboxShadow\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const SHADOW_ARBITRARY = /(?<![\w-])shadow-\[([^\]]*)\]/g;
const SHADOW_TOKEN_CALL = /\b(?:var|calc|min|max|clamp)\([^()]*\)/gi;
const SHADOW_COLOR_FUNCTION = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
const SHADOW_NEUTRAL_WORD = /^(?:inset|none|inherit|initial|unset|revert|revert-layer|currentcolor|transparent)$/i;
const HYPE =
  /\b(?:supercharge[sd]?|seamless(?:ly)?|unlock(?:s|ed|ing)?|magic(?:al|ally)?|revolutioni[sz]e[sd]?|game-?changing|effortless(?:ly)?|blazing(?:ly)?|ai-powered|next-gen)\b/i;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const JUSTIFICATION =
  /因为|由于|所以|因此|以便|之所以|\b(?:because|so that|in order to|which is why|that is why|that's why)\b/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const stripBlockComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

function bareShadowColor(value: string): boolean {
  const withoutTokens = value.replace(SHADOW_TOKEN_CALL, ' ').replace(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)[a-z%]*/gi, ' ');
  return (withoutTokens.match(/[a-z][\w-]*/gi) ?? []).some((word) => !SHADOW_NEUTRAL_WORD.test(word));
}

function coloredShadowIn(text: string): boolean {
  const values = [
    ...[...text.matchAll(SHADOW_DECLARATION)].map((declaration) => declaration[1] ?? ''),
    ...[...text.matchAll(SHADOW_STYLE_OBJECT)].map((object) => object[2] ?? ''),
    ...[...text.matchAll(SHADOW_ARBITRARY)].map((arbitrary) => (arbitrary[1] ?? '').replace(/_/g, ' ')),
  ];
  return values.some((value) => SHADOW_COLOR_FUNCTION.test(value) || bareShadowColor(value));
}

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
  for (const match of text.matchAll(
    /font-weight:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|font-\[(?:number:)?([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\]/gi,
  )) {
    if (Number(match[1] ?? match[2]) >= 800) found.push('heavy weight');
  }
  for (const m of text.matchAll(OVERSHOOT)) {
    const y1 = Number(m[2]);
    const y2 = Number(m[4]);
    if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) found.push('overshoot easing');
  }
  for (const m of text.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) {
    if (LAYOUT_KEYFRAME.test(m[1] ?? '')) found.push('layout keyframe');
  }
  if (coloredShadowIn(text)) found.push('colored glow');
  return [...new Set(found)];
}

function copySignsIn(text: string): string[] {
  const found: string[] = [];
  if (/[!！]/.test(text)) found.push('exclamation');
  if (PICTOGRAPH.test(text)) found.push('emoji');
  if (HYPE.test(text)) found.push('hype word');
  if (JUSTIFICATION.test(text)) found.push('justification');
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

const LABEL_CONSTANT = /\b(?:title|label|aria-label)(?:=\{|:\s*)t\(\s*([A-Z_]\w*)\.(\w+)\s*[,)]/g;
const BUTTON_OPEN = /<((?:[A-Z]\w*)?Button|button)\b((?:=>|[^>])*)>/g;
const BUTTON_CHILD = /\{\s*(?:t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)|([A-Z_]\w*)\.(\w+))\s*\}/g;

function buttonChildLiterals(text: string, constants: Map<string, string>): string[] {
  const found: string[] = [];
  for (const open of text.matchAll(BUTTON_OPEN)) {
    if ((open[2] ?? '').trimEnd().endsWith('/')) continue;
    const childrenFrom = open.index + open[0].length;
    const childrenTo = text.indexOf(`</${open[1]}>`, childrenFrom);
    if (childrenTo < 0) continue;
    for (const child of text.slice(childrenFrom, childrenTo).matchAll(BUTTON_CHILD)) {
      found.push(child[2] ?? constants.get(`${child[3]}.${child[4]}`) ?? '');
    }
  }
  return found;
}

function copyConstantsIn(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const block of text.matchAll(/\bconst ([A-Z_]\w*) = \{([\s\S]*?)\n\}/g)) {
    for (const prop of (block[2] ?? '').matchAll(/(\w+):\s*'((?:\\.|[^'\\])*)'/g)) {
      found.set(`${block[1]}.${prop[1]}`, prop[2] ?? '');
    }
  }
  return found;
}

const copyConstants = new Map(
  [...walk(SRC), ...walk(SHARED_SRC)]
    .filter((path) => /\.tsx?$/.test(path))
    .flatMap((path) => [...copyConstantsIn(readFileSync(path, 'utf8'))]),
);

const labelLiterals = (text: string, constants: Map<string, string> = copyConstants) => [
  ...[...text.matchAll(LABEL_LITERAL)].map((m) => m[2] ?? ''),
  ...[...text.matchAll(LABEL_CONSTANT)].flatMap((m) => constants.get(`${m[1]}.${m[2]}`) ?? []),
  ...buttonChildLiterals(text, constants),
];

const INFO_PROP = /\binfo(?:=\{|:\s*)$/;
const INFO_CONSTANT = /\binfo:\s*'((?:\\.|[^'\\])*)'/g;

function tooltipOnlyStrings(texts: string[], en: Record<string, string>): Set<string> {
  const visible = new Set<string>();
  const tooltip = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(T_LITERAL)) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      (INFO_PROP.test(before) ? tooltip : visible).add(m[2] ?? '');
    }
    for (const m of text.matchAll(INFO_CONSTANT)) tooltip.add(m[1] ?? '');
  }
  const only = [...tooltip].filter((key) => !visible.has(key));
  return new Set([...only, ...only.flatMap((key) => en[key] ?? [])]);
}

function justificationOffenders(texts: string[], en: Record<string, string>): string[] {
  const tooltipOnly = tooltipOnlyStrings(texts, en);
  const strings = new Set([
    ...Object.keys(en),
    ...Object.values(en),
    ...texts.flatMap((text) => [...text.matchAll(T_LITERAL)].map((m) => m[2] ?? '')),
  ]);
  return [...strings].filter((text) => JUSTIFICATION.test(text) && !tooltipOnly.has(text));
}

const uiStrings = [
  ...new Set([
    ...Object.keys(EN),
    ...Object.values(EN),
    ...sourceFiles.flatMap(({ text }) => [...text.matchAll(T_LITERAL)].map((m) => m[2] ?? '')),
  ]),
];

const REGISTER_SECTIONS = ['## Status words', '## Copy register'];

function avoidFormsIn(glossary: string): RegExp[] {
  return REGISTER_SECTIONS.flatMap((heading) => {
    const from = glossary.indexOf(heading);
    if (from < 0) throw new Error(`CONTEXT.md has no ${heading} section`);
    const next = glossary.indexOf('\n## ', from + heading.length);
    const rows = glossary
      .slice(from, next < 0 ? undefined : next)
      .split('\n')
      .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line));
    return rows.slice(1).flatMap((row) => {
      const cells = row.split(' | ');
      const avoid = cells[cells.length - 1] ?? '';
      return [...avoid.matchAll(/`([^`]+)`/g)].map(({ 1: form = '' }) =>
        form.startsWith('/') && form.endsWith('/')
          ? new RegExp(form.slice(1, -1), 'u')
          : new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
      );
    });
  });
}

const AVOID_FORMS = avoidFormsIn(readFileSync(GLOSSARY, 'utf8'));

const registerOffenders = (strings: string[], forms: RegExp[] = AVOID_FORMS) =>
  strings.flatMap((text) => forms.filter((form) => form.test(text)).map((form) => `${form.source}: ${text}`));

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const CJK = /[\u4e00-\u9fff]/;

const sourceCjkStrings = walk(SRC)
  .filter((path) => /\.tsx?$/.test(path) && !path.startsWith(join(SRC, 'fixtures')))
  .flatMap((path) => scanFile(path, SRC))
  .map(({ text }) => text);

const desktopStrings = walk(DESKTOP_SRC)
  .filter((path) => /\.ts$/.test(path))
  .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(STRING_LITERAL)].map((m) => m[2] ?? ''))
  .filter((text) => CJK.test(text) || /\b(?:Cairn|Install|update)\b/.test(text));

describe('unslop signs: the scanner catches a seeded violation', () => {
  test.each([
    ['uppercase label', '<span className="text-meta uppercase tracking-wide">Paid this month</span>'],
    ['uppercase label', '.label { text-transform: uppercase; }'],
    ['letter spacing', '<p className="text-meta tracking-[0.02em]">Plan</p>'],
    ['letter spacing', '<h1 className="tracking-tight">Inbox</h1>'],
    ['letter spacing', '.small { letter-spacing: -0.01em; }'],
    ['heavy weight', '<h1 className="font-extrabold">Inbox</h1>'],
    ['heavy weight', 'h1 { font-weight: 900; }'],
    ['heavy weight', '<h1 className="font-[850]">Inbox</h1>'],
    ['heavy weight', '<h1 className="font-[number:825.5]">Inbox</h1>'],
    ['heavy weight', 'h1 { font-weight: 850; }'],
    ['heavy weight', 'h1 { font-weight: 999.5; }'],
    ['heavy weight', 'h1 { font-weight: 1000; }'],
    ['heavy weight', 'h1 { font-weight: +850; }'],
    ['heavy weight', 'h1 { font-weight: 8e2; }'],
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
    ['layout transition', '.panel { transition: margin-left 200ms ease; }'],
    ['layout transition', '.panel { transition-property: inset; }'],
    ['layout transition', '.panel { transition: padding-inline 120ms; }'],
    ['gradient text', '<h1 className="bg-gradient-to-r from-violet-500 to-pink-500 bg-clip-text">Cairn</h1>'],
    ['colored glow', '<div className="shadow-[0_0_20px_rgba(139,92,246,0.5)]" />'],
    ['colored glow', '<div className="shadow-lg shadow-red-500" />'],
    ['colored glow', '.card { box-shadow: 0 0 20px red; }'],
    ['colored glow', '<div className="shadow-[0_0_20px_red]" />'],
    ['colored glow', '<div style={{ boxShadow: \'0 0 20px red\' }} />'],
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
    '<div className="shadow-lg" />',
    '<div className="shadow-(--e1)" />',
    '.panel { box-shadow: 0 0 0 1px var(--border); }',
    '.panel { box-shadow: none; }',
    '<div style={{ boxShadow: stone.shadow }} />',
    '<div className="[transition:visibility_0s_linear_var(--dur-overlay)]" />',
    '<span className="font-semibold">Inbox</span>',
    '<span className="font-[799.5]">Inbox</span>',
    '.title { font-weight: 799.5; }',
    '.title { font-weight: 7.99e2; }',
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
    ['justification', '当前默认：stub-model · Stub Gateway（因为这是最早添加、Coordinator 能直接用的服务商）'],
    ['justification', 'Current default: stub-model (because it was the first provider added)'],
  ])('copy %s: %s', (name, text) => {
    expect(copySignsIn(text)).toContain(name);
  });

  test.each([
    ["title={t('尚无密钥。')}", true],
    ["label: t('Save.')", true],
    ["title={t('确定删除该任务？此操作不可撤销。')}", false],
    ["title={t('尚无密钥')}", false],
    ["label: t('Loading…')", false],
    ["export const PAGE_COPY = {\n  empty: '尚无技能。',\n} as const;\ntitle={t(PAGE_COPY.empty)}", true],
    ["export const PAGE_COPY = {\n  empty: '尚无技能',\n} as const;\ntitle={t(PAGE_COPY.empty)}", false],
    ["<Button>{t('Save.')}</Button>", true],
    ["<Button variant=\"primary\" onClick={() => save()}>{t('保存。')}</Button>", true],
    ['<button type="button">{t(\'Retry.\')}</button>', true],
    ["<IconButton icon={Trash}>{t('Remove.')}</IconButton>", true],
    ["export const PAGE_COPY = {\n  save: '保存。',\n} as const;\n<Button>{PAGE_COPY.save}</Button>", true],
    ["<Button>{t('Save')}</Button>", false],
    ["<Button\n  variant=\"primary\"\n>\n  {t('Save')}\n</Button>", false],
    ['<Button className="icon" />\n<p>{t(\'Save.\')}</p>', false],
  ])('label literal %s ends in a period: %s', (snippet, expected) => {
    expect(labelLiterals(snippet, copyConstantsIn(snippet)).some(endsLikeASentenceLabel)).toBe(expected);
  });

  test.each([
    [`<SettingsRow label={t('提醒')} hint={t('因为团队有 key')} />`, ['因为团队有 key']],
    [`<SettingsSection title={t('提醒')} description={t('Because the team has a key')} />`, ['Because the team has a key']],
    [`<SettingsRow label={t('提醒')} info={t('因为团队有 key')} />`, []],
    [`<InfoTip info={t('因为团队有 key')} />`, []],
    [`const COPY = {\n  info: '因为团队有 key',\n};`, []],
    [`<InfoTip info={t('因为团队有 key')} />\n<p>{t('因为团队有 key')}</p>`, ['因为团队有 key']],
  ])('justification outside the info tooltip is rejected: %s', (snippet, expected) => {
    expect(justificationOffenders([snippet], {})).toEqual(expected);
  });

  test('a tooltip-only key keeps its translation exempt, a visible key does not', () => {
    const en = { 因为团队有key: 'Because the team has a key' };
    expect(justificationOffenders([`<InfoTip info={t('因为团队有key')} />`], en)).toEqual([]);
    expect(justificationOffenders([`<p>{t('因为团队有key')}</p>`], en)).toEqual([
      '因为团队有key',
      'Because the team has a key',
    ]);
  });

  test.each([
    ['连不上'],
    ['没能保存，请稍后重试。'],
    ['还没有定时任务'],
    ['执行机跑任务时会拿到它们。'],
    ['这把 key 没有通过检查'],
    ['Unreachable'],
    ['Broken'],
    ["Can't reach the model provider"],
    ['选择机器'],
    ['多半是服务商那边慢，重试一般就好'],
  ])('T5 register catches %s', (text) => {
    expect(registerOffenders([text])).not.toEqual([]);
  });

  test.each([
    ['无法连接'],
    ['未能保存，请稍后重试。'],
    ['暂无定时任务'],
    ['连接 Telegram 机器人'],
    ['API key 无效'],
    ['Cannot connect'],
    ['just now'],
    ['Connecting to {machine}…'],
  ])('T5 register passes %s', (text) => {
    expect(registerOffenders([text])).toEqual([]);
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
      /\[data-slot="dialog-overlay"\],\s*\[data-slot="alert-dialog-overlay"\],\s*\[data-slot="dialog-content"\],\s*\[data-slot="alert-dialog-content"\] \{[^}]*transition-property: opacity, transform, translate, scale, visibility;/,
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
      .map((text) => ({ text, signs: copySignsIn(text).filter((sign) => sign !== 'justification') }))
      .filter(({ signs }) => signs.length > 0)
      .map(({ text, signs }) => `${signs.join(',')}: ${text}`);
    expect(offenders).toEqual([]);
  });

  test('T4 justification appears only inside an info tooltip', () => {
    expect(
      justificationOffenders(
        sourceFiles.map(({ text }) => text),
        EN,
      ),
    ).toEqual([]);
  });

  test('T5 the zh/en tables and t() strings use the CONTEXT.md status words and register', () => {
    expect(registerOffenders([...new Set([...uiStrings, ...sourceCjkStrings])])).toEqual([]);
  });

  test('T5 the desktop dialog copy uses the CONTEXT.md status words and register', () => {
    expect(registerOffenders(desktopStrings)).toEqual([]);
  });
});
