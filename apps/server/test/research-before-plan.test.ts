import { describe, expect, test } from 'vitest';
import { researchBeforePlanReason } from '../src/services/research-before-plan.js';

describe('researchBeforePlanReason', () => {
  test('flags performance and mechanism work and leaves ordinary work alone', () => {
    expect(researchBeforePlanReason('make the export faster', 'The board export is slow.')).toBe(
      'performance',
    );
    expect(researchBeforePlanReason('Add a dependency', 'Choose a parser library.')).toBe(
      'mechanism',
    );
    expect(researchBeforePlanReason('technology choice for the queue', null)).toBe('mechanism');
    expect(researchBeforePlanReason('Export the board', 'Add an export.')).toBeNull();
  });

  test('flags the same work when the owner writes in Chinese', () => {
    expect(researchBeforePlanReason('看板导出太慢了', null)).toBe('performance');
    expect(researchBeforePlanReason('队列选型', '比较几种消息队列')).toBe('mechanism');
    expect(researchBeforePlanReason('改一下按钮颜色', '把保存按钮改成蓝色')).toBeNull();
  });
});
