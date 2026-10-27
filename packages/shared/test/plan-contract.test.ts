import { describe, expect, test } from 'vitest';
import { checkPlanContract, planVerificationItems } from '../src/records/plan.js';
import plan1606Verification from './fixtures/plan1606-verification.md?raw';
import plan2006Verification from './fixtures/plan2006-verification.md?raw';

const GOOD = [
  'Kind: fix',
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
      'Kind: fix\n## Verification\n- `pnpm typecheck` 通过\n- 确认没问题\n- 手动检查一下页面\n',
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
      const r = checkPlanContract(`Kind: fix\n## Verification\n- \`pnpm test\` ${vague}\n`);
      expect(r.ok, vague).toBe(false);
    }
  });

  test('without a list, every non-empty line counts as an item', () => {
    const r = checkPlanContract('Kind: fix\n## Verification\n`pnpm lint` 通过\n大致看一下\n');
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
    expect(checkPlanContract('Kind: fix\nVerification: 读回 README.md 确认探针行在位。\n').ok).toBe(
      true,
    );
  });

  test('a line-leading command (without backticks) counts as an anchor', () => {
    const r = checkPlanContract(
      'Kind: fix\n## Verification\n1. pnpm typecheck 通过\n2. gh pr checks 全绿\n',
    );
    expect(r.ok).toBe(true);
  });

  test('`Verification:` label form also accepted; content on the label line counts as an item', () => {
    const r = checkPlanContract(
      'Kind: fix\nContext: 背景\nChanges: 改 a.ts\nVerification: `pnpm lint` 通过\n- `pnpm typecheck` 通过\n',
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint` 通过', '`pnpm typecheck` 通过'] });
  });

  test('the next section heading ends the list; empty words after it do not count', () => {
    const r = checkPlanContract(
      'Kind: fix\n## Verification\n- `pnpm lint`\n\n## Edge cases\n- 看情况\n',
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint`'] });
  });

  test('a whole code fence counts as one item', () => {
    const r = checkPlanContract(
      'Kind: fix\n## Verification\n```sh\npnpm lint\npnpm typecheck\n```\n- 新测试 `apps/x.test.ts` 通过\n',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(2);
  });

  test('sub-headings inside a section are only grouping, not empty-word items', () => {
    const r = checkPlanContract(
      'Kind: fix\n## Verification\n### 单测\n- `pnpm lint`\n### e2e\n- `pnpm e2e`\n',
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint`', '`pnpm e2e`'] });
  });

  test('subheading case and level insensitive (### verification)', () => {
    expect(checkPlanContract('Kind: fix\n### verification\n- `pnpm lint`\n').ok).toBe(true);
  });
});

describe('checkPlanContract does not over-block common styles (#1492 failure mode: validation too strict)', () => {
  test('lowercase todo is a business noun; a TODO inside inline code is a legitimate check', () => {
    expect(
      checkPlanContract(
        'Kind: fix\n## Verification\n- `pnpm vitest run packages/shared/test/todo.test.ts` 通过\n',
      ).ok,
    ).toBe(true);
    expect(checkPlanContract('Kind: fix\n## Verification\n- `rg TODO src` 无输出\n').ok).toBe(true);
  });

  test('bold labels, numbered headings, fullwidth colons all accepted', () => {
    for (const head of ['**Verification**:', '## 4. Verification', '## Verification：']) {
      expect(checkPlanContract(`Kind: fix\n${head}\n- \`pnpm test\`\n`).ok, head).toBe(true);
    }
  });

  test('lead-in sentences before a list do not count as items; sub-items merge into the parent', () => {
    expect(
      checkPlanContract('Kind: fix\n## Verification\n以下各项全部通过：\n- `pnpm test`\n').ok,
    ).toBe(true);
    expect(
      checkPlanContract('Kind: fix\n## Verification\n- `pnpm test`\n  - 期望全部通过\n'),
    ).toEqual({
      ok: true,
      items: ['`pnpm test` 期望全部通过'],
    });
  });

  test('lines like "#1492 regression" do not truncate the section as headings', () => {
    const r = checkPlanContract(
      'Kind: fix\n## Verification\n- `pnpm test`\n#1492 回归\n- `pnpm lint`\n',
    );
    expect(r.ok && r.items.length).toBe(2);
  });

  test('CRLF and LF line endings judged the same', () => {
    expect(
      checkPlanContract('Kind: fix\n## Verification\r\n- `pnpm test`\r\n  跑完看输出\r\n').ok,
    ).toBe(true);
  });
});

describe('checkPlanContract indented fence inside a list item (#1728)', () => {
  test('the real plan from #1606 passes and yields 9 items', () => {
    const r = checkPlanContract(`Kind: fix\n${plan1606Verification}`);
    expect(r.ok, !r.ok ? r.problem : '').toBe(true);
    if (r.ok) expect(r.items).toHaveLength(9);
  });

  test('a fence indented deeper than the list item joins that item, and indented text after it continues it', () => {
    const r = checkPlanContract(
      [
        'Kind: fix',
        '## Verification',
        '1. Run the test file:',
        '',
        '   ```sh',
        '   pnpm exec vitest run packages/shared/test/plan-contract.test.ts',
        '   ```',
        '',
        '   Assert: exit code 0.',
        '2. `pnpm lint` passes',
      ].join('\n'),
    );
    expect(r.ok, !r.ok ? r.problem : '').toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(2);
      expect(r.items[0]).toContain('vitest run packages/shared/test/plan-contract.test.ts');
      expect(r.items[0]).toContain('exit code 0');
    }
  });

  test('a top-level fence stays its own item', () => {
    const r = checkPlanContract(
      'Kind: fix\n## Verification\n```sh\npnpm lint\n```\n- 新测试 `apps/x.test.ts` 通过\n',
    );
    expect(r).toEqual({
      ok: true,
      items: ['```sh\npnpm lint\n```', '新测试 `apps/x.test.ts` 通过'],
    });
  });
});

describe('checkPlanContract bold-labeled checks without a list (#2006)', () => {
  test('the real plan from #2006 passes with one item per bold label', () => {
    const r = checkPlanContract(`Kind: fix\n${plan2006Verification}`);
    expect(r.ok, !r.ok ? r.problem : '').toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(9);
      expect(r.items[0]).toMatch(/^\*\*V0/);
      expect(r.items[0]).toContain('Expected at planning time');
    }
  });

  test('a label owns its fence and the prose after it; intro prose before the first label is not an item', () => {
    const r = checkPlanContract(
      [
        'Kind: fix',
        '## Verification',
        'All commands run at the repo root.',
        '',
        '**V0 — lint:**',
        '',
        '```sh',
        'pnpm lint',
        '```',
        '',
        'Expected: exit 0.',
        '',
        '**V1 — tests:** `pnpm exec vitest run packages/shared/test/plan-contract.test.ts` passes',
      ].join('\n'),
    );
    expect(r.ok, !r.ok ? r.problem : '').toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(2);
      expect(r.items[0]).toContain('pnpm lint');
      expect(r.items[0]).toContain('Expected: exit 0.');
    }
  });

  test('a label with only prose and no check is still rejected', () => {
    const r = checkPlanContract(
      'Kind: fix\n## Verification\n**V0 — sanity:**\n\nLooks right after the change.\n\n**V1:** `pnpm lint` passes\n',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('第 1 项');
  });
});

describe('planVerificationItems (checklist input for the verify step)', () => {
  test('valid plan returns the checklist; invalid or no section returns empty array (old plans not backfilled)', () => {
    expect(planVerificationItems(GOOD)).toHaveLength(3);
    expect(planVerificationItems('## Context\n只写了背景\n')).toEqual([]);
    expect(planVerificationItems('Kind: fix\n## Verification\n- 确认没问题\n')).toEqual([]);
  });
});

const VERIFIED =
  '## Verification\n- `pnpm exec vitest run packages/shared/test/plan-contract.test.ts` passes\n';

const PRIOR_ART_OK = [
  '## Prior art',
  '- croner: https://github.com/Hexagon/croner',
  '- Decision: reuse `croner` (maintained, 0 deps) instead of a hand-written parser.',
].join('\n');

describe('checkPlanContract prior art (#1838)', () => {
  test('a feature plan without a Prior art section is rejected', () => {
    const r = checkPlanContract(
      [
        '## Context',
        'Kind: feature',
        'Add cron-style scheduling, a new user-facing capability.',
        '',
        '## Changes',
        '- new module apps/server/src/services/cron-schedule.ts',
        '',
        VERIFIED,
      ].join('\n'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('Prior art');
  });

  test('a split plan and a new-module plan are feature plans', () => {
    for (const body of [
      '## Context\n拆解方案：把调度和通知拆卡。\n',
      '## Changes\n- Add a new module `packages/shared/src/cron.ts`\n',
      'Kind: feature\n',
    ]) {
      const r = checkPlanContract(`${body}\n${VERIFIED}`);
      expect(r.ok, body).toBe(false);
      if (!r.ok) expect(r.problem).toContain('Prior art');
    }
  });

  test('a one-line bug fix is accepted without Prior art', () => {
    const r = checkPlanContract(
      [
        '## Context',
        'Kind: fix',
        'One-line bug fix: the failure banner stays blank.',
        '',
        '## Changes',
        '- apps/server/src/services/builds.ts returns the stored error string',
        '',
        '## Verification',
        '- `pnpm exec vitest run apps/server/test/build-fallback-report.test.ts` passes',
      ].join('\n'),
    );
    expect(r).toMatchObject({ ok: true });
  });

  test('Kind: fix does not exempt a plan that adds a new module', () => {
    const r = checkPlanContract(
      [
        'Kind: fix',
        '## Changes',
        '- Add a new module `packages/shared/src/cron.ts`',
        VERIFIED,
      ].join('\n'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('Prior art');
  });

  test('a feature plan whose Prior art section has no link is rejected', () => {
    const r = checkPlanContract(
      [
        'Kind: feature',
        '## Prior art',
        '- croner is a scheduling library',
        '- Decision: reuse croner (maintained, 0 deps) instead of a hand-written parser.',
        VERIFIED,
      ].join('\n'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('链接');
  });

  test('a link inside a code fence does not count as a citation', () => {
    const r = checkPlanContract(
      [
        'Kind: feature',
        '## Prior art',
        '```',
        'https://github.com/Hexagon/croner',
        '```',
        '- Decision: reuse croner (maintained, 0 deps) instead of a hand-written parser.',
        VERIFIED,
      ].join('\n'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('链接');
  });

  test('a link without a reuse-or-build decision and a reason is rejected', () => {
    const r = checkPlanContract(
      [
        'Kind: feature',
        '## Prior art',
        '- https://github.com/Hexagon/croner',
        '- Decision: reuse croner',
        VERIFIED,
      ].join('\n'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('决策');
  });

  test('one cited link plus a reuse-or-build decision passes', () => {
    const r = checkPlanContract(
      ['Kind: feature', 'new user-facing capability', PRIOR_ART_OK, VERIFIED].join('\n'),
    );
    expect(r.ok, !r.ok ? r.problem : '').toBe(true);
  });

  test('a decision to build, with a reason and a link, passes', () => {
    const r = checkPlanContract(
      [
        'Kind: feature',
        '## Prior art',
        '- https://github.com/Hexagon/croner',
        '- Decision: build our own parser because the library cannot express todo calendar fields.',
        VERIFIED,
      ].join('\n'),
    );
    expect(r.ok, !r.ok ? r.problem : '').toBe(true);
  });

  test('Prior art placed after Verification is not judged as a verification item', () => {
    const r = checkPlanContract(
      ['## Verification', '- `pnpm lint`', '', PRIOR_ART_OK, '', 'Kind: feature'].join('\n'),
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint`'] });
  });

  test('a label-form Prior art section and a numbered heading are accepted', () => {
    const r = checkPlanContract(
      [
        'Kind: feature',
        'Prior art: https://github.com/Hexagon/croner',
        '- Decision: reuse croner because it is maintained instead of a hand-written parser.',
        VERIFIED,
      ].join('\n'),
    );
    expect(r.ok, !r.ok ? r.problem : '').toBe(true);
    const numbered = checkPlanContract(
      [
        'Kind: feature',
        '## 5. Prior art',
        '- https://github.com/Hexagon/croner',
        '- Decision: reuse croner (maintained) instead of a hand-written parser.',
        VERIFIED,
      ].join('\n'),
    );
    expect(numbered.ok, !numbered.ok ? numbered.problem : '').toBe(true);
  });

  test('an invalid feature plan yields no verification checklist', () => {
    expect(planVerificationItems(`Kind: feature\n${VERIFIED}`)).toEqual([]);
  });
});

describe('vague words inside a nested code block', () => {
  test('does not flag a command that searches for TODO', () => {
    const plan = [
      'Kind: fix',
      '## Verification',
      '',
      '1. Scan the new doc for leftover markers:',
      '',
      '   ```sh',
      '   grep -n TODO docs/ops/failure-attribution.md',
      '   ```',
      '',
      '   Assert: no output.',
    ].join('\n');
    expect(checkPlanContract(plan)).toMatchObject({ ok: true });
  });
});
