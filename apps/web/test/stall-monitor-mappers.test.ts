import { CHIEF_NOTICE_KIND, chiefNoticeContentSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapChiefStream, mapTranscript } from '../src/api/mappers.js';

describe('stall-monitor web mappers', () => {
  test('renders worker system notes and Coordinator CHIEF_NOTICE_KIND stall notices', () => {
    const now = Date.now();
    const workerTranscript = mapTranscript({
      messages: [
        {
          id: 'stall-recover-s1-1',
          role: 'system',
          content: '步骤已有一段时间无新工具调用或输出，已自动停止旧会话并新建会话重试一次。',
          createdAt: now,
          actor: null,
        },
      ],
      steps: [],
      build: {
        id: 'b-1',
        todoId: 't-1',
        withPlan: false,
        triggerSource: 'user',
        prNumber: null,
        prUrl: null,
        errorMessage: null,
        createdAt: now,
      } as never,
      todo: { id: 't-1', phase: 'building' } as never,
      machineName: null,
      userName: 'Owner',
      liveText: '',
    });
    expect(workerTranscript.some((item) => item.kind === 'note')).toBe(true);

    const chiefNoticeRow = {
      id: 'stall-notice-1',
      role: 'system' as const,
      content: JSON.stringify({
        kind: CHIEF_NOTICE_KIND,
        message: '对话已有一段时间无新工具调用或输出，已自动停止旧回合并重启本轮。',
        provenance: 'stall-monitor',
      }),
      createdAt: now,
      projectId: null,
    };
    expect(chiefNoticeContentSchema.safeParse(JSON.parse(chiefNoticeRow.content)).success).toBe(
      true,
    );
    const chiefItems = mapChiefStream([chiefNoticeRow]);
    expect(chiefItems).toHaveLength(1);
    expect(chiefItems[0]?.kind).toBe('robot');
  });
});
