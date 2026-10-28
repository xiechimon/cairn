import { describe, expect, test } from 'vitest';
import {
  MOTION_TOKEN_PATHS,
  RECORDING_EXTENSIONS,
  RECORDING_MAX_BYTES,
  recordingRequired,
  recordingRequirements,
} from '../src/records/recording-trigger.js';

const added = (path: string, ...addedLines: string[]) => [{ path, addedLines }];
const fires = (path: string, ...addedLines: string[]) =>
  recordingRequired(added(path, ...addedLines)).required;

const CARD = 'apps/web/src/board/card.tsx';

describe('recordingRequired fires on animated or interactive UI (#1783)', () => {
  test('an added transition line in apps/web/src fires', () => {
    const r = recordingRequired(added(CARD, '  transition: transform 200ms;'));
    expect(r.required).toBe(true);
    expect(r.reasons).toEqual([
      'apps/web/src/board/card.tsx: transition: transform 200ms; (transition)',
    ]);
  });

  test('an added animation declaration, @keyframes block and motion token file fire', () => {
    for (const line of [
      '  animation: fade-in 200ms;',
      '@keyframes fade-in {',
      '  animation-name: fade-in;',
    ])
      expect(fires(CARD, line), line).toBe(true);
    for (const path of MOTION_TOKEN_PATHS)
      expect(fires(path, '--motion-dur: 200ms;'), path).toBe(true);
  });

  test('a drag or hover interaction handler fires', () => {
    for (const line of [
      '  onDragStart={begin}',
      '  onPointerMove={track}',
      '  onMouseEnter={reveal}',
      '  onMouseDown={begin}',
      '  onTouchStart={begin}',
      '  draggable',
      '  hover:bg-accent',
      '  scroll-behavior: smooth;',
      '  document.body.style.transform = translate(x);',
    ])
      expect(fires(CARD, line), line).toBe(true);
  });

  test('a copy-only change (i18n string, JSX text) does not fire', () => {
    expect(fires(CARD, '  <p>New copy</p>')).toBe(false);
    expect(fires('apps/web/src/i18n/en.ts', '  cardTitle: "New copy",')).toBe(false);
    expect(fires('apps/web/src/i18n/zh.ts', '  cardTitle: "新文案",')).toBe(false);
    expect(recordingRequired(added(CARD)).required).toBe(false);
  });

  test('a removed transition line does not fire', () => {
    expect(
      recordingRequired([
        { path: CARD, addedLines: [] },
        { path: CARD, addedLines: ['', ''] },
      ]).required,
    ).toBe(false);
    expect(
      recordingRequirements([{ filename: CARD, status: 'removed', patch: '-  transition: none;' }]),
    ).toEqual({ required: false, reasons: [] });
  });

  test('a test file with "animation" in it does not fire', () => {
    expect(fires('apps/web/src/board/card.test.tsx', '  animation: fade-in 200ms;')).toBe(false);
    expect(fires('apps/web/src/board/card.test.ts', '  transition: transform;')).toBe(false);
    expect(fires('apps/web/src/board/__tests__/card.tsx', '  animation: fade;')).toBe(false);
  });

  test('word boundaries keep unrelated identifiers quiet', () => {
    for (const line of [
      '  const promotion = useMemo(() => rank(cards), [cards]);',
      '  const motionDiv = <div />;',
      '  setMotionEnabled(true);',
      '  className="animate-motion"',
      '  const rankAfterPromotion = useMemo(() => rank(cards), [cards]);',
      '  className="motion-safe:block"',
    ])
      expect(fires(CARD, line), line).toBe(false);
  });

  test('paths outside apps/web/src and opaque patches do not fire', () => {
    expect(fires('apps/server/src/app.ts', '  transition: all 200ms;')).toBe(false);
    expect(fires('apps/web/e2e/card.spec.ts', '  await page.hover();')).toBe(false);
    expect(
      recordingRequirements([{ filename: CARD, status: 'modified', patch: null }]).required,
    ).toBe(false);
  });

  test('a patch without a motion line does not fire', () => {
    expect(
      recordingRequirements([
        { filename: CARD, status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
      ]).required,
    ).toBe(false);
  });

  test('the real past PR #1356 motion token file fires through its real patch', () => {
    const patch = [
      '@@ -218,3 +218,6 @@ body[data-board-dragging] {',
      '     transform: scale(0.92);',
      '   }',
      ' }',
      '+',
      '+@keyframes message-fade-up {',
      '+  from {',
      '+    opacity: 0;',
    ].join('\n');
    const r = recordingRequirements([
      { filename: 'apps/web/src/styles/motion.css', status: 'modified', patch },
    ]);
    expect(r.required).toBe(true);
    expect(r.reasons[0]).toContain('apps/web/src/styles/motion.css');
  });
});

describe('recording constants', () => {
  test('extensions cover gif, webm and mp4; the cap is 5 MiB', () => {
    expect(RECORDING_EXTENSIONS).toEqual(['.gif', '.webm', '.mp4']);
    expect(RECORDING_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
