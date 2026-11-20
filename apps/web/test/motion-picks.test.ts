import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;

const read = (rel: string) => readFileSync(`${SRC}${rel}`, 'utf8');
const appCss = read('styles/app.css');
const shadcnCss = read('styles/shadcn.css');
const motionCss = read('styles/motion.css');

const ruleBody = (css: string, name: string) => {
  const at = css.indexOf(`@utility ${name} {`);
  if (at < 0) return '';
  const rest = css.slice(at);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};

describe('pick 2: RingSpinner is the loading.dev Ring', () => {
  const spinner = read('components/ui/ring-spinner.tsx');

  test('renders the Ring geometry, not a lucide loader', () => {
    expect(spinner).not.toMatch(/lucide|Loader2|LoaderCircle|animate-spin/);
    expect(spinner).toContain('opacity="0.2"');
    expect(spinner).toContain('strokeDasharray="16 46.8"');
    expect(spinner).toContain('strokeLinecap="round"');
    expect(spinner).toContain('spin-ring');
  });

  test('the registry spinner item stays pristine upstream', () => {
    const registry = read('components/ui/spinner.tsx');
    expect(registry).toContain('Loader2Icon');
    expect(registry).toContain('animate-spin');
    expect(registry).not.toContain('strokeDasharray');
  });

  test('every busy indicator consumes the Ring adapter', () => {
    const consumers = [
      'board/archived-project-bar.tsx',
      'board/computer-screen.tsx',
      'board/first-run-setup.tsx',
      'board/local-provider-import.tsx',
      'board/thread-actions.tsx',
      'chief/approval-card.tsx',
      'chief/package-install-card.tsx',
      'components/ui/toaster.tsx',
      'overlay/token-gate.tsx',
      'pages/project-settings-page.tsx',
      'resources/antigravity-subscriptions.tsx',
      'resources/devin-subscriptions.tsx',
      'resources/provider-editors.tsx',
      'resources/upstream-model-picker.tsx',
    ];
    for (const rel of consumers) {
      const src = read(rel);
      expect(src).toContain('ring-spinner.js');
      expect(src).not.toMatch(/components\/ui\/spinner\.js/);
      expect(src).toContain('<RingSpinner');
    }
  });

  test('spin is the 800ms linear turn, off under reduced motion', () => {
    const util = ruleBody(appCss, 'spin-ring');
    expect(util).toContain('prefers-reduced-motion: no-preference');
    expect(util).toContain('spin-ring-rotate var(--dur-spin) linear infinite');
    expect(shadcnCss).toMatch(/--dur-spin:\s*800ms/);
  });

  test('keeps the MIT attribution in a NOTICE file', () => {
    const notice = `${SRC}components/ui/spinner.NOTICE.md`;
    expect(existsSync(notice)).toBe(true);
    const text = readFileSync(notice, 'utf8');
    expect(text).toContain('Jakub Krehel');
    expect(text).toContain('da6f2e6');
    expect(text).toContain('MIT');
  });

  test('no lucide loader stands in for a busy Button anymore', () => {
    const approvalCard = read('chief/approval-card.tsx');
    expect(approvalCard).not.toContain('LoaderCircle');
    expect(approvalCard).toContain('data-icon="inline-start"');
    expect(approvalCard).toContain('RingSpinner');
  });
});

describe('pick 3: labelled Button press dips to 0.97', () => {
  const pressBlock =
    appCss.match(
      /@media \(prefers-reduced-motion: no-preference\) and \(pointer: fine\) \{([\s\S]*?)\n\}\n/,
    )?.[1] ?? '';

  test('the press rule scales the four labelled variants only', () => {
    expect(pressBlock).toContain('scale: 0.97');
    expect(pressBlock).toContain('[data-variant="default"]');
    expect(pressBlock).toContain('[data-variant="secondary"]');
    expect(pressBlock).toContain('[data-variant="outline"]');
    expect(pressBlock).toContain('[data-variant="destructive"]');
    expect(pressBlock).not.toContain('[data-variant="ghost"]');
    expect(pressBlock).not.toContain('[data-variant="link"]');
    expect(pressBlock).toContain('[data-size^="icon"]');
    expect(pressBlock).toContain('[data-row-kind]');
    expect(pressBlock).toContain('[aria-disabled="true"]');
    expect(pressBlock).toContain(':where(.tray-pop *)');
  });

  test('scale runs on the strong ease-out over --dur-fast, gated on fine pointers and full motion', () => {
    expect(pressBlock).toContain('scale var(--dur-fast) var(--ease-out-strong)');
    expect(shadcnCss).toMatch(/--ease-out-strong:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    expect(shadcnCss).toMatch(/--dur-fast:\s*150ms/);
  });

  test('the tint still lands in the same frame while pressed', () => {
    expect(pressBlock).toContain('transition-duration: 0s, 0s, 0s, 0s, 0s, 0s, 0s, var(--dur-fast)');
  });
});

describe('pick 4: menu and ⌘K easing is --ease-out-expo at 100ms', () => {
  test('dropdown menu popups open on the expo curve', () => {
    const menu = read('components/ui/dropdown-menu.tsx');
    const easings = menu.match(/duration-100 ease-\(--ease-out-expo\)/g) ?? [];
    expect(easings.length).toBe(2);
  });

  test('the ⌘K panel animates in and out on the expo curve', () => {
    const shell = read('components/ui/dialog-shell.tsx');
    expect(shell).toContain('duration-100 ease-(--ease-out-expo)');
    const panel = read('overlay/search-panel.tsx');
    expect(panel).toContain('transition-[opacity,scale]');
    expect(panel).toContain('VIEWPORT_POP_ANIM');
  });

  test('a dismissed menu still closes in the same frame', () => {
    expect(motionCss).toContain('[data-closed]');
    expect(motionCss).toMatch(/\[data-closed\][^{]*\{[^}]*animation:\s*none/);
  });
});

describe('pick 5: the done check springs in with no bounce', () => {
  test('the check scale transition rides --ease-check-spring over --dur-spring', () => {
    const util = ruleBody(appCss, 'check-scale');
    expect(util).toContain('scale var(--dur-spring) var(--ease-check-spring)');
    expect(util).toContain('prefers-reduced-motion: reduce');
    expect(shadcnCss).toMatch(/--dur-spring:\s*600ms/);
  });

  test('the spring is critically damped: linear() never overshoots 1', () => {
    const match = shadcnCss.match(/--ease-check-spring:\s*linear\(([^;]*)\)/s);
    expect(match).not.toBeNull();
    const stops = (match?.[1] ?? '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => !Number.isNaN(v));
    expect(stops.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...stops)).toBeLessThanOrEqual(1);
    expect(stops[stops.length - 1]).toBe(1);
    expect(stops.every((v, i) => i === 0 || v >= (stops[i - 1] ?? -Infinity))).toBe(true);
  });

  test('the TaskCard done disc uses it', () => {
    const md = read('detail/chat-markdown.tsx');
    expect(md).toContain('check-scale');
    expect(md).toMatch(/scale-100 opacity-100.*scale-50 opacity-0/s);
  });
});

describe('pick 6: first-run blocks enter staggered, rising and unblurring', () => {
  const setup = read('board/first-run-setup.tsx');

  test('every left-column block and the section enters', () => {
    const enters = setup.match(/first-run-enter/g) ?? [];
    expect(enters.length).toBeGreaterThanOrEqual(5);
  });

  test('delays step 100ms and cap at 200ms', () => {
    const delays = [...setup.matchAll(/--enter-delay': '(\d+)ms'/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([0, 100, 200, 200, 200]);
  });

  test('each block rises 12px, unblurs 4px and fades over 400ms strong ease-out, motion-gated', () => {
    const keyframes = appCss.match(/@keyframes first-run-enter \{([^}]*)\}/s)?.[1] ?? '';
    expect(keyframes).toContain('translateY(12px)');
    expect(keyframes).toContain('blur(4px)');
    expect(keyframes).toContain('opacity: 0');
    const util = ruleBody(appCss, 'first-run-enter');
    expect(util).toContain('first-run-enter var(--dur-enter) var(--ease-out-strong) both');
    expect(util).toContain('animation-delay: var(--enter-delay, 0ms)');
    expect(util).toContain('prefers-reduced-motion: no-preference');
    expect(shadcnCss).toMatch(/--dur-enter:\s*400ms/);
  });

  test('the section no longer rides the old slide-in utility', () => {
    expect(setup).not.toContain('slide-in-from-bottom-1');
  });
});
