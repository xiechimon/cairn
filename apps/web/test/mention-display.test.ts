import { describe, expect, test } from 'vitest';
import {
  createMentionRegistry,
  findDisplayMentions,
  insertMentionDisplay,
  toDisplay,
  toWire,
} from '../src/overlay/mention-display.js';

const WIRE = 'Use [frontend-design](skill:fd) and ask [reviewer](agent:rv) to check #44';

describe('mention display', () => {
  test('wire tokens show as @label and round-trip back to the same wire text', () => {
    const reg = createMentionRegistry();
    const display = toDisplay(WIRE, reg);
    expect(display).toBe('Use @frontend-design and ask @reviewer to check #44');
    expect(toWire(display, reg)).toBe(WIRE);
  });

  test('editing inside a mention breaks it back to plain text', () => {
    const reg = createMentionRegistry();
    toDisplay(WIRE, reg);
    expect(toWire('ask @reviewe to check', reg)).toBe('ask @reviewe to check');
    expect(toWire('ask @reviewers to check', reg)).toBe('ask @reviewers to check');
  });

  test('typing a known @label after punctuation still resolves', () => {
    const reg = createMentionRegistry();
    toDisplay(WIRE, reg);
    expect(toWire('(@reviewer), please', reg)).toBe('([reviewer](agent:rv)), please');
  });

  test('insert puts @label at the caret with spacing and registers it', () => {
    const reg = createMentionRegistry();
    const out = insertMentionDisplay('ask to check', { kind: 'agent', id: 'rv', label: 'reviewer' }, reg, 4);
    expect(out.value).toBe('ask @reviewer to check');
    expect(out.caret).toBe('ask @reviewer '.length);
    expect(toWire(out.value, reg)).toBe('ask [reviewer](agent:rv) to check');
    expect(findDisplayMentions(out.value, reg)).toEqual([
      { start: 4, end: 13, kind: 'agent', wire: '[reviewer](agent:rv)' },
    ]);
  });

  test('the longer label wins when one label prefixes another', () => {
    const reg = createMentionRegistry();
    toDisplay('[api](project:a) [api docs](project:b)', reg);
    expect(toWire('@api docs and @api', reg)).toBe('[api docs](project:b) and [api](project:a)');
  });
});
