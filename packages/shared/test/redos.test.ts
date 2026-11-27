import { describe, expect, test } from 'vitest';
import { parseAgentTodoText, stripAgentTodoText } from '../src/agent-todo.js';
import { renderAttachmentTokensToLabels } from '../src/attachment-token.js';
import { shortEvent } from '../src/chief-event.js';
import { otelErrorMessage } from '../src/genai-conventions.js';
import { discoverShellEnvironment } from '../src/node/shell-env.js';
import { parseOtlpTarget } from '../src/otel.js';
import { ownComputerHardlineRefusal } from '../src/protocol/own-computer.js';
import { sanitizeSubagentSummary } from '../src/protocol/subagent.js';
import { publicUrl } from '../src/public-url.js';
import { planVerificationItems } from '../src/records/plan.js';
import { mailSharedTranscript, orchestratedTodoIdOf } from '../src/records/prompts.js';
import { systemRowOf } from '../src/records/system-row.js';
import { ticketDedupeKey } from '../src/records/ticket-dedupe.js';
import { reviewFindingTitle } from '../src/review-findings.js';
import { selectSkillsForTask } from '../src/skill-inject.js';
import { suggestSkillsForMessage } from '../src/skill-route.js';
import {
  classifyStepFailure,
  isUnansweredFetch,
  missingSetupCommand,
} from '../src/task-failure.js';

const BOUND_MS = 1_500;
const N = 80_000;
const LONG = N * 2;

const hostile: [string, () => unknown][] = [
  ['todo line', () => parseAgentTodoText(`- [x] ${'\t'.repeat(LONG)}a\rb`)],
  ['todo header', () => stripAgentTodoText(`计划${'\t'.repeat(LONG)}x\n- [x] a`)],
  ['dotted host', () => isUnansweredFetch(`failed to fetch ${'a.'.repeat(N)}!`)],
  ['bare not found, newlines', () => missingSetupCommand(`${'\n'.repeat(N)}x`)],
  ['bare not found, dashes', () => missingSetupCommand(`${'-!'.repeat(N)}x`)],
  ['command quote trim', () => missingSetupCommand(`command not found: ${'.'.repeat(LONG)}x`)],
  ['orchestrate marker', () => orchestratedTodoIdOf('\n编排请求：['.repeat(N / 2))],
  [
    'mail history marker',
    () => mailSharedTranscript(`[wake:mail] provenance=mail:a\n${'\n'.repeat((N * 3) / 2)}x`),
  ],
  ['event history marker', () => shortEvent(`[wake:build]${'\n'.repeat(N)}x`)],
  ['attachment token', () => renderAttachmentTokensToLabels('!['.repeat(N))],
  ['url scheme run', () => publicUrl('a'.repeat(LONG))],
  ['url query', () => publicUrl(`${'?'.repeat(LONG)}\n`)],
  ['ticket path', () => ticketDedupeKey({ category: 'x', paths: [`${'/'.repeat(LONG)}x`] })],
  ['skill time expression', () => suggestSkillsForMessage('1'.repeat(LONG), [])],
  ['legacy failure row', () => systemRowOf(`构建步兜底报告：\n- 已知改动：${'（'.repeat(LONG)}x`)],
  ['error message address', () => otelErrorMessage('a.'.repeat(N))],
  [
    'telemetry endpoint path',
    () => parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: `http://127.0.0.1/${'/'.repeat(LONG)}x` }),
  ],
  ['skill domain path', () => selectSkillsForTask('a'.repeat(LONG), [])],
  ['shell segment', () => ownComputerHardlineRefusal('xcrun devicectl '.repeat(2_000))],
  ['shell word', () => ownComputerHardlineRefusal(`:(){ ${'a'.repeat(LONG)}`)],
  ['shell expansion', () => ownComputerHardlineRefusal('${'.repeat(N / 2))],
  ['shell substitutions', () => ownComputerHardlineRefusal('a=$('.repeat(N / 40))],
  ['shell builtins', () => ownComputerHardlineRefusal('test $( '.repeat(N / 40))],
  ['shell assignments', () => ownComputerHardlineRefusal('x=adb '.repeat(N / 40))],
  ['shell subshells', () => ownComputerHardlineRefusal('(rm '.repeat((N * 3) / 8))],
  ['shell sudo flags', () => ownComputerHardlineRefusal(`;sudo${' -;sudo'.repeat(N / 6)}`)],
  ['attachment target', () => renderAttachmentTokensToLabels('![](attachment:'.repeat(N / 4))],
  ['control tag', () => sanitizeSubagentSummary('<tools '.repeat(N / 2), 'child')],
  ['plan path', () => planVerificationItems(`## Verification\n- ${'a.'.repeat(N)}`)],
  ['app image folder', () => discoverOnLinux({ APPIMAGE: 'x', APPDIR: `${'/'.repeat(N)}x` })],
  ['runtime folder', () => discoverOnLinux({ XDG_RUNTIME_DIR: `${'/'.repeat(LONG)}x` })],
];

function discoverOnLinux(env: NodeJS.ProcessEnv) {
  return discoverShellEnvironment({
    platform: 'linux',
    env: { PATH: '/usr/bin', ...env },
    homeDirectory: '/nonexistent',
    userShell: '/bin/sh',
    runCommand: async () => ({ ok: false, timedOut: false, reason: 'stubbed' }),
  });
}

describe('text from a model, a user or a command is parsed in linear time', () => {
  test.each(hostile)('%s', async (_name, run) => {
    const startedAt = performance.now();
    await run();
    expect(performance.now() - startedAt).toBeLessThan(BOUND_MS);
  });
});

describe('the rewritten parsers keep reading what they read before', () => {
  test('a bare shell "not found" line still names the command', () => {
    expect(missingSetupCommand('setup\n pnpm: command not found')).toBe('pnpm');
    expect(missingSetupCommand('step - bun: not found')).toBe('bun');
  });

  test('an address with a port is not read as a server status', () => {
    expect(isUnansweredFetch('failed to fetch http://127.0.0.1:502/x')).toBe(true);
    expect(isUnansweredFetch('failed to fetch from api.example.test:503')).toBe(true);
  });

  test.each([
    'b(){ g(){ b|b& };g;};b',
    'f(){ h(){ f|f& }; h; }; f',
    'abomb(){ bomb|bomb& };abomb',
    'sudo -k;rm /Users/rm x',
    'x=$(which adb)',
    'D=$(command -v idevicesyslog)',
    'printf -v d %s $(which simctl)',
  ])('the command checker still refuses %s', (command) => {
    expect(ownComputerHardlineRefusal(command)).not.toBeNull();
  });

  test.each([
    'model   not found',
    'quota check failed: model or fallback model not found',
    'insufficient credits for model or fallback model not found',
    'model alias: context length exceeded for this model not found',
  ])('an error naming a missing model is still read as that: %s', (message) => {
    expect(classifyStepFailure(message)).toBe('model_unavailable');
  });

  test('an address after another colon is not read as a server status', () => {
    expect(isUnansweredFetch('failed to fetch ::ffff:10.1:502')).toBe(true);
    expect(isUnansweredFetch('failed to fetch proxy:8080.internal:503')).toBe(true);
  });

  test.each([
    ['3 个文件（a.ts、b.ts 等）', ['a.ts', 'b.ts']],
    ['2 个文件（a.ts、lib（x）.ts）', ['a.ts', 'lib（x）.ts']],
    ['1 个文件（ 等）', ['']],
    ['1 个文件（a\n（b.ts）', ['b.ts']],
  ])('an old failure record still lists its files: %j', (changed, files) => {
    expect(systemRowOf(`构建步兜底报告：\n- 已知改动：${changed}`)).toMatchObject({ files });
  });

  test('a link target or label may hold square brackets', () => {
    expect(reviewFindingTitle('![P1 Badge](https://example.test/a/[id]) Title')).toBe('Title');
    expect(renderAttachmentTokensToLabels('![shot![1.png](attachment:k1)')).toBe('shot![1.png');
  });
});
