import { describe, expect, test } from 'vitest';
import {
  completionKeyIntent,
  type CompletionNavState,
  COMPLETION_CAP,
  cycleHighlight,
  detectCompletionToken,
  fuzzyFilter,
  MENTION_COMPLETION_SPEC,
} from '../src/overlay/completion.js';

const detect = (value: string, caret: number) =>
  detectCompletionToken(value, caret, MENTION_COMPLETION_SPEC);

interface Item {
  id: string;
  label: string;
}
const items = (...labels: string[]): Item[] => labels.map((label, i) => ({ id: `a${i}`, label }));
const labels = (list: Item[]) => list.map((i) => i.label);
const labelOf = (i: Item) => i.label;

describe('detectCompletionToken (@ trigger boundary, canon rules 1-5)', () => {
  test('@ at row head triggers, query = text from @ to the caret (D2/rule 1)', () => {
    expect(detect('@bu', 3)).toEqual({ start: 0, end: 3, query: 'bu' });
    expect(detect('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  test('trigger after whitespace: space / newline / tab (D2/rule 1)', () => {
    expect(detect('hello @bu', 9)).toEqual({ start: 6, end: 9, query: 'bu' });
    expect(detect('line1\n@bu', 9)).toEqual({ start: 6, end: 9, query: 'bu' });
    expect(detect('a\t@b', 4)).toEqual({ start: 2, end: 4, query: 'b' });
  });

  test('trigger after CJK punctuation: 。、？！ (D2/rule 1, kCt charset ported verbatim)', () => {
    expect(detect('好的。@bu', 6)).toEqual({ start: 3, end: 6, query: 'bu' });
    expect(detect('一、@x', 4)).toEqual({ start: 2, end: 4, query: 'x' });
    expect(detect('真的？@x', 5)).toEqual({ start: 3, end: 5, query: 'x' });
    expect(detect('走了！@x', 5)).toEqual({ start: 3, end: 5, query: 'x' });
  });

  test('@ inside a word does not trigger: foo@ / email a@b.com (D1/rules 2-3, current-defect pin)', () => {
    expect(detect('foo@', 4)).toBeNull();
    expect(detect('foo@bu', 6)).toBeNull();
    expect(detect('a@b.com', 7)).toBeNull();
    expect(detect('mail me at a@b.com ok', 21)).toBeNull();

    expect(detect('(@bu', 4)).toBeNull();
  });

  test('caret not at token tail = no token: pure movement away closes it (D3/rule 33)', () => {

    expect(detect('hello @bu', 6)).toBeNull();

    expect(detect('hello @bu world', 15)).toBeNull();
    // caret = 0
    expect(detect('@bu', 0)).toBeNull();
  });

  test('caret lands mid-token: re-judge truncated at the caret (D3)', () => {
    expect(detect('hello @bu', 8)).toEqual({ start: 6, end: 8, query: 'b' });
    expect(detect('hello @bu rest', 9)).toEqual({ start: 6, end: 9, query: 'bu' });
  });

  test('backspace boundary: deleting the query last char stays in the popover, deleting past @ closes it (D4/failure mode 7)', () => {
    expect(detect('hello @b', 8)).toEqual({ start: 6, end: 8, query: 'b' });
    expect(detect('hello @', 7)).toEqual({ start: 6, end: 7, query: '' });
    expect(detect('hello ', 6)).toBeNull();
  });

  test('characters outside the token charset terminate the token: space / comma (D5/rules 5+34)', () => {
    expect(detect('hello @bu ', 10)).toBeNull();
    expect(detect('hello @bu,', 10)).toBeNull();
    expect(detect('hello @bu*', 10)).toBeNull();
  });

  test('token charset ported verbatim: alphanumerics _-./\\()[]~: and CJK (rule 5)', () => {
    expect(detect('@a.b-c_d/e~f:g', 14)).toEqual({ start: 0, end: 14, query: 'a.b-c_d/e~f:g' });
    expect(detect('@a(i)[j]\\k', 10)).toEqual({ start: 0, end: 10, query: 'a(i)[j]\\k' });
    expect(detect('@建设 agent', 3)).toEqual({ start: 0, end: 3, query: '建设' });
  });

  test('serialized mentions do not misfire: [label](agent:id) has no @, and when label contains @ its left neighbor is [ (D1 adjacency face)', () => {
    expect(detect('hi [builder](agent:a1)', 22)).toBeNull();
    expect(detect('hi [@foo](agent:a1)', 19)).toBeNull();
  });
});

describe('fuzzyFilter (subsequence + smart case + boundary bonus + cap, canon rules 14-18)', () => {
  test('empty query lists all, roster order kept (F5/rule 13 same shape)', () => {
    expect(labels(fuzzyFilter('', items('builder', 'reviewer', 'deploy-bot'), labelOf))).toEqual([
      'builder',
      'reviewer',
      'deploy-bot',
    ]);
  });

  test('subsequence match, not prefix: bld hits builder (F1/rule 15)', () => {
    expect(labels(fuzzyFilter('bld', items('builder', 'reviewer', 'deploy-bot'), labelOf))).toEqual([
      'builder',
    ]);
  });

  test('non-subsequence does not hit (F1)', () => {
    expect(fuzzyFilter('zzz', items('builder', 'reviewer'), labelOf)).toEqual([]);
  });

  test('smart case: all-lowercase query is case-insensitive (F2/rule 17)', () => {
    expect(labels(fuzzyFilter('bu', items('Builder', 'builder-x'), labelOf))).toEqual([
      'Builder',
      'builder-x',
    ]);
  });

  test('smart case: query containing uppercase is case-sensitive (F2/rule 17)', () => {
    expect(labels(fuzzyFilter('Bu', items('Builder', 'builder'), labelOf))).toEqual(['Builder']);
    expect(fuzzyFilter('BUILD', items('builder'), labelOf)).toEqual([]);
  });

  test('separator boundary bonus ranks before in-word matches (F3/rule 18, Qr=8)', () => {

    expect(labels(fuzzyFilter('b', items('ab', 'a-b', 'b1'), labelOf))).toEqual(['a-b', 'b1', 'ab']);
  });

  test('camelCase boundary bonus (F3/rule 18, Gu=6)', () => {

    expect(labels(fuzzyFilter('am', items('abmain', 'abMain'), labelOf))).toEqual([
      'abMain',
      'abmain',
    ]);
  });

  test('consecutive-hit bonus: a run beats scattered hits (F3 derived)', () => {

    expect(labels(fuzzyFilter('ui', items('xuqi', 'xuid'), labelOf))).toEqual(['xuid', 'xuqi']);
  });

  test('separator bonus outweighs the consecutive bonus (F3/rule 18, Qr=8 > run=2)', () => {

    expect(labels(fuzzyFilter('ui', items('xuid', 'xu-i'), labelOf))).toEqual(['xu-i', 'xuid']);
  });

  test('cap = 15 (F4/rules 8+14, CN=15)', () => {
    const many = items(...Array.from({ length: 20 }, (_, i) => `agent-${String(i).padStart(2, '0')}`));
    expect(fuzzyFilter('', many, labelOf)).toHaveLength(COMPLETION_CAP);
    expect(fuzzyFilter('agent', many, labelOf)).toHaveLength(COMPLETION_CAP);
    expect(COMPLETION_CAP).toBe(15);
  });
});

describe('cycleHighlight (↑↓ wrap, face K4)', () => {
  test('starting from null: down → first item, up → last item', () => {
    expect(cycleHighlight(null, 1, 3)).toBe(0);
    expect(cycleHighlight(null, -1, 3)).toBe(2);
  });

  test('wraps around at both ends', () => {
    expect(cycleHighlight(2, 1, 3)).toBe(0);
    expect(cycleHighlight(0, -1, 3)).toBe(2);
    expect(cycleHighlight(1, 1, 3)).toBe(2);
  });

  test('out-of-range highlight (stale after the candidate set shrinks) treated as null', () => {
    expect(cycleHighlight(7, 1, 3)).toBe(0);
  });
});

describe('completionKeyIntent (keyboard semantics, canon rules 20-23/32/55-56)', () => {
  const open3: CompletionNavState = { open: true, highlight: null, matchCount: 3 };
  const openH1: CompletionNavState = { open: true, highlight: 1, matchCount: 3 };

  test('list closed: always ignore — Enter passes back to the caller to send (K2/failure mode 1)', () => {
    const closed: CompletionNavState = { open: false, highlight: null, matchCount: 0 };
    expect(completionKeyIntent({ key: 'Enter' }, closed)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'ArrowDown' }, closed)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'Tab' }, closed)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'Escape' }, closed)).toEqual({ kind: 'ignore' });
  });

  test('Enter with a highlight = accept, not send (K1/rule 21+23, r9 §5 conflict fix)', () => {
    expect(completionKeyIntent({ key: 'Enter' }, openH1)).toEqual({ kind: 'accept', index: 1 });
  });

  test('Enter without a highlight = ignore (sending unchanged, rules 55/56 same shape)', () => {
    expect(completionKeyIntent({ key: 'Enter' }, open3)).toEqual({ kind: 'ignore' });
  });

  test('Shift+Enter always ignore (newline semantics untouched)', () => {
    expect(completionKeyIntent({ key: 'Enter', shiftKey: true }, openH1)).toEqual({
      kind: 'ignore',
    });
  });

  test('Tab = accept the highlighted item; no highlight accepts the top item (K3/rule 22+56)', () => {
    expect(completionKeyIntent({ key: 'Tab' }, openH1)).toEqual({ kind: 'accept', index: 1 });
    expect(completionKeyIntent({ key: 'Tab' }, open3)).toEqual({ kind: 'accept', index: 0 });
  });

  test('↑↓ move the highlight cyclically (K4/rule 20)', () => {
    expect(completionKeyIntent({ key: 'ArrowDown' }, open3)).toEqual({ kind: 'navigate', index: 0 });
    expect(completionKeyIntent({ key: 'ArrowUp' }, open3)).toEqual({ kind: 'navigate', index: 2 });
    expect(completionKeyIntent({ key: 'ArrowDown' }, openH1)).toEqual({
      kind: 'navigate',
      index: 2,
    });
    expect(completionKeyIntent({ key: 'ArrowUp' }, { ...openH1, highlight: 0 })).toEqual({
      kind: 'navigate',
      index: 2,
    });
  });

  test('IME composition state: Enter/↑↓/Tab/Esc all ignore (K5/failure mode 8)', () => {
    for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Tab', 'Escape']) {
      expect(completionKeyIntent({ key, isComposing: true }, openH1)).toEqual({ kind: 'ignore' });
    }
  });

  test('Esc = dismiss (K6/rule 32)', () => {
    expect(completionKeyIntent({ key: 'Escape' }, open3)).toEqual({ kind: 'dismiss' });
    expect(completionKeyIntent({ key: 'Escape' }, openH1)).toEqual({ kind: 'dismiss' });
  });

  test('empty result set: Tab/↑↓ ignore (focus navigation not hijacked), Esc still dismisses (K7)', () => {
    const empty: CompletionNavState = { open: true, highlight: null, matchCount: 0 };
    expect(completionKeyIntent({ key: 'Tab' }, empty)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'ArrowDown' }, empty)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'Enter' }, empty)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'Escape' }, empty)).toEqual({ kind: 'dismiss' });
  });

  test('other keys are not hijacked (typing/backspace walk the change re-judge path)', () => {
    expect(completionKeyIntent({ key: 'a' }, openH1)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'Backspace' }, openH1)).toEqual({ kind: 'ignore' });
    expect(completionKeyIntent({ key: 'ArrowLeft' }, openH1)).toEqual({ kind: 'ignore' });
  });
});
