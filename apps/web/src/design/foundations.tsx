import { cn } from 'cn';
import { useEffect, useState } from 'react';
import designDoc from '../../DESIGN.md?raw';
import { ProjectAvatar } from '../board/project-avatar.js';
import { Button } from '../components/ui/button.js';
import { docChecks, type GalleryTheme, parseFrontmatter } from './design-doc.js';
import {
  computedColor,
  computedLength,
  contrast,
  over,
  rawToken,
  rgba,
  tokenHex,
} from './measure.js';
import { Section, Specimen } from './specimen.js';

const DOC = parseFrontmatter(designDoc);

const STONES = [
  {
    name: 'popover',
    cssVar: '--popover',
    width: '46%',
    radius: 'var(--radius-popover)',
    shadow: 'var(--e2)',
  },
  {
    name: 'card',
    cssVar: '--card',
    width: '64%',
    radius: 'var(--radius-card)',
    shadow: 'var(--e1)',
  },
  {
    name: 'sheet',
    cssVar: '--background',
    width: '82%',
    radius: 'var(--edge-radius)',
    shadow: 'var(--e1)',
  },
  {
    name: 'canvas',
    cssVar: '--canvas',
    width: '100%',
    radius: 'var(--edge-radius)',
    shadow: '0 0 0 1px var(--border)',
  },
];

const INK = [
  { name: 'ink', cssVar: '--foreground', use: 'Headings and body text', need: 4.5 },
  {
    name: 'ink-2',
    cssVar: '--text-secondary',
    use: 'Navigation, buttons, descriptions',
    need: 4.5,
  },
  { name: 'ink-3', cssVar: '--text-tertiary', use: 'Meta: project, time, counts', need: 4.5 },
  { name: 'icon', cssVar: '--icon', use: 'Icons next to a label', need: 3 },
  { name: 'ink-4', cssVar: '--text-dim', use: 'Decorative icons only, never text', need: 0 },
  { name: 'accent', cssVar: '--card-button', use: 'Needs you: links, badges, focus', need: 4.5 },
  { name: 'running-text', cssVar: '--running-text', use: 'Running agents', need: 4.5 },
  { name: 'destructive', cssVar: '--destructive', use: 'Danger', need: 4.5 },
];

const SEMANTIC = [
  ['accent', '--card-button'],
  ['primary', '--primary'],
  ['accent-hover', '--accent-hover'],
  ['spot-soft', '--spot-soft'],
  ['running', '--running'],
  ['running-bar', '--running-bar'],
  ['destructive', '--destructive'],
  ['badge-attention', '--badge-attention'],
  ['secondary', '--secondary'],
  ['menu-hover', '--menu-hover'],
  ['border', '--border'],
  ['input', '--input'],
] as const;

const TYPE = [
  {
    name: 'Greeting',
    cls: 'font-serif text-greeting font-semibold tracking-[-0.01em]',
    sample: 'Good afternoon, ian',
    token: '--type-greeting',
    weight: 600,
  },
  {
    name: 'Page',
    cls: 'font-serif text-page font-semibold',
    sample: 'Waiting on you',
    token: '--type-page',
    weight: 600,
  },
  {
    name: 'Brand',
    cls: 'font-heading text-page font-title',
    sample: 'Cairn',
    token: '--type-page',
    weight: 650,
  },
  {
    name: 'Heading',
    cls: 'font-heading text-heading font-title',
    sample: 'Threads',
    token: '--type-heading',
    weight: 650,
  },
  {
    name: 'Card title',
    cls: 'text-card-title font-semibold',
    sample: 'Wire weekly review packs into eval-weekly.sh',
    token: '--type-card-title',
    weight: 600,
  },
  {
    name: 'UI',
    cls: 'text-ui',
    sample: 'Buttons, menu rows and everything you click',
    token: '--type-ui',
    weight: 450,
  },
  {
    name: 'Meta',
    cls: 'text-meta text-content-tertiary',
    sample: 'cairn · 2 hours ago · 3 of 7 steps',
    token: '--type-meta',
    weight: 450,
  },
  {
    name: 'Caption',
    cls: 'text-caption font-medium text-content-tertiary',
    sample: 'Badges and group labels',
    token: '--type-caption',
    weight: 500,
  },
];

const RADII = [
  {
    use: 'Buttons, inputs, selects, menu rows, avatars',
    expr: 'var(--radius-control)',
    token: '--radius-control',
  },
  { use: 'Cards', expr: 'var(--radius-card)', token: '--radius-card' },
  {
    use: 'Menus, dialogs, composer, chief window',
    expr: 'var(--radius-popover)',
    token: '--radius-popover',
  },
];

const MOTION = [
  { name: 'Hover and press', dur: '--dur-fast', ease: '--ease-standard' },
  { name: 'Card arrives', dur: '--dur-fast', ease: '--ease-pop' },
  { name: 'Dialog opens', dur: '--dur-overlay', ease: '--ease-standard' },
  { name: 'Card lifts', dur: null, ease: '--ease-out-expo' },
  { name: 'Chief window grows', dur: '--dur-window', ease: '--ease-drawer' },
  { name: 'Message enters', dur: '--spring-snappy-dur', ease: '--spring-snappy' },
];

const TILES = [1, 2, 3, 4, 5, 6] as const;

const ELEVATIONS = [
  {
    name: 'Card',
    token: '--e1',
    cls: 'rounded-(--radius-card) bg-card shadow-(--e1)',
    box: { top: '30%', left: '5%', height: '46%', width: '27%' },
  },
  {
    name: 'Menu',
    token: '--e2',
    cls: 'rounded-(--radius-popover) bg-popover shadow-(--e2)',
    box: { top: '20%', left: '37%', height: '46%', width: '26%' },
  },
  {
    name: 'Dialog',
    token: '--e3',
    cls: 'rounded-(--edge-radius) bg-dialog-surface shadow-(--e3)',
    box: { top: '10%', left: '68%', height: '56%', width: '27%' },
  },
];

export function FoundationsHero({ theme }: { theme: GalleryTheme }) {
  const result = runDocCheck(theme);
  return (
    <div className="grid grid-cols-1 items-end gap-12 pt-6 lg:grid-cols-2">
      <div>
        <p className="m-0 max-w-100 text-card-title text-content-secondary">
          Cairn: limestone paper, lichen ink, ochre for what waits on you. Surfaces stack like
          stones, each layer a step {theme === 'dark' ? 'lighter' : 'whiter'} than the one below,
          and status marks are the pebbles on the trail.
        </p>
        <a
          href="#doc-check"
          className="mt-6 inline-flex items-center gap-2.5 rounded-(--radius-card) bg-card px-3.5 py-2.5 text-ui text-foreground no-underline shadow-(--e1)"
        >
          <span
            className={cn(
              'size-2 rounded-full',
              result.failed.length === 0 ? 'bg-running' : 'bg-(--badge-attention)',
            )}
          />
          {result.failed.length === 0
            ? `DESIGN.md matches ${result.checks.length} ${theme} values`
            : `${result.failed.length} of ${result.checks.length} ${theme} values differ from DESIGN.md`}
        </a>
      </div>
      <div className="flex flex-col items-center">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="h-6 w-11 rounded-full bg-(--card-button) shadow-(--e2)" />
          <span className="text-meta text-content-tertiary">
            accent {tokenHex('--card-button')}
          </span>
        </div>
        {STONES.map((stone) => (
          <div
            key={stone.name}
            className="-mt-1.5 flex h-15 items-center justify-between px-5"
            style={{
              width: stone.width,
              background: `var(${stone.cssVar})`,
              borderRadius: stone.radius,
              boxShadow: stone.shadow,
            }}
          >
            <span className="text-ui font-medium text-foreground">{stone.name}</span>
            <span className="text-meta text-content-tertiary">{tokenHex(stone.cssVar)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ColorSection() {
  const card = rgba('var(--card)');
  return (
    <Section
      id="color"
      title="Color"
      lede="Four steps of ink on three layers of stone. Ochre means it waits on you, green means it is working. Ratios are measured live against the card."
    >
      <Specimen title="Ink on the card" note="WCAG 2.x contrast, text needs 4.5, labeled icons 3">
        <div className="-my-3 w-full divide-y divide-border">
          {INK.map((ink) => {
            const k = contrast(over(rgba(`var(${ink.cssVar})`), card), card);
            const pass = ink.need === 0 || k >= ink.need;
            return (
              <div key={ink.name} className="flex items-center gap-6 py-3">
                <div className="w-28 flex-none">
                  <div className="font-mono text-caption text-content-secondary">{ink.name}</div>
                  <div className="text-caption text-content-tertiary">{tokenHex(ink.cssVar)}</div>
                </div>
                <div
                  className="min-w-0 flex-auto text-card-title"
                  style={{ color: `var(${ink.cssVar})` }}
                >
                  {ink.use}
                </div>
                <div className="w-24 flex-none text-right">
                  <div className="text-ui text-foreground tabular-nums">{k.toFixed(2)}</div>
                  <div
                    className={cn(
                      'text-caption',
                      pass ? 'text-content-tertiary' : 'text-destructive',
                    )}
                  >
                    {ink.need === 0
                      ? 'decorative'
                      : pass
                        ? `passes ${ink.need}`
                        : `below ${ink.need}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Specimen>
      <Specimen title="Semantic slots" note="Click a value to copy it">
        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {SEMANTIC.map(([name, cssVar]) => (
            <Swatch key={name} name={name} cssVar={cssVar} />
          ))}
        </div>
      </Specimen>
      <Specimen title="Project tiles" note="Ink letter on an 18% tint of the same hue">
        <div className="flex flex-wrap gap-4">
          {TILES.map((i) => {
            const tint = rgba(`var(--project-tile-${i})`);
            const k = contrast(rgba(`var(--project-ink-${i})`), over({ ...tint, a: 0.18 }, card));
            return (
              <div key={i} className="flex items-center gap-2.5">
                <ProjectAvatar
                  name={'CSWDAM'[i - 1] ?? ''}
                  tone={i - 1}
                  className="size-8 text-ui"
                />
                <span
                  className={cn(
                    'text-meta tabular-nums',
                    k < 4.5 ? 'text-destructive' : 'text-content-tertiary',
                  )}
                >
                  {k.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </Specimen>
    </Section>
  );
}

function Swatch({ name, cssVar }: { name: string; cssVar: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const value = rgba(`var(${cssVar})`);
  const shown = value.a < 0.999 ? computedColor(`var(${cssVar})`) : tokenHex(cssVar);
  return (
    <Button
      variant="ghost"
      className="h-auto flex-col items-stretch gap-0 overflow-hidden border-border bg-card p-0 text-left font-normal hover:bg-card hover:shadow-(--e1) dark:hover:bg-card"
      onClick={() => {
        navigator.clipboard
          ?.writeText(`var(${cssVar})`)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      <span
        className="block h-12 w-full border-b border-border"
        style={{ background: `var(${cssVar})` }}
      />
      <span className="flex flex-col gap-0.5 px-2.5 py-2">
        <span className="text-meta font-medium text-foreground">{name}</span>
        <span className="truncate font-mono text-caption text-content-tertiary">
          {copied ? 'Copied' : shown}
        </span>
      </span>
    </Button>
  );
}

export function TypeSection() {
  return (
    <Section
      id="type"
      title="Type"
      lede="Six sizes. Bricolage Grotesque for titles and the brand, Instrument Sans for everything you read, JetBrains Mono for code and times."
    >
      <Specimen
        title="Scale"
        note="Tailwind keys text-page, text-heading, text-card-title, text-ui, text-meta, text-caption"
      >
        <div className="-my-3 w-full divide-y divide-border">
          {TYPE.map((row) => (
            <div key={row.name} className="flex items-baseline gap-6 py-3.5">
              <div className="w-28 flex-none text-meta text-content-tertiary">
                <div className="font-medium text-content-secondary">{row.name}</div>
                {computedLength(`var(${row.token})`).replace(/(\.\d)\d+/, '$1')} / {row.weight}
              </div>
              <div className={cn('min-w-0 flex-auto truncate text-foreground', row.cls)}>
                {row.sample}
              </div>
            </div>
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

export function ShapeSection() {
  const pad = Number.parseFloat(computedLength('var(--menu-pad)'));
  const menu = Number.parseFloat(computedLength('var(--radius-popover)'));
  return (
    <Section
      id="shape"
      title="Shape"
      lede="Bigger surfaces get rounder corners. An inner row's radius is its container's radius minus the padding between them."
    >
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Specimen
          title="Concentric corners"
          note={`${menu}px menu − ${pad}px padding = ${menu - pad}px rows`}
          stage="canvas"
        >
          <div
            className="w-60 bg-popover shadow-(--e2)"
            style={{ borderRadius: 'var(--radius-popover)', padding: 'var(--menu-pad)' }}
          >
            {['Rename', 'Duplicate', 'Move to project'].map((label, i) => (
              <div
                key={label}
                className={cn(
                  'flex h-8 items-center px-2.5 text-ui',
                  i === 0 && 'bg-(--menu-hover)',
                )}
                style={{ borderRadius: 'var(--radius-menu-item)' }}
              >
                {label}
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen title="Radius scale">
          <div className="-my-3 w-full divide-y divide-border">
            {RADII.map((r) => {
              const px = computedLength(r.expr);
              return (
                <div key={r.token} className="flex items-center gap-4 py-2.5">
                  <span
                    className="size-9 flex-none border-t-2 border-l-2 border-foreground opacity-80"
                    style={{ borderTopLeftRadius: px }}
                  />
                  <span className="min-w-0 flex-auto">
                    <span className="block text-ui text-foreground">{r.use}</span>
                    <span className="font-mono text-caption text-content-tertiary">{r.token}</span>
                  </span>
                  <span className="text-ui text-content-secondary tabular-nums">{px}</span>
                </div>
              );
            })}
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

export function ElevationSection() {
  return (
    <Section
      id="elevation"
      title="Elevation"
      lede="Three tokens with the hairline ring built in. Cards sit, menus float, dialogs lift. Never add a second ring or a raw shadow."
    >
      <Specimen title="Three heights" stage="canvas" className="p-0">
        <div className="relative h-72 w-full">
          {ELEVATIONS.map((e) => (
            <div key={e.token} className={cn('absolute p-4', e.cls)} style={e.box}>
              <b className="block text-ui font-medium">{e.name}</b>
              <span className="font-mono text-caption text-content-tertiary">{e.token}</span>
            </div>
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

export function MotionSection() {
  const [played, setPlayed] = useState(false);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <Section
      id="motion"
      title="Motion"
      lede="The stone is quiet. Every transition takes one of these durations and curves; play them together to compare."
    >
      <Specimen title="Durations and curves">
        <div className="flex w-full flex-col gap-1">
          <div className="mb-3">
            <Button onClick={() => setPlayed((p) => !p)}>{played ? 'Reset' : 'Play all'}</Button>
          </div>
          {MOTION.map((m) => {
            const duration = m.dur == null ? '200ms' : rawToken(m.dur);
            return (
              <div key={m.name} className="flex items-center gap-6 py-2.5">
                <div className="w-44 flex-none">
                  <div className="text-ui text-foreground">{m.name}</div>
                  <div className="font-mono text-caption text-content-tertiary">{m.ease}</div>
                </div>
                <div className="relative h-1 flex-auto rounded-full bg-(--running-track)">
                  <span
                    className="absolute -top-1.5 size-4 rounded-full bg-primary shadow-(--e1)"
                    style={{
                      left: played ? 'calc(100% - 1rem)' : 0,
                      transition: reduceMotion ? 'none' : `left ${duration} var(${m.ease})`,
                    }}
                  />
                </div>
                <div className="w-14 flex-none text-right text-meta text-content-secondary tabular-nums">
                  {duration}
                </div>
              </div>
            );
          })}
        </div>
      </Specimen>
    </Section>
  );
}

function runDocCheck(theme: GalleryTheme) {
  const { checks, unmapped } = docChecks(DOC, theme);
  const failed = checks.flatMap((check) => {
    const got =
      check.kind === 'length' ? computedLength(check.cssExpr) : computedColor(check.cssExpr);
    const want = check.kind === 'length' ? check.expected : computedColor(check.expected);
    return got === want ? [] : [{ ...check, got }];
  });
  return { checks, unmapped, failed };
}

const DOC_GROUPS: [string, (key: string) => boolean][] = [
  ['Corners', (k) => k.startsWith('rounded.')],
  ['Tiles', (k) => k.startsWith('project-tiles')],
  ['Running', (k) => k.startsWith('running')],
  ['Ink', (k) => k.startsWith('ink') || k === 'icon'],
  ['Overlay', (k) => k === 'backdrop'],
  [
    'Surfaces',
    (k) => ['canvas', 'sheet', 'card', 'popover', 'hover', 'line', 'rule', 'divider'].includes(k),
  ],
  ['Actions', () => true],
];

function docGroup(key: string): string {
  return DOC_GROUPS.find(([, match]) => match(key))?.[0] ?? 'Actions';
}

function DocRing({ done, total }: { done: number; total: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const ok = done === total;
  return (
    <div className="relative size-28 flex-none">
      <svg viewBox="0 0 112 112" className="size-28" aria-hidden="true">
        <circle cx="56" cy="56" r={r} fill="none" stroke="var(--running-track)" strokeWidth="10" />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          stroke={ok ? 'var(--running-bar)' : 'var(--destructive)'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - done / Math.max(total, 1))}
          transform="rotate(-90 56 56)"
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-page font-title tabular-nums">
          {done}/{total}
        </span>
        <span className="text-caption text-content-tertiary">in sync</span>
      </span>
    </div>
  );
}

function DocSwatch({ value, kind }: { value: string; kind: 'color' | 'length' }) {
  if (kind === 'length')
    return (
      <span
        className="size-4 flex-none border-t-[1.5px] border-l-[1.5px] border-content-tertiary"
        style={{ borderTopLeftRadius: `min(${value}, 12px)` }}
      />
    );
  return (
    <span
      className="size-4 flex-none rounded-(--cds-radius-xs) ring-1 ring-foreground/10"
      style={{ background: value }}
    />
  );
}

export function DocCheckSection({ theme }: { theme: GalleryTheme }) {
  const { checks, unmapped, failed } = runDocCheck(theme);
  const [showAll, setShowAll] = useState(false);
  const failedKeys = new Set(failed.map((f) => f.key));
  const groups = DOC_GROUPS.map(([name]) => {
    const members = checks.filter((c) => docGroup(c.key) === name);
    return {
      name,
      total: members.length,
      ok: members.filter((c) => !failedKeys.has(c.key)).length,
    };
  }).filter((g) => g.total > 0);
  const colorChecks = checks.filter((c) => c.kind === 'color');
  const cornerChecks = checks.filter((c) => c.kind === 'length');
  const okCount = checks.length - failed.length;
  const summary = [
    ['Theme', theme === 'dark' ? 'Dark' : 'Light'],
    [
      'Colors',
      `${colorChecks.filter((c) => !failedKeys.has(c.key)).length} of ${colorChecks.length}`,
    ],
    [
      'Corners',
      `${cornerChecks.filter((c) => !failedKeys.has(c.key)).length} of ${cornerChecks.length}`,
    ],
  ];
  return (
    <Section
      id="doc-check"
      title="Doc check"
      lede="Every value in the DESIGN.md frontmatter, compared with what the current theme renders. Switch themes to check the other side."
    >
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-4 rounded-(--radius-card) bg-card p-5 shadow-(--e1)">
          <DocRing done={okCount} total={checks.length} />
          <div>
            <h3 className="m-0 font-heading text-heading font-title">
              {failed.length === 0 ? 'In sync' : `${failed.length} drifted`}
            </h3>
            <p className="m-0 mt-1 text-ui text-content-secondary">
              {failed.length === 0
                ? 'DESIGN.md and the code agree on every value.'
                : 'These tokens no longer match DESIGN.md.'}
            </p>
          </div>
          <dl className="m-0 grid gap-2 text-ui">
            {summary.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-content-tertiary">{k}</dt>
                <dd className="m-0 tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-(--radius-card) bg-card shadow-(--e1)">
          <h3 className="m-0 px-5 pt-4 pb-2 text-ui font-semibold">Needs attention</h3>
          <div className="px-2 pb-2">
            {failed.length === 0 ? (
              <p className="m-0 px-3 py-2 text-ui text-content-tertiary">Nothing drifted.</p>
            ) : (
              failed.map((f) => (
                <div
                  key={f.key}
                  className="grid grid-cols-[1.2fr_1fr_1fr] items-center gap-3 rounded-(--radius-menu-item) bg-danger-soft px-3 py-2.5"
                >
                  <span className="font-mono text-caption font-medium">{f.key}</span>
                  <span className="flex items-center gap-2">
                    <DocSwatch value={f.expected} kind={f.kind} />
                    <span className="flex flex-col">
                      <span className="text-caption text-content-tertiary">DESIGN.md</span>
                      <span className="font-mono text-caption">{f.expected}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <DocSwatch value={f.got} kind={f.kind} />
                    <span className="flex flex-col">
                      <span className="text-caption text-content-tertiary">Rendered</span>
                      <span className="font-mono text-caption text-destructive">{f.got}</span>
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
          <h3 className="m-0 px-5 pt-3 pb-2 text-ui font-semibold">In sync</h3>
          <div className="flex flex-wrap gap-1.5 px-5 pb-4">
            {groups.map((g) => (
              <span
                key={g.name}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-meta font-medium',
                  g.ok === g.total
                    ? 'bg-(--chip-done-bg) text-(--chip-done-fg)'
                    : 'bg-danger-soft text-destructive',
                )}
              >
                {g.name} {g.ok}/{g.total}
              </span>
            ))}
          </div>
          {unmapped.length > 0 && (
            <p className="m-0 px-5 pb-4 text-meta text-content-tertiary">
              In DESIGN.md but not a token in code: {unmapped.join(', ')}.
            </p>
          )}
          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
              className="w-full justify-start px-3 text-ui text-content-secondary aria-expanded:bg-transparent"
            >
              {showAll ? 'Hide values' : `Show all ${checks.length} values`}
            </Button>
          </div>
          {showAll && (
            <div className="divide-y divide-border border-t border-border">
              {checks.map((c) => (
                <div
                  key={c.key}
                  className="grid grid-cols-[1.2fr_1fr_auto] items-center gap-3 px-5 py-2"
                >
                  <span className="flex items-center gap-2.5 text-ui">
                    <DocSwatch value={c.expected} kind={c.kind} />
                    {c.key}
                  </span>
                  <span className="font-mono text-caption text-content-secondary">
                    {c.expected}
                  </span>
                  <span
                    className={cn(
                      'text-meta font-medium',
                      failedKeys.has(c.key) ? 'text-destructive' : 'text-running-text',
                    )}
                  >
                    {failedKeys.has(c.key) ? 'Drifted' : 'Match'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
