import { describe, expect, test } from 'vitest';
import { acpErrorMessage } from '../src/backend/acp.js';
import { FAILED_SPAWN, MISSING_CLAUDE, MISSING_HOST_TOOL } from '../src/backend/errors.js';
import { protocolCompatFlip } from '../src/backend/pi.js';
import { parseClaudeVersion } from '../src/claude-code-bin.js';
import { browserSessionName } from '../src/computer/browser.js';
import { parseUiAutomator } from '../src/computer/phone-android.js';
import { mergePhoneReports, parseMdnsServices } from '../src/computer/phone-probe.js';
import { githubRepoRefOf } from '../src/github-probe.js';
import { extractCodeFence } from '../src/review-findings.js';
import { repoLabel } from '../src/workspace.js';

const BOUND_MS = 1_500;
const N = 160_000;

const hostile: [string, () => unknown][] = [
  ['missing executable', () => acpErrorMessage(new Error('spawn agy '.repeat(N / 4)))],
  ['missing agy', () => acpErrorMessage(new Error(' agy'.repeat(N / 2)))],
  ['failed spawn', () => FAILED_SPAWN.test('spawn '.repeat(10_000))],
  ['missing claude', () => MISSING_CLAUDE.test(' claude'.repeat(12_000))],
  ['missing host tool', () => MISSING_HOST_TOOL.test('tool '.repeat(12_000))],
  ['unsupported parameter', () => protocolCompatFlip('unsupported parameter'.repeat(N / 8))],
  ['version digits', () => parseClaudeVersion('1'.repeat(N))],
  ['browser session name', () => browserSessionName(`a${'_'.repeat(N)}x`)],
  ['screen dump', () => parseUiAutomator('<node '.repeat(N / 2))],
  ['phone service name', () => parseMdnsServices(`a ${'adb-tls-'.repeat(N / 4)} x`)],
  [
    'phone service tail',
    () =>
      mergePhoneReports(
        [],
        [{ name: `${'._adb'.repeat(N / 4)}\rz`, serviceType: '', address: 'h:1' }],
        new Map(),
      ),
  ],
  ['clone address', () => githubRepoRefOf(`https://github.com/a${'/'.repeat(N)}x`)],
  ['repository label', () => repoLabel(`https://example.test/a${'/'.repeat(N)}x`)],
  ['unclosed code fence', () => extractCodeFence(`\`\`\`${'\n'.repeat(N * 2)}x`)],
];

describe('daemon parsers stay linear on hostile text', () => {
  test.each(hostile)(
    '%s',
    (_name, run) => {
      const started = performance.now();
      run();
      expect(performance.now() - started).toBeLessThan(BOUND_MS);
    },
    300_000,
  );

  test.each([
    ['spawn agy ENOENT', true, false],
    ['spawn /opt/claude spawn ENOENT', true, false],
    ['claude: command not found', false, true],
    ['claude then claude not found', false, true],
    ['spawn failed\nENOENT', false, false],
    ['claude\nnot found', false, false],
  ])('a missing executable is still recognised: %j', (message, spawn, claude) => {
    expect(FAILED_SPAWN.test(message)).toBe(spawn);
    expect(MISSING_CLAUDE.test(message)).toBe(claude);
  });

  test.each([
    ['unknown tool: foo', true],
    ['tool foo not found', true],
    ['tool a tool not found', true],
    ['no such tool', true],
    ['tool not found', false],
    ['tool foo\n not found', false],
  ])('a missing host tool error is still recognised: %j', (output, missing) => {
    expect(MISSING_HOST_TOOL.test(output)).toBe(missing);
  });

  test('a phone service line still reads as name, type and address', () => {
    expect(
      parseMdnsServices('adb-AB12CD34-xY12._adb-tls-connect _adb-tls-connect._tcp 10.0.0.2:5555'),
    ).toEqual([
      {
        name: 'adb-AB12CD34-xY12._adb-tls-connect',
        serviceType: '_adb-tls-connect._tcp',
        address: '10.0.0.2:5555',
      },
    ]);
  });
});
