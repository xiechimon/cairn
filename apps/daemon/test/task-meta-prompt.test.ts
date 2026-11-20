import { describe, expect, it } from 'vitest';
import { composeTaskMetaInstruction, composeWorkerSystemPrompt } from '../src/step-prompt.js';

describe('composeTaskMetaInstruction', () => {
  it('instructs ordinary workers to set a title without category arguments or vocabulary', () => {
    const text = composeTaskMetaInstruction('给登录页加验证码');
    expect(text).toContain('set_task_meta');
    expect(text).toContain('「给登录页加验证码」');
    expect(text).toContain('`title`');
    expect(text).not.toMatch(/`tags?`|bug|feature|improvement|refactor|docs|chore/);
  });

  it('pins the title-only ordinary naming instruction', () => {
    expect(composeTaskMetaInstruction('标题')).toBe(
      '## 任务元信息\n本任务当前标题是占位截断：「标题」。正式开工前，先调用一次 `set_task_meta` 工具回填标题：`title` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）。',
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

describe('composeWorkerSystemPrompt project instructions (D74 P1)', () => {
  it('adds the project instructions after the agent description and before memories', () => {
    const text = composeWorkerSystemPrompt('builder', [{ title: 'm', content: 'remembered' }], {
      project: { name: 'cairn', instructions: 'Never force push.' },
    });
    expect(text).toContain('## 项目说明（cairn）\nNever force push.');
    expect(text?.indexOf('builder')).toBeLessThan(text?.indexOf('Never force push.') ?? -1);
    expect(text?.indexOf('Never force push.')).toBeLessThan(text?.indexOf('remembered') ?? -1);
  });

  it('adds nothing when the project has no instructions', () => {
    expect(
      composeWorkerSystemPrompt(undefined, undefined, { project: { name: 'cairn' } }),
    ).toBeUndefined();
  });
});
