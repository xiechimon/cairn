import { cn } from 'cn';
import { useState } from 'react';
import designDoc from '../../DESIGN.md?raw';
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
    name: 'Page',
    cls: 'text-page font-medium',
    sample: 'Needs your attention',
    token: '--type-page',
    weight: 500,
  },
  {
    name: 'Heading',
    cls: 'text-heading font-medium',
    sample: 'Running',
    token: '--type-heading',
    weight: 500,
  },
  {
    name: 'Brand',
    cls: 'text-heading font-semibold',
    sample: 'Cairn',
    token: '--type-heading',
    weight: 600,
    serif: true,
  },
  {
    name: 'Card title',
    cls: 'text-card-title font-medium',
    sample: 'Wire weekly review packs into eval-weekly.sh',
    token: '--type-card-title',
    weight: 500,
  },
  {
    name: 'UI',
    cls: 'text-ui',
    sample: 'Buttons, menu rows and everything you click',
    token: '--type-ui',
    weight: 400,
  },
  {
    name: 'Meta',
    cls: 'text-meta text-content-tertiary',
    sample: 'cairn · 2 hours ago · 3 of 7 steps',
    token: '--type-meta',
    weight: 400,
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
    use: 'Inputs, selects, dialog buttons',
    expr: 'calc(var(--radius) * 0.8)',
    token: 'rounded-md',
  },
  {
    use: 'Buttons, icon buttons, avatars',
    expr: 'var(--radius-control)',
    token: '--radius-control',
  },
  { use: 'Menu rows', expr: 'var(--radius-menu-item)', token: '--radius-menu-item' },
  { use: 'Dialogs, ⌘K', expr: 'var(--edge-radius)', token: '--edge-radius' },
  { use: 'Menus, popovers', expr: 'var(--radius-popover)', token: '--radius-popover' },
  { use: 'Cards', expr: 'var(--radius-card)', token: '--radius-card' },
  { use: 'Composer, chief window', expr: 'var(--radius-composer)', token: '--radius-composer' },
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
    box: { top: '18%', left: '6%', height: '54%', width: '40%' },
  },
  {
    name: 'Menu',
    token: '--e2',
    cls: 'rounded-(--radius-popover) bg-popover shadow-(--e2)',
    box: { top: '36%', left: '34%', height: '42%', width: '28%' },
  },
  {
    name: 'Dialog',
    token: '--e3',
    cls: 'rounded-(--edge-radius) bg-dialog-surface shadow-(--e3)',
    box: { top: '12%', left: '56%', height: '62%', width: '38%' },
  },
];

export function FoundationsHero({ theme }: { theme: GalleryTheme }) {
  const result = runDocCheck(theme);
  return (
    <div className="grid grid-cols-1 items-end gap-12 pt-6 lg:grid-cols-2">
      <div>
        <p className="m-0 max-w-100 text-card-title text-content-secondary">
          Warm paper, dense rows, one accent. Surfaces stack like stones, each layer a step
          {theme === 'dark' ? ' lighter' : ' whiter'} than the one below, and the accent sits on top
          as the marker.
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
  const onAccent = rgba('var(--text-on-accent)');
  return (
    <Section
      id="color"
      title="Color"
      lede="Four steps of ink on three layers of paper. One accent means it needs you, one green means it is running. Ratios are measured live against the card."
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
      <Specimen title="Project tiles" note="Letters use --text-on-accent">
        <div className="flex flex-wrap gap-4">
          {TILES.map((i) => {
            const k = contrast(onAccent, rgba(`var(--project-tile-${i})`));
            return (
              <div key={i} className="flex items-center gap-2.5">
                <span
                  className="grid size-8 place-items-center rounded-(--radius-control) text-ui font-semibold text-(--text-on-accent)"
                  style={{ background: `var(--project-tile-${i})` }}
                >
                  {'CSWDAM'[i - 1]}
                </span>
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
  const value = rgba(`var(${cssVar})`);
  const shown = value.a < 0.999 ? computedColor(`var(${cssVar})`) : tokenHex(cssVar);
  return (
    <Button
      variant="ghost"
      className="h-auto flex-col items-stretch gap-0 overflow-hidden border-border bg-card p-0 text-left font-normal hover:bg-card hover:shadow-(--e1) dark:hover:bg-card"
      onClick={() => {
        void navigator.clipboard?.writeText(`var(${cssVar})`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
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
      lede="Six sizes and three weights. Inter for everything you read; Source Serif only for the brand and the chief greeting."
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
              <div
                className={cn('min-w-0 flex-auto truncate text-foreground', row.cls)}
                style={row.serif === true ? { fontFamily: 'var(--font-serif)' } : undefined}
              >
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
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
  return (
    <Section
      id="motion"
      title="Motion"
      lede="The paper is quiet. Every transition takes one of these durations and curves; play them together to compare."
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
                    className="absolute -top-1.5 size-4 rounded-full bg-(--card-button) shadow-(--e1) motion-reduce:transition-none"
                    style={{
                      left: played ? 'calc(100% - 1rem)' : 0,
                      transition: `left ${duration} var(${m.ease})`,
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

export function DocCheckSection({ theme }: { theme: GalleryTheme }) {
  const { checks, unmapped, failed } = runDocCheck(theme);
  return (
    <Section
      id="doc-check"
      title="Doc check"
      lede="Every value in the DESIGN.md frontmatter, compared with what the current theme renders. Switch themes to check the other side."
    >
      <Specimen
        title={`${theme === 'dark' ? 'Dark' : 'Light'} theme`}
        note={`${checks.length} values checked`}
      >
        {failed.length === 0 ? (
          <p className="m-0 flex items-center gap-2.5 text-ui text-foreground">
            <span className="size-2 rounded-full bg-running" />
            DESIGN.md and the code agree on all {checks.length} values.
          </p>
        ) : (
          <div className="-my-3 w-full divide-y divide-border">
            {failed.map((f) => (
              <div key={f.key} className="grid grid-cols-3 gap-4 py-2.5 text-meta">
                <span className="font-mono text-content-secondary">{f.key}</span>
                <span className="text-content-tertiary">DESIGN.md: {f.expected}</span>
                <span className="text-foreground">Code: {f.got}</span>
              </div>
            ))}
          </div>
        )}
        {unmapped.length > 0 && (
          <p className="m-0 w-full text-meta text-content-tertiary">
            In DESIGN.md but not a token in code: {unmapped.join(', ')}.
          </p>
        )}
      </Specimen>
    </Section>
  );
}
