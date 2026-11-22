import { describe, expect, test } from 'vitest';
import { publicOrigin, publicUrl } from '../src/public-url.js';

describe('publicUrl -- a configured url projected for display carries no credential', () => {
  test('query string and fragment are dropped; origin + pathname kept', () => {
    expect(publicUrl('https://example.invalid/mcp?token=x&ok=1#frag')).toBe(
      'https://example.invalid/mcp',
    );
  });

  test('userinfo is dropped with the origin', () => {
    expect(publicUrl('https://user:p4ss@example.invalid/mcp')).toBe('https://example.invalid/mcp');
  });

  test('port and non-https schemes survive', () => {
    expect(publicUrl('http://example.invalid:8080/mcp')).toBe('http://example.invalid:8080/mcp');
    expect(publicUrl('ws://127.0.0.1:9222/mcp')).toBe('ws://127.0.0.1:9222/mcp');
  });

  test('a value that is not a url still cannot carry ?token= or a leading user@', () => {
    expect(publicUrl('not a url?token=x')).toBe('not a url');
    expect(publicUrl('user:p4ss@host')).toBe('host');
    expect(publicUrl('plain')).toBe('plain');
    expect(publicUrl('plain#frag')).toBe('plain');
  });

  test('userinfo is stripped even when the authority sits after // or a nested scheme', () => {
    expect(publicUrl('//u:p@h/x')).toBe('//h/x');
    expect(publicUrl('https://u:p@ho st/path')).toBe('https://ho st/path');
    expect(publicUrl('filesystem:https://u:p@h/x')).toBe('filesystem:https://h/x');
    expect(publicUrl('path/@scope/pkg')).toBe('path/@scope/pkg');
  });

  test('a blob inner url reduces to its inner origin — the path is the credential', () => {
    expect(publicUrl('blob:https://u:p@h/x')).toBe('https://h');
  });
});

describe('publicOrigin -- credential-in-path urls reduce to the origin', () => {
  test('origin only', () => {
    expect(publicOrigin('https://t0k3n.example.invalid/session/abc')).toBe(
      'https://t0k3n.example.invalid',
    );
  });

  test('unparseable or credential-like input = empty', () => {
    expect(publicOrigin('not a url')).toBe('');
    expect(publicOrigin('user:p4ss@host')).toBe('');
  });
});
