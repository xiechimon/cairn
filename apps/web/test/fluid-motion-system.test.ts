import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${SRC}${rel}`, 'utf8');

describe('fluid motion system: unified overlay & modal choreography', () => {
  const motionCss = read('styles/motion.css');
  const tooltip = read('components/ui/tooltip.tsx');

  test('anchored popups unify on --ease-out-expo, subtle 0.97 scale, and trigger origin', () => {
    expect(motionCss).toContain('[data-slot="popover-content"]');
    expect(motionCss).toContain('[data-slot="select-content"]');
    expect(motionCss).toContain('[data-slot="tooltip-content"]');
    expect(motionCss).toContain('var(--transform-origin)');
    expect(motionCss).toContain('var(--ease-out-expo)');
    expect(motionCss).toContain('--tw-enter-scale: 0.97');
    expect(tooltip).not.toContain('ease-linear');
  });

  test('centered dialogs enter at 0.98 over --dur-overlay and exit shorter to 0.99 over --dur-fast', () => {
    expect(motionCss).toContain('[data-slot="dialog-content"]:not(.app-drawer)');
    expect(motionCss).toContain('[data-slot="alert-dialog-content"]');
    expect(motionCss).toContain('--tw-enter-scale: 0.98');
    expect(motionCss).toContain('--tw-exit-scale: 0.99');
    expect(motionCss).toContain('var(--ease-out-strong)');
  });

  test('reduced motion disables transform/travel on switches, checkboxes, indicators, and toasts', () => {
    expect(motionCss).toContain('check-pop-in');
    expect(motionCss).toContain('[data-slot="switch-thumb"]');
    expect(motionCss).toContain('[data-slot="phone-tabs-indicator"]');
    expect(motionCss).toContain('[data-sonner-toast]');
  });
});

describe('fluid motion system: unified disclosure & single-chevron rotation', () => {
  test('shared Disclosure uses CSS grid collapse with --ease-out-strong and motion-reduce guard', () => {
    const disclosure = read('components/disclosure.tsx');
    expect(disclosure).toContain('grid-rows-[1fr]');
    expect(disclosure).toContain('grid-rows-[0fr]');
    expect(disclosure).toContain('ease-(--ease-out-strong)');
    expect(disclosure).toContain('motion-reduce:transition-none');
    expect(disclosure).toContain('inert={!open}');
  });

  test('TraceChevron and TraceCollapse use --ease-out-strong without raw bezier literals', () => {
    const traceParts = read('components/chat/trace-parts.tsx');
    expect(traceParts).toContain('transition-transform');
    expect(traceParts).toContain('ease-(--ease-out-strong)');
    expect(traceParts).not.toContain('cubic-bezier(0.23,1,0.32,1)');
  });

  test('SidebarProjectGroupHeader, FailureDetailToggle, PrCard, and ProviderConnectionDisclosure rotate a single chevron with Disclosure', () => {
    const sidebarProject = read('components/shell/sidebar-project.tsx');
    const sidebar = read('board/sidebar.tsx');
    const noticeLine = read('components/chat/notice-line.tsx');
    const prCard = read('components/thread/pr-card.tsx');
    const providerDisc = read('resources/provider-connection-disclosure.tsx');
    const approvalCard = read('chief/approval-card.tsx');

    expect(sidebarProject).not.toContain('ChevronDown');
    expect(sidebarProject).toContain("expanded && 'rotate-90'");
    expect(sidebar).toMatch(/<Disclosure\s+open=\{expanded\}/);

    expect(noticeLine).not.toContain('ChevronUp');
    expect(noticeLine).toContain("open && 'rotate-180'");
    expect(noticeLine).toContain('<Disclosure open={open}>');

    expect(prCard).toContain('<Disclosure open={open}>');

    expect(providerDisc).toContain('ease-(--ease-out-strong)');
    expect(providerDisc).toMatch(/<Disclosure\s+open=\{open\}/);

    expect(approvalCard).toContain('<Disclosure');
  });
});

describe('fluid motion system: icon cross-fade, gliding indicators, and direct-manipulation resize', () => {
  test('CopyIconButton and MessageMeta keep both Copy and Check icons mounted for cross-fade', () => {
    const copyBtn = read('components/copy-icon-button.tsx');
    const toolbar = read('components/chat/message-meta.tsx');

    expect(copyBtn).toContain('check-scale');
    expect(copyBtn).not.toMatch(/\?\s*\(icons\?\.(?:copied|copy)/);
    expect(copyBtn).toContain("t('已复制')");

    expect(toolbar).toContain('<CopyIconButton');
    expect(toolbar).toContain('transition-opacity');
  });

  test('SidePanel updates --side-panel-w directly on DOM during drag without per-move React setState', () => {
    const sidePanel = read('components/side-panel.tsx');
    expect(sidePanel).toContain('dataset.resizing');
    expect(sidePanel).toContain("style.setProperty('--side-panel-w'");
    expect(sidePanel).not.toContain('setPreview(');
  });

  test('SegmentedTabs defaults slide when not quiet, SegmentedRadio & PhoneTabs render gliding indicators', () => {
    const segmented = read('components/segmented.tsx');
    const phoneTabs = read('board/phone-tabs.tsx');

    expect(segmented).toContain('slide = !quiet');
    expect(segmented).toContain('--ease-out-strong');
    expect(segmented).toContain('SegmentedRadio');
    expect(segmented.match(/data-segmented="indicator"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

    expect(phoneTabs).toContain('data-slot="phone-tabs-indicator"');
    expect(phoneTabs).toContain('ease-(--ease-out-strong)');
    expect(phoneTabs).toContain('RollNumber');
  });
});

describe('fluid motion system: compositor bars, numbers, mobile tap highlight, and jump button', () => {
  test('app.css sets transparent tap-highlight-color and jump-to-latest uses compositor jump-enter', () => {
    const appCss = read('styles/app.css');
    const motionCss = read('styles/motion.css');
    const contextMeter = read('chief/context-meter-ring.tsx');
    const tasksPanel = read('board/tasks-panel.tsx');
    const providerEditors = read('resources/provider-editors.tsx');
    const queuedCapsules = read('components/queued-capsules.tsx');

    expect(appCss).toContain('-webkit-tap-highlight-color: transparent');
    expect(motionCss).toContain('@keyframes jump-enter');
    expect(motionCss).toContain('[data-slot="message-scroller-jump"][data-active="true"]');

    expect(contextMeter).toContain('scaleX(');
    expect(contextMeter).not.toContain('style={{ width: `${fill}%` }}');

    expect(tasksPanel).toContain('dock-enter');
    expect(tasksPanel).toContain('RollNumber');

    expect(providerEditors).toContain('text-swap');
    expect(queuedCapsules).toContain('useArrivals');
    expect(queuedCapsules).toContain('grow-enter');
  });
});
