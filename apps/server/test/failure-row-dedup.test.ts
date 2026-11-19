import { buildFailureRowContent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { message as messageTable } from '../src/db/schema.js';
import { hasFailureRow } from '../src/services/builds.js';
import { bootServer } from './helpers.js';

const LEGACY_REPORT = (reason: string) =>
  [
    '构建步兜底报告：本步异常结束，以下由系统根据已知记录生成。',
    `- 失败原因：${reason}`,
    '- 已知改动：没有改动记录',
    '- 下一步：看过失败原因后带反馈重跑。',
  ].join('\n');

function seedRow(s: ReturnType<typeof bootServer>, content: string): void {
  s.db
    .insert(messageTable)
    .values({
      id: `m-${Math.random().toString(36).slice(2)}`,
      conversationId: 'b-1',
      role: 'system',
      content,
      createdAt: 1,
    })
    .run();
}

describe('hasFailureRow reason identity', () => {
  test('a legacy row whose reason was trimmed on parse matches an untrimmed stored error', () => {
    const s = bootServer();
    seedRow(s, LEGACY_REPORT('process failed'));
    expect(hasFailureRow(s.svc, 'b-1', 'process failed\n')).toBe(true);
    expect(hasFailureRow(s.svc, 'b-1', 'process failed')).toBe(true);
    expect(hasFailureRow(s.svc, 'b-1', 'different failure')).toBe(false);
  });

  test('a structured row matches a stored reason padded with spaces and a final newline', () => {
    const s = bootServer();
    seedRow(s, buildFailureRowContent({ reason: 'process failed\n', pr: null }));
    expect(hasFailureRow(s.svc, 'b-1', '  process failed \n')).toBe(true);
    expect(hasFailureRow(s.svc, 'b-1', 'other')).toBe(false);
  });
});
