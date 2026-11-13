import { describe, expect, test } from 'vitest';
import {
  isDaemonReadSecretName,
  isHttpSecretValue,
  isSecretHeaderName,
  isSecretHeaderTemplate,
  normalizeSecretOrigin,
} from '../src/records/secret.js';

describe('secret http policy rules', () => {
  test.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['https://API.Example.com', 'https://api.example.com'],
    ['https://api.example.com:443', 'https://api.example.com'],
  ])('normalizes %s', (input, origin) => {
    expect(normalizeSecretOrigin(input)).toBe(origin);
  });

  test.each([
    'http://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com?x=1',
    'https://user:pass@api.example.com',
    'https://*.example.com',
    'https://203.0.113.7',
    'https://2130706433',
    'https://[::1]',
    'https://api.example.com:8443',
    'api.example.com',
    '',
  ])('refuses the origin %s', (input) => {
    expect(normalizeSecretOrigin(input)).toBeNull();
  });

  test('header names are tokens outside the connection-level set', () => {
    expect(isSecretHeaderName('Authorization')).toBe(true);
    expect(isSecretHeaderName('X-Api-Key')).toBe(true);
    for (const name of ['Host', 'content-length', 'Transfer-Encoding', 'TE', 'Proxy-Authorization'])
      expect(isSecretHeaderName(name)).toBe(false);
    expect(isSecretHeaderName('X Key')).toBe(false);
    expect(isSecretHeaderName('X-Key:')).toBe(false);
    expect(isSecretHeaderName('')).toBe(false);
  });

  test('a template has exactly one slot and no control character', () => {
    expect(isSecretHeaderTemplate('Bearer {secret}')).toBe(true);
    expect(isSecretHeaderTemplate('{secret}')).toBe(true);
    expect(isSecretHeaderTemplate('Bearer')).toBe(false);
    expect(isSecretHeaderTemplate('{secret}{secret}')).toBe(false);
    expect(isSecretHeaderTemplate('Bearer {secret}\n')).toBe(false);
  });

  test('an http value is non-empty and has no control character', () => {
    expect(isHttpSecretValue('sk-live_123')).toBe(true);
    expect(isHttpSecretValue('')).toBe(false);
    expect(isHttpSecretValue('a\r\nb')).toBe(false);
    expect(isHttpSecretValue('a\u0000b')).toBe(false);
  });

  test('names the daemon reads itself are recognized', () => {
    expect(isDaemonReadSecretName('EXA_API_KEY')).toBe(true);
    expect(isDaemonReadSecretName('BRAVE_SEARCH_API_KEY')).toBe(true);
    expect(isDaemonReadSecretName('STRIPE_API_KEY')).toBe(false);
  });
});
