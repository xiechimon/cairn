import { expect, test } from 'vitest';
import { otelErrorMessage } from '../src/genai-conventions.js';

test.each([
  'sk-short',
  'sk-ant-api03-secret',
  'oat01-secret',
  'ghp_secret',
  'gho_secret',
  'github_pat_secret',
  'Bearer abc.def+/=',
  'bearer secret',
  'token=secret',
  'key="secret value"',
  'TOKEN=secret',
  'key=secret',
])('redacts credential %s from telemetry errors', (credential) => {
  expect(otelErrorMessage(`before ${credential} after`)).toBe('before <redacted> after');
});

test('reuses encrypted-secret redaction and redacts IPv4 URL hosts', () => {
  expect(
    otelErrorMessage(
      `v1:${'a'.repeat(44)} at https://192.0.2.1:8080/x http://user:pass@198.51.100.2/path`,
    ),
  ).toBe('<redacted> at https://<ip>:8080/x http://user:pass@<ip>/path');
  expect(otelErrorMessage('version 1.2.3.4 at https://example.com')).toBe(
    'version 1.2.3.4 at https://example.com',
  );
});

test('normalizes whitespace, redacts before truncation, and caps at 500 characters', () => {
  expect(otelErrorMessage('  first\r\n second\tthird  ')).toBe('first second third');
  expect(otelErrorMessage(`${'x'.repeat(490)} token=${'s'.repeat(600)}`)).toBe(
    `${'x'.repeat(490)} <redacted`.slice(0, 500),
  );
  expect(otelErrorMessage('x'.repeat(600))).toHaveLength(500);
});

test.each([null, undefined, '', ' \n '])('omits absent or blank failure reasons', (reason) => {
  expect(otelErrorMessage(reason)).toBeUndefined();
});

test('redacts IPv4 URLs enclosed in error punctuation', () => {
  expect(otelErrorMessage('request (https://192.0.2.1), "http://198.51.100.2"')).toBe(
    'request (https://<ip>), "http://<ip>"',
  );
});
