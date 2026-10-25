import { describe, expect, test } from 'vitest';
import { checkPlanContract, planVerificationItems } from '../src/records/plan.js';

const GOOD = [
  '## Context',
  '卡片失败时横幅空白。',
  '',
  '## Changes',
  '- builds.ts 落兜底报告',
  '',
  '## Verification',
  '- `pnpm exec vitest run apps/server/test/build-fallback-report.test.ts` 通过',
  '- 新用例 apps/web/e2e/fallback.spec.ts 断言卡片显示失败原因',
  '- curl http://127.0.0.1:8787/api/builds/x 返回 errorMessage 非空',
].join('\n');

describe('checkPlanContract missing section (#1492 failure mode 1)', () => {
  test('no Verification section -> rejected', () => {
    const r = checkPlanContract('## Context\n背景\n\n## Changes\n- 改 a.ts\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('Verification');
  });

  test('has a Verification heading but empty below -> rejected', () => {
    const r = checkPlanContract(
      '## Changes\n- 改 a.ts\n\n## Verification\n\n## Edge cases\n- 无\n',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('为空');
  });
});

describe('checkPlanContract empty words (#1492 failure modes 2, 3)', () => {
  test('an item with only empty words -> rejected, naming which item', () => {
    const r = checkPlanContract(
      '## Verification\n- `pnpm typecheck` 通过\n- 确认没问题\n- 手动检查一下页面\n',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toContain('第 2 项');
      expect(r.problem).toContain('第 3 项');
      expect(r.problem).not.toContain('第 1 项');
    }
  });

  test('with an anchor but containing TODO / TBD -> still rejected', () => {
    for (const vague of ['TODO', 'TBD', '待定', '待补']) {
      const r = checkPlanContract(`## Verification\n- \`pnpm test\` ${vague}\n`);
      expect(r.ok, vague).toBe(false);
    }
  });

  test('without a list, every non-empty line counts as an item', () => {
    const r = checkPlanContract('## Verification\n`pnpm lint` 通过\n大致看一下\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('第 2 项');
  });
});

describe('checkPlanContract valid (#1492 failure modes 4-7)', () => {
  test('every item has an anchor -> pass, checklist returned in original order', () => {
    const r = checkPlanContract(GOOD);
    expect(r).toEqual({
      ok: true,
      items: [
        '`pnpm exec vitest run apps/server/test/build-fallback-report.test.ts` 通过',
        '新用例 apps/web/e2e/fallback.spec.ts 断言卡片显示失败原因',
        'curl http://127.0.0.1:8787/api/builds/x 返回 errorMessage 非空',
      ],
    });
  });

  test('a single repo-root file name counts as an anchor (read back README.md to verify)', () => {
    expect(checkPlanContract('Verification: 读回 README.md 确认探针行在位。\n').ok).toBe(true);
  });

  test('a line-leading command (without backticks) counts as an anchor', () => {
    const r = checkPlanContract('## Verification\n1. pnpm typecheck 通过\n2. gh pr checks 全绿\n');
    expect(r.ok).toBe(true);
  });

  test('`Verification:` label form also accepted; content on the label line counts as an item', () => {
    const r = checkPlanContract(
      'Context: 背景\nChanges: 改 a.ts\nVerification: `pnpm lint` 通过\n- `pnpm typecheck` 通过\n',
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint` 通过', '`pnpm typecheck` 通过'] });
  });

  test('the next section heading ends the list; empty words after it do not count', () => {
    const r = checkPlanContract('## Verification\n- `pnpm lint`\n\n## Edge cases\n- 看情况\n');
    expect(r).toEqual({ ok: true, items: ['`pnpm lint`'] });
  });

  test('a whole code fence counts as one item', () => {
    const r = checkPlanContract(
      '## Verification\n```sh\npnpm lint\npnpm typecheck\n```\n- 新测试 `apps/x.test.ts` 通过\n',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(2);
  });

  test('sub-headings inside a section are only grouping, not empty-word items', () => {
    const r = checkPlanContract(
      '## Verification\n### 单测\n- `pnpm lint`\n### e2e\n- `pnpm e2e`\n',
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint`', '`pnpm e2e`'] });
  });

  test('subheading case and level insensitive (### verification)', () => {
    expect(checkPlanContract('### verification\n- `pnpm lint`\n').ok).toBe(true);
  });
});

describe('checkPlanContract does not over-block common styles (#1492 failure mode: validation too strict)', () => {
  test('lowercase todo is a business noun; a TODO inside inline code is a legitimate check', () => {
    expect(
      checkPlanContract(
        '## Verification\n- `pnpm vitest run packages/shared/test/todo.test.ts` 通过\n',
      ).ok,
    ).toBe(true);
    expect(checkPlanContract('## Verification\n- `rg TODO src` 无输出\n').ok).toBe(true);
  });

  test('bold labels, numbered headings, fullwidth colons all accepted', () => {
    for (const head of ['**Verification**:', '## 4. Verification', '## Verification：']) {
      expect(checkPlanContract(`${head}\n- \`pnpm test\`\n`).ok, head).toBe(true);
    }
  });

  test('lead-in sentences before a list do not count as items; sub-items merge into the parent', () => {
    expect(checkPlanContract('## Verification\n以下各项全部通过：\n- `pnpm test`\n').ok).toBe(true);
    expect(checkPlanContract('## Verification\n- `pnpm test`\n  - 期望全部通过\n')).toEqual({
      ok: true,
      items: ['`pnpm test` 期望全部通过'],
    });
  });

  test('lines like "#1492 regression" do not truncate the section as headings', () => {
    const r = checkPlanContract('## Verification\n- `pnpm test`\n#1492 回归\n- `pnpm lint`\n');
    expect(r.ok && r.items.length).toBe(2);
  });

  test('CRLF and LF line endings judged the same', () => {
    expect(checkPlanContract('## Verification\r\n- `pnpm test`\r\n  跑完看输出\r\n').ok).toBe(true);
  });
});

describe('planVerificationItems (checklist input for the verify step)', () => {
  test('valid plan returns the checklist; invalid or no section returns empty array (old plans not backfilled)', () => {
    expect(planVerificationItems(GOOD)).toHaveLength(3);
    expect(planVerificationItems('## Context\n只写了背景\n')).toEqual([]);
    expect(planVerificationItems('## Verification\n- 确认没问题\n')).toEqual([]);
  });
});
