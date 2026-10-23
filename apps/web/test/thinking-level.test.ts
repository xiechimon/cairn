// 思考强度只读行投影 toThinkingLevelDisplay（XMON-16 / #499 B3 裁决 A）——
// 呈现在 Agent 详情概览的只读值行（无选择器，B1 裁「保持只读」）。判据单源
// = 能力读面给的档位词表（live = GET /api/capabilities 投影的 shared 单源；
// fixture/未解析 = shared THINKING_LEVELS 本身）。失败方式枚举先行，本文件
// 是场景固化（仓测试规则 3）：
// F1  档位未设（null）→ 无档位可呈现，调用面落 r3 §4 观测形「默认」
// F2  档位在词表内 → 原样呈现（词表即白名单，投影层不另存一份档位集）
// F3  档位不在词表内（引擎不认的值）→ 不呈现为档位——只读行不说引擎没有的
//     档位，回落「默认」
// F4  词表空集（后端没有档位）→ 任何存值都不呈现
// F5  词表序不参与呈现（投影只判成员，不做排序/截断）

import { THINKING_LEVELS } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { toThinkingLevelDisplay } from '../src/api/mappers.js';

describe('toThinkingLevelDisplay（只读行档位投影）', () => {
  it('F1 null → null（无档位可呈现）', () => {
    expect(toThinkingLevelDisplay(null, THINKING_LEVELS)).toBeNull();
  });

  it('F2 词表内 → 原样', () => {
    expect(toThinkingLevelDisplay('high', THINKING_LEVELS)).toBe('high');
    expect(toThinkingLevelDisplay('off', THINKING_LEVELS)).toBe('off');
    expect(toThinkingLevelDisplay('max', THINKING_LEVELS)).toBe('max');
  });

  it('F3 词表外 → null（引擎没有的档位不呈现）', () => {
    expect(toThinkingLevelDisplay('ultra', THINKING_LEVELS)).toBeNull();
    expect(toThinkingLevelDisplay('HIGH', THINKING_LEVELS)).toBeNull(); // 大小写敏感：wire 值是小写词
    expect(toThinkingLevelDisplay('', THINKING_LEVELS)).toBeNull();
  });

  it('F4 词表空集 → 任何值都不呈现', () => {
    expect(toThinkingLevelDisplay('high', [])).toBeNull();
  });

  it('F5 词表序不参与（成员判定与传入序无关）', () => {
    expect(toThinkingLevelDisplay('high', ['high', 'low'])).toBe('high');
    expect(toThinkingLevelDisplay('low', ['high', 'low'])).toBe('low');
  });
});