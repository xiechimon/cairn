import type { BuildRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { shouldExpandLastWork } from '../src/detail/work-expansion.js';
import { type MessageRow, mapTranscript } from '../src/api/mappers.js';
import { inlineSegments } from '../src/lib/markdown.js';
import type { TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const GIT_ERROR = [
  'git commit failed (exit 1): On branch cairn/conv-01a1b6f2',
  "Your branch and 'origin/main' have diverged,",
  'and have 1 and 62 different commits each, respectively.',
].join('\n');

const LEGACY_HOOK = [
  '.agents/resume hook ok (2589ms)',
  'Scope: all 7 workspace projects',
  'Done in 859ms using pnpm v12.5.1',
].join('\n');
const LEGACY_CREDENTIAL = 'git 凭据来源：integration（per-step 下发 token）';
const LEGACY_FAILURE = [
  '构建步兜底报告：本步异常结束，以下由系统根据已知记录生成。',
  `- 失败原因：${GIT_ERROR}`,
  '- 已知改动：2 个文件（scripts/a.mjs、scripts/b.mjs）',
  '- Commit: a1cfe71e8377706ddd9aff08a6e90f97b7b40d8a',
  '- PR：无',
  '- 下一步：看过失败原因后带反馈重跑。',
].join('\n');
const LEGACY_REWORK = `返工回到本分支继续。上一轮失败原因：${GIT_ERROR}。`;

const STRUCTURED_HOOK = JSON.stringify({
  kind: 'workspace-hook',
  name: 'resume',
  status: 'ok',
  exitCode: 0,
  ms: 2589,
  output: 'Scope: all 7 workspace projects',
  omittedChars: 0,
});
const STRUCTURED_CREDENTIAL = JSON.stringify({ kind: 'git-credential-source', source: 'integration' });
const STRUCTURED_FAILURE = JSON.stringify({
  kind: 'build-failure',
  reason: GIT_ERROR,
  files: ['scripts/a.mjs', 'scripts/b.mjs'],
  fileCount: 2,
  commits: ['a1cfe71e8377706ddd9aff08a6e90f97b7b40d8a'],
  pr: null,
});
const REWORK = '返工回到本分支继续。';

const FAILED_BUILD: BuildRecord = {
  id: 'build-1',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: GIT_ERROR,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

function rows(contents: [MessageRow['role'], unknown][]): MessageRow[] {
  return contents.map(([role, content], index) => ({
    id: `msg-${index}`,
    role,
    content,
    createdAt: NOW - 50_000 + index * 1000,
  }));
}

function render(messages: MessageRow[], phase: 'failed' | 'building' = 'failed'): TranscriptItem[] {
  return mapTranscript({
    messages,
    steps: [],
    plans: [],
    build: FAILED_BUILD,
    todo: todo(1, phase),
    machineName: null,
    userName: 'ian',
    liveText: '',
  });
}

function occurrences(items: TranscriptItem[], needle: string): number {
  return JSON.stringify(items).split(needle).length - 1;
}

describe('task thread hierarchy', () => {
  test('a markdown link in agent text renders as an anchor, not literal brackets', () => {
    const segments = inlineSegments(
      '**还没有 PR。[#3411](https://github.com/xiechimon/cairn/issues/3411) 是 issue。**',
    );
    expect(segments).toContainEqual({
      text: '#3411',
      style: 'anchor',
      href: 'https://github.com/xiechimon/cairn/issues/3411',
      strong: true,
    });
    expect(segments.map((segment) => segment.text).join('')).not.toContain('](');
  });

  test('a link destination with balanced parentheses keeps its closing parenthesis', () => {
    const segments = inlineSegments('see [docs](https://example.com/a_(b)) now');
    expect(segments).toEqual([
      { text: 'see ' },
      { text: 'docs', style: 'anchor', href: 'https://example.com/a_(b)' },
      { text: ' now' },
    ]);
  });

  test.each([
    [String.raw`a\)b`, 'a)b'],
    [String.raw`a\(b`, 'a(b'],
    [String.raw`a\\b`, String.raw`a\b`],
    [String.raw`a\!b`, 'a!b'],
    [String.raw`a\_b`, 'a_b'],
  ])('a link destination decodes Markdown punctuation escapes: %s', (path, decoded) => {
    expect(inlineSegments(`see [docs](https://example.com/${path}) now`)).toEqual([
      { text: 'see ' },
      { text: 'docs', style: 'anchor', href: `https://example.com/${decoded}` },
      { text: ' now' },
    ]);
  });

  test('a destination preserves non-punctuation escapes and percent encoding', () => {
    expect(inlineSegments(String.raw`[docs](https://example.com/a\zb%29)`)).toEqual([
      { text: 'docs', style: 'anchor', href: String.raw`https://example.com/a\zb%29` },
    ]);
  });

  test('escaped destinations inside code stay literal', () => {
    const code = String.raw`[docs](https://example.com/a\)b)`;
    expect(inlineSegments('`' + code + '`')).toEqual([{ text: code, style: 'code' }]);
  });

  test('a link target that is not http(s) or a mention stays literal text', () => {
    expect(inlineSegments('[x](javascript:alert(1))').some((s) => s.style === 'anchor')).toBe(
      false,
    );
  });

  test.each([
    ['legacy text rows', LEGACY_HOOK, LEGACY_CREDENTIAL],
    ['structured rows', STRUCTURED_HOOK, STRUCTURED_CREDENTIAL],
  ])('hook output and the credential line fold into the work group (%s)', (_label, hook, credential) => {
    const items = render(
      rows([
        ['user', '哪个 pr'],
        ['system', hook],
        ['system', credential],
        ['assistant', [{ type: 'text', text: '还没有 PR。' }]],
      ]),
      'building',
    );
    expect(items.filter((item) => item.kind === 'note')).toEqual([]);
    const work = items.find((item) => item.kind === 'work');
    expect(work?.kind === 'work' && work.steps.map((step) => step.kind === 'call' && step.action)).toEqual([
      'setup',
      'setup',
    ]);
    expect(items.filter((item) => item.kind === 'robot')).toHaveLength(1);
  });

  test('only the credential row is marked for translation; hook output stays verbatim', () => {
    const hook = JSON.stringify({
      kind: 'workspace-hook',
      name: 'setup',
      status: 'failed',
      exitCode: 1,
      ms: 10,
      output: '失败',
      omittedChars: 0,
    });
    const items = render(
      rows([
        ['system', hook],
        ['system', STRUCTURED_CREDENTIAL],
      ]),
      'building',
    );
    const work = items.find((item) => item.kind === 'work');
    const steps = work?.kind === 'work' ? work.steps : [];
    expect(steps.map((step) => step.kind === 'call' && [step.output, step.localized])).toEqual([
      ['失败', undefined],
      ['integration：每步下发的 token', true],
    ]);
  });

  test.each([
    ['legacy text rows', LEGACY_FAILURE, LEGACY_REWORK],
    ['structured rows', STRUCTURED_FAILURE, REWORK],
  ])('the failure reason appears exactly once in the thread (%s)', (_label, failure, rework) => {
    const items = render(
      rows([
        ['user', '哪个 pr'],
        ['system', failure],
        ['system', rework],
      ]),
    );
    expect(occurrences(items, "Your branch and 'origin/main' have diverged")).toBe(1);
    const fails = items.filter((item) => item.kind === 'fail');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({
      title: 'git commit failed (exit 1)',
      body: '',
      facts: { files: 2, commits: ['a1cfe71e8'], pr: null },
      raw: GIT_ERROR,
    });
    expect(items.filter((item) => item.kind === 'note')).toEqual([
      expect.objectContaining({ text: REWORK }),
    ]);
  });

  test('a legacy failure reason with its own bullet lines is kept whole and shown once', () => {
    const reason = `${GIT_ERROR}\n- hint: run git pull\n- hint: then retry`;
    const legacy = LEGACY_FAILURE.replace(GIT_ERROR, reason);
    const items = mapTranscript({
      messages: rows([['system', legacy]]),
      steps: [],
      plans: [],
      build: { ...FAILED_BUILD, errorMessage: reason },
      todo: todo(1, 'failed'),
      machineName: null,
      userName: 'ian',
      liveText: '',
    });
    const fails = items.filter((item) => item.kind === 'fail');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({ raw: reason, facts: { files: 2, commits: ['a1cfe71e8'], pr: null } });
  });

  test('a structured failure keeps the recovery guidance for its failure class', () => {
    const offline = JSON.stringify({
      kind: 'build-failure',
      reason: 'request timed out talking to the model',
      files: null,
      fileCount: null,
      commits: [],
      pr: null,
    });
    const items = mapTranscript({
      messages: rows([['system', offline]]),
      steps: [],
      plans: [],
      build: { ...FAILED_BUILD, errorMessage: 'request timed out talking to the model' },
      todo: todo(1, 'failed'),
      machineName: null,
      userName: 'ian',
      liveText: '',
    });
    const fails = items.filter((item) => item.kind === 'fail');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({
      body: '请将这台机器重新上线。这一步不会改派到其他机器。',
    });
  });

  test('a failure with several preserved commits carries every one, oldest first', () => {
    const second = 'b2d4f6a8c0e1234567890abcdef1234567890abc';
    const failure = JSON.stringify({
      kind: 'build-failure',
      reason: GIT_ERROR,
      files: null,
      fileCount: null,
      commits: ['a1cfe71e8377706ddd9aff08a6e90f97b7b40d8a', second],
      pr: null,
    });
    const fails = render(rows([['system', failure]])).filter((item) => item.kind === 'fail');
    expect(fails[0]).toMatchObject({ facts: { commits: ['a1cfe71e8', 'b2d4f6a8c'] } });
  });

  test('a legacy failure with several Commit lines carries every one', () => {
    const legacy = LEGACY_FAILURE.replace(
      '- PR：无',
      '- Commit: b2d4f6a8c0e1234567890abcdef1234567890abc\n- PR：无',
    );
    const fails = render(rows([['system', legacy]])).filter((item) => item.kind === 'fail');
    expect(fails[0]).toMatchObject({ facts: { commits: ['a1cfe71e8', 'b2d4f6a8c'] } });
  });

  test('a work group made only of setup rows is not expanded by default', () => {
    const setupOnly = render(
      rows([
        ['user', '哪个 pr'],
        ['system', STRUCTURED_HOOK],
        ['system', STRUCTURED_CREDENTIAL],
        ['assistant', [{ type: 'text', text: '还没有 PR。' }]],
      ]),
      'failed',
    ).filter((item) => item.kind === 'work');
    expect(setupOnly).toHaveLength(1);
    expect(shouldExpandLastWork(setupOnly)).toBe(false);
  });

  test('the last work group with agent calls is still expanded by default', () => {
    const withCall = render(
      rows([
        ['system', STRUCTURED_HOOK],
        [
          'assistant',
          {
            kind: 'toolcall',
            call: { id: 'c1', name: 'Bash', arguments: { command: 'ls' }, result: 'x', startedAt: 0, endedAt: 100 },
          },
        ],
      ]),
      'building',
    ).filter((item) => item.kind === 'work');
    expect(shouldExpandLastWork(withCall)).toBe(true);
  });

  test('a failed build without a failure row still shows its error once', () => {
    const items = render(rows([['user', '哪个 pr']]));
    expect(occurrences(items, "Your branch and 'origin/main' have diverged")).toBe(1);
  });
});
