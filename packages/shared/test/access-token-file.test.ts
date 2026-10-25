import { describe, expect, test } from 'vitest';
import {
  ACCESS_TOKEN_FILE_NAME,
  formatAccessTokenFile,
  parseAccessTokenFile,
} from '../src/access-token-file.js';

describe('parseAccessTokenFile', () => {
  test('parses the CAIRN_TOKEN line', () => {
    expect(parseAccessTokenFile('CAIRN_TOKEN=abc123\n')).toBe('abc123');
  });

  test('skips blank lines and comments', () => {
    expect(parseAccessTokenFile('# deployment token\n\n; note\nCAIRN_TOKEN=tok\n')).toBe('tok');
  });

  test('trims whitespace and strips matching quotes', () => {
    expect(parseAccessTokenFile('CAIRN_TOKEN=  spaced  \n')).toBe('spaced');
    expect(parseAccessTokenFile('CAIRN_TOKEN="quoted"\n')).toBe('quoted');
    expect(parseAccessTokenFile("CAIRN_TOKEN='quoted'\n")).toBe('quoted');
  });

  test('ignores unrelated keys and takes the first CAIRN_TOKEN line', () => {
    expect(parseAccessTokenFile('OTHER=x\nCAIRN_TOKEN=one\nCAIRN_TOKEN=two\n')).toBe('one');
  });

  test('returns null with no usable line', () => {
    expect(parseAccessTokenFile('')).toBeNull();
    expect(parseAccessTokenFile('# only a comment\n')).toBeNull();
    expect(parseAccessTokenFile('CAIRN_TOKEN=\n')).toBeNull();
    expect(parseAccessTokenFile('OTHER=x\n')).toBeNull();
  });
});

describe('formatAccessTokenFile', () => {
  test('round-trips through parse', () => {
    expect(parseAccessTokenFile(formatAccessTokenFile('tok-value'))).toBe('tok-value');
  });

  test('file name is the single store under CAIRN_HOME', () => {
    expect(ACCESS_TOKEN_FILE_NAME).toBe('token');
  });
});
