import type { ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
import { RunLogButton } from '../src/runs/run-log-button.js';

const seams = vi.hoisted(() => ({
  ref: { current: null as null | { focus: (options: FocusOptions) => void } },
  mark: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: () => seams.ref,
}));
vi.mock('react-router', () => ({ useNavigate: () => seams.navigate }));
vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('../src/runs/run-trace-api.js', () => ({ useRunLinkTo: () => () => '/runs' }));
vi.mock('../src/runs/run-trace-hint.js', () => ({
  useRunTraceHintSeen: () => false,
  markRunTraceHintSeen: seams.mark,
}));

type Element = ReactElement<{
  children?: Element | Element[];
  render?: Element;
  ref?: typeof seams.ref;
  onClick?: () => void;
  'data-testid'?: string;
}>;
function find(element: Element, id: string): Element | undefined {
  if (element.props['data-testid'] === id) return element;
  const children = [element.props.render, ...[element.props.children].flat()].filter(
    (child): child is Element => !!child && typeof child === 'object' && 'props' in child,
  );
  return children.map((child) => find(child, id)).find(Boolean);
}

it('focuses the spiral before retiring the hint and navigating', () => {
  const tree = RunLogButton({
    threadId: 'thread',
    state: 'idle',
    tooltip: 'Idle',
    hintWanted: true,
    hintBelow: false,
    className: '',
    children: null,
  }) as Element;
  const spiral = find(tree, 'chief-status-mark-button')!;
  const hint = find(tree, 'run-trace-hint')!;
  const hintButton = (hint.props.children as Element[])[0]!;
  let active = 'hint';
  let retired = false;
  seams.ref.current = {
    focus: (options) => {
      expect(options).toEqual({ preventScroll: true });
      active = 'spiral';
    },
  };
  seams.mark.mockImplementation(() => {
    expect(active).toBe('spiral');
    retired = true;
  });
  seams.navigate.mockImplementation(() => {
    expect(retired).toBe(true);
    expect(active).toBe('spiral');
  });
  hintButton.props.onClick!();
  expect(spiral.props.ref).toBe(seams.ref);
  expect(seams.mark).toHaveBeenCalledOnce();
  expect(seams.navigate).toHaveBeenCalledExactlyOnceWith('/runs');
});
