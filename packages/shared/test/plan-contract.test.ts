// plan.md 结构契约（#1492）：Verification 小节必须非空，且每一项都能机器
// 校验。外部行为 = 「一份 plan.md 能不能过 confirm 前的结构闸、不过时点名
// 哪里不合格、过闸时清单是什么」。失败方式枚举先于实现固化（AGENTS.md
// 测试规则 3），票面验收要求缺节 / 空话 / 合格三类：
//   1. 缺节：没有 Verification 小节，或小节下没有任何内容 → 拒。
//   2. 空话：某一项没有可执行锚点（命令、代码、路径）→ 拒，点名第几项。
//   3. 模糊占位：任一项含 TODO / TBD / 待定 / 待补 → 拒，即便带了锚点。
//   4. 合格：每项都有锚点 → 过，清单按原顺序返回（verify 步逐项出判定的输入）。
//   5. 两种小节写法都认：`## Verification` 标题与行首 `Verification:` 标签
//      （现存 plan 两种都有，web 方案面同样两种都认）。
//   6. 小节边界：下一个四段小节（或同级以上标题）开始即结束，后面的内容
//      不算进 Verification。
//   7. 代码围栏整体算一项（多行命令不被拆成多个「空话」项）。

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

describe('checkPlanContract 缺节（#1492 失败方式 1）', () => {
  test('没有 Verification 小节 → 拒', () => {
    const r = checkPlanContract('## Context\n背景\n\n## Changes\n- 改 a.ts\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('Verification');
  });

  test('有 Verification 标题但下面是空的 → 拒', () => {
    const r = checkPlanContract(
      '## Changes\n- 改 a.ts\n\n## Verification\n\n## Edge cases\n- 无\n',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('为空');
  });
});

describe('checkPlanContract 空话（#1492 失败方式 2、3）', () => {
  test('某一项只有空话 → 拒，并点名第几项', () => {
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

  test('带锚点但含 TODO / 待定 → 仍拒', () => {
    for (const vague of ['TODO', 'TBD', '待定', '待补']) {
      const r = checkPlanContract(`## Verification\n- \`pnpm test\` ${vague}\n`);
      expect(r.ok, vague).toBe(false);
    }
  });

  test('没有列表时每个非空行各算一项', () => {
    const r = checkPlanContract('## Verification\n`pnpm lint` 通过\n大致看一下\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('第 2 项');
  });
});

describe('checkPlanContract 合格（#1492 失败方式 4–7）', () => {
  test('每项都有锚点 → 过，清单按原顺序返回', () => {
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

  test('仓根单个文件名算锚点（读回 README.md 可核对）', () => {
    expect(checkPlanContract('Verification: 读回 README.md 确认探针行在位。\n').ok).toBe(true);
  });

  test('行首命令（不带反引号）算锚点', () => {
    const r = checkPlanContract('## Verification\n1. pnpm typecheck 通过\n2. gh pr checks 全绿\n');
    expect(r.ok).toBe(true);
  });

  test('`Verification:` 标签写法也认，标签同行内容算一项', () => {
    const r = checkPlanContract(
      'Context: 背景\nChanges: 改 a.ts\nVerification: `pnpm lint` 通过\n- `pnpm typecheck` 通过\n',
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint` 通过', '`pnpm typecheck` 通过'] });
  });

  test('下一个小节开始即结束，后面的空话不算进来', () => {
    const r = checkPlanContract('## Verification\n- `pnpm lint`\n\n## Edge cases\n- 看情况\n');
    expect(r).toEqual({ ok: true, items: ['`pnpm lint`'] });
  });

  test('代码围栏整体算一项', () => {
    const r = checkPlanContract(
      '## Verification\n```sh\npnpm lint\npnpm typecheck\n```\n- 新测试 `apps/x.test.ts` 通过\n',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(2);
  });

  test('小节内的下级标题只是分组，不算空话项', () => {
    const r = checkPlanContract(
      '## Verification\n### 单测\n- `pnpm lint`\n### e2e\n- `pnpm e2e`\n',
    );
    expect(r).toEqual({ ok: true, items: ['`pnpm lint`', '`pnpm e2e`'] });
  });

  test('小标题大小写与级别不敏感（### verification）', () => {
    expect(checkPlanContract('### verification\n- `pnpm lint`\n').ok).toBe(true);
  });
});

// 自审补的误拦形态（校验太严 = 正常方案被打回、补写一次后整轮失败）。
describe('checkPlanContract 不误拦常见写法（#1492 失败方式：校验太严）', () => {
  test('小写 todo 是业务名词；行内代码里的 TODO 是正经检查', () => {
    expect(
      checkPlanContract(
        '## Verification\n- `pnpm vitest run packages/shared/test/todo.test.ts` 通过\n',
      ).ok,
    ).toBe(true);
    expect(checkPlanContract('## Verification\n- `rg TODO src` 无输出\n').ok).toBe(true);
  });

  test('加粗标签、带序号标题、全角冒号都认', () => {
    for (const head of ['**Verification**:', '## 4. Verification', '## Verification：']) {
      expect(checkPlanContract(`${head}\n- \`pnpm test\`\n`).ok, head).toBe(true);
    }
  });

  test('列表前的引导句不算项，子项并入父项', () => {
    expect(checkPlanContract('## Verification\n以下各项全部通过：\n- `pnpm test`\n').ok).toBe(true);
    expect(checkPlanContract('## Verification\n- `pnpm test`\n  - 期望全部通过\n')).toEqual({
      ok: true,
      items: ['`pnpm test` 期望全部通过'],
    });
  });

  test('「#1492 回归」这类行不当标题截断小节', () => {
    const r = checkPlanContract('## Verification\n- `pnpm test`\n#1492 回归\n- `pnpm lint`\n');
    expect(r.ok && r.items.length).toBe(2);
  });

  test('CRLF 行尾与 LF 同判', () => {
    expect(checkPlanContract('## Verification\r\n- `pnpm test`\r\n  跑完看输出\r\n').ok).toBe(true);
  });
});

describe('planVerificationItems（verify 步的清单输入）', () => {
  test('合格方案返回清单；不合格或无小节返回空数组（老方案不回溯）', () => {
    expect(planVerificationItems(GOOD)).toHaveLength(3);
    expect(planVerificationItems('## Context\n只写了背景\n')).toEqual([]);
    expect(planVerificationItems('## Verification\n- 确认没问题\n')).toEqual([]);
  });
});
