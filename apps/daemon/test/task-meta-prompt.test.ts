import { FIXED_TAGS } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { composeTaskMetaInstruction, composeWorkerSystemPrompt } from '../src/runner.js';

describe('composeTaskMetaInstruction', () => {
  it('contains the set_task_meta call instruction + current placeholder title + full vocabulary name/description', () => {
    const text = composeTaskMetaInstruction('给登录页加验证码');
    expect(text).toContain('set_task_meta');
    expect(text).toContain('「给登录页加验证码」');
    for (const tag of FIXED_TAGS) {
      expect(text).toContain(`${tag.name}：${tag.description}`);
    }
  });

  it('meta default text unchanged byte for byte (F27: single tag + fixed vocabulary wording pinned)', () => {
    expect(composeTaskMetaInstruction('标题')).toBe(
      '## 任务元信息\n本任务当前标题是占位截断：「标题」。正式开工前，先调用一次 `set_task_meta` 工具回填元信息：`title` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）；`tag` = 从下面的固定词表选至多 1 个最贴切的类别，判不出就不传 `tag`：\n- bug：修坏的东西\n- feature：新功能\n- improvement：改进既有功能\n- refactor：重构（不改行为）\n- docs：文档\n- chore：杂务/依赖/配置',
    );
  });

  it('github shape (#446): vocabulary = mirrored name list, multi-tag wording, no 6-vocabulary', () => {
    const text = composeTaskMetaInstruction('占位标题', {
      vocab: [{ name: 'bug' }, { name: 'area:auth' }],
    });
    expect(text).toContain('set_task_meta');
    expect(text).toContain('「占位标题」');
    expect(text).toContain('`tags`');
    expect(text).toContain('- bug');
    expect(text).toContain('- area:auth');
    expect(text).toContain('可多选');
    expect(text).not.toContain('至多 1 个');
    expect(text).not.toContain('修坏的东西');
  });

  it('github shape with empty vocabulary (F30): states no tags are available, does not render an empty list', () => {
    const text = composeTaskMetaInstruction('占位标题', { vocab: [] });
    expect(text).toContain('没有可用标签');
    expect(text).toContain('title');
  });
});

describe('the taskMeta switch of composeWorkerSystemPrompt', () => {
  it('appends a meta info block when taskMeta is given; nothing appended by default', () => {
    const on = composeWorkerSystemPrompt('职责文本', undefined, {
      taskMeta: { currentTitle: '占位标题' },
    });
    expect(on).toContain('职责文本');
    expect(on).toContain('set_task_meta');
    expect(on).toContain('「占位标题」');
    const off = composeWorkerSystemPrompt('职责文本', undefined);
    expect(off).toBe('职责文本');
  });

  it('taskMeta.meta passthrough: github vocabulary enters the injected text (F28)', () => {
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
