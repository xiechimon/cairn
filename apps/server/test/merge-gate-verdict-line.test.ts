import { describe, expect, test } from 'vitest';
import { parseFinalVerdictLine } from '../src/services/merge-gate/verdict-line.js';

const ECHO_PROMPT = [
  'Independent review. End with exactly one line of the form VERDICT: pass or VERDICT: block.',
  'The words pass and block both appear here so an early scan can misread the prompt.',
].join('\n');

describe('parseFinalVerdictLine', () => {
  test('a transcript that echoes the prompt and ends in block is never read as pass', () => {
    const transcript = [
      ECHO_PROMPT,
      '',
      'VERDICT: pass',
      '',
      'Findings: the change loosens a gate.',
      '',
      'VERDICT: block',
      '',
    ].join('\n');
    expect(parseFinalVerdictLine(transcript)).toBe('block');
  });

  test('a transcript with no final verdict fails closed', () => {
    expect(parseFinalVerdictLine(ECHO_PROMPT)).toBeNull();
    expect(parseFinalVerdictLine('Looks fine to me.')).toBeNull();
    expect(parseFinalVerdictLine('mention VERDICT: pass in prose')).toBeNull();
    expect(parseFinalVerdictLine('VERDICT: maybe')).toBeNull();
    expect(parseFinalVerdictLine('- VERDICT: pass\n- VERDICT: block')).toBeNull();
  });

  test('the last exact verdict line wins when both appear', () => {
    expect(parseFinalVerdictLine('VERDICT: block\nVERDICT: pass\n')).toBe('pass');
    expect(parseFinalVerdictLine('VERDICT: pass\nVERDICT: block\n')).toBe('block');
  });
});
