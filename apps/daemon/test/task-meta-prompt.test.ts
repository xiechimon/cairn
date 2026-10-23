// spec 15 #394：worker systemPrompt 的元信息回填指令（ADR 0002 D3）——
// todo 语境步注入，词表 = shared FIXED_TAGS 单源对拍，当前占位标题入指令。
// #446 / ADR 0005 分叉律：claim 载荷 todo.meta 携带 = github 形态——词表换
// 项目标签集镜像（多枚可贴）；meta 缺省 = local/hosted 现行为文本逐字节不变
// （F27）；titleFinal 在调用面短路（F28/F29），本文件钉 compose 两面。

import { FIXED_TAGS } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { composeTaskMetaInstruction, composeWorkerSystemPrompt } from '../src/runner.js';

describe('composeTaskMetaInstruction', () => {
  it('含 set_task_meta 调用指令 + 当前占位标题 + 全词表 name/description', () => {
    const text = composeTaskMetaInstruction('给登录页加验证码');
    expect(text).toContain('set_task_meta');
    expect(text).toContain('「给登录页加验证码」');
    for (const tag of FIXED_TAGS) {
      expect(text).toContain(`${tag.name}：${tag.description}`);
    }
  });

  it('meta 缺省文本逐字节不变（F27：单 tag + 固定词表措辞钉死）', () => {
    expect(composeTaskMetaInstruction('标题')).toBe(
      '## 任务元信息\n本任务当前标题是占位截断：「标题」。正式开工前，先调用一次 `set_task_meta` 工具回填元信息：`title` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）；`tag` = 从下面的固定词表选至多 1 个最贴切的类别，判不出就不传 `tag`：\n- bug：修坏的东西\n- feature：新功能\n- improvement：改进既有功能\n- refactor：重构（不改行为）\n- docs：文档\n- chore：杂务/依赖/配置',
    );
  });

  it('github 形态（#446）：词表 = 镜像 name 列表，tags 多枚措辞，不含 6 词表', () => {
    const text = composeTaskMetaInstruction('占位标题', {
      vocab: [{ name: 'bug' }, { name: 'area:auth' }],
    });
    expect(text).toContain('set_task_meta');
    expect(text).toContain('「占位标题」');
    expect(text).toContain('`tags`');
    expect(text).toContain('- bug');
    expect(text).toContain('- area:auth');
    expect(text).toContain('可多选');
    // 6 词表的「至多 1 个」措辞与 description 不得出现（github 侧作废）
    expect(text).not.toContain('至多 1 个');
    expect(text).not.toContain('修坏的东西');
  });

  it('github 形态空词表（F30）：明说无标签可贴，不渲染空列表', () => {
    const text = composeTaskMetaInstruction('占位标题', { vocab: [] });
    expect(text).toContain('没有可用标签');
    expect(text).toContain('title');
  });
});

describe('composeWorkerSystemPrompt 的 taskMeta 开关', () => {
  it('给出 taskMeta 时追加元信息块；缺省不追加', () => {
    const on = composeWorkerSystemPrompt('职责文本', undefined, {
      taskMeta: { currentTitle: '占位标题' },
    });
    expect(on).toContain('职责文本');
    expect(on).toContain('set_task_meta');
    expect(on).toContain('「占位标题」');
    const off = composeWorkerSystemPrompt('职责文本', undefined);
    expect(off).toBe('职责文本');
  });

  it('taskMeta.meta 透传：github 词表进注入文本（F28）', () => {
    const text = composeWorkerSystemPrompt('职责文本', undefined, {
      taskMeta: {
        currentTitle: '占位标题',
        meta: { vocab: [{ name: 'help wanted' }] },
      },
    });
    expect(text).toContain('- help wanted');
    expect(text).not.toContain('- bug：修坏的东西');
  });
});
