import { describe, expect, test } from 'vitest';
import {
  BUILD_FAILURE_ROW_KIND,
  buildFailureRowContent,
  buildReworkReuseNote,
  GIT_CREDENTIAL_ROW_KIND,
  gitCredentialRowContent,
  reworkNoteWithoutReason,
  systemRowOf,
  WORKSPACE_HOOK_ROW_KIND,
  workspaceHookRowContent,
} from '../src/index.js';

describe('structured system rows', () => {
  test('writers round-trip through systemRowOf', () => {
    expect(
      systemRowOf(
        workspaceHookRowContent({
          name: 'resume',
          status: 'ok',
          exitCode: 0,
          output: 'Done in 859ms\n',
          totalChars: 20,
          ms: 2589,
        }),
      ),
    ).toEqual({
      kind: WORKSPACE_HOOK_ROW_KIND,
      name: 'resume',
      status: 'ok',
      exitCode: 0,
      ms: 2589,
      output: 'Done in 859ms',
      omittedChars: 6,
    });
    expect(systemRowOf(gitCredentialRowContent('machine'))).toEqual({
      kind: GIT_CREDENTIAL_ROW_KIND,
      source: 'machine',
    });
    expect(
      systemRowOf(
        buildFailureRowContent({
          reason: 'git commit failed (exit 1)',
          commits: ['a1cfe71'],
          files: ['a.ts'],
          pr: { number: 7, url: null },
        }),
      ),
    ).toEqual({
      kind: BUILD_FAILURE_ROW_KIND,
      reason: 'git commit failed (exit 1)',
      files: ['a.ts'],
      commits: ['a1cfe71'],
      pr: { number: 7, url: null },
    });
  });

  test('rows stored before the structured kinds still parse', () => {
    expect(systemRowOf('.agents/setup hook failed (exit 2)\nboom')).toMatchObject({
      kind: WORKSPACE_HOOK_ROW_KIND,
      name: 'setup',
      status: 'failed',
      exitCode: 2,
      output: 'boom',
    });
    expect(
      systemRowOf('.agents/setup hook timed out after 1200s — process group killed'),
    ).toMatchObject({ status: 'timeout', ms: 1_200_000, output: '' });
    expect(systemRowOf('git 凭据来源：machine（执行机本机 git 凭据）')).toEqual({
      kind: GIT_CREDENTIAL_ROW_KIND,
      source: 'machine',
    });
    expect(
      systemRowOf(
        [
          '构建步兜底报告：本步异常结束，以下由系统根据已知记录生成。',
          '- 失败原因：git commit failed (exit 1): On branch x',
          'Your branch has diverged',
          '- 已知改动：没有改动记录',
          '- PR：#12 https://github.com/o/r/pull/12',
          '- 下一步：看过失败原因后带反馈重跑。',
        ].join('\n'),
      ),
    ).toEqual({
      kind: BUILD_FAILURE_ROW_KIND,
      reason: 'git commit failed (exit 1): On branch x\nYour branch has diverged',
      files: null,
      commits: [],
      pr: { number: 12, url: 'https://github.com/o/r/pull/12' },
    });
  });

  test('ordinary notes and other structured kinds are not system rows', () => {
    expect(systemRowOf('返工回到本分支继续。')).toBeNull();
    expect(systemRowOf(JSON.stringify({ kind: 'schedule-wake', stepId: 's1' }))).toBeNull();
    expect(systemRowOf('{not json')).toBeNull();
    expect(systemRowOf([{ type: 'text', text: 'hi' }])).toBeNull();
  });

  test('the rework note never carries the failure reason', () => {
    expect(buildReworkReuseNote({ prNumber: 9 })).toBe('返工回到本分支继续，更新原 PR #9。');
    expect(reworkNoteWithoutReason('返工回到本分支继续。上一轮失败原因：boom。')).toBe(
      '返工回到本分支继续。',
    );
  });
});
