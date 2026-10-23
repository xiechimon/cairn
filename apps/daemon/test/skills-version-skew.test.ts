// 技能分发 wire 的版本歪斜双腿（#919 seam 6；#920 把 GET /api/machine/
// skills/{stepId} 从「整包全文」改成「清单 + 按需拉」后的兼容面钉扎）。
// 两条腿都要的是**同一件事**：形态错位必须炸在 zod 边界上（干净的
// safeParse 失败），绝不静默误读成「空技能面」或半解析产物——#920 根因
// 正是旧 fail-open 把 wire 故障吞成静默空清单（43 连败无人察觉）。
//
// 失败方式清单（先于断言固化）：
//   V1 新 daemon × 旧 server 200（旧整包形）：新 schema 若误收——files 里
//      只有 path/content、没有 sizeBytes/sha256——物化层会拿不到完整性真值
//      或误读 content 为清单条目。必须拒绝。
//   V2 旧 fixture 有效性反证：旧整包形 fixture 必须**通过冻结的旧 schema**
//      ——V1 的输入得真是旧 server 的产物形态，不是随手造来让新 schema 拒
//      的乱 JSON（期望值独立来源纪律）。
//   V3 旧 daemon × 新 server：冻结旧 schema 对新清单形必须干净拒绝（旧
//      daemon 的 fail-open catch 接的就是这种 zod 失败 → 旧机器技能面退化
//      为空但会话照常——旧行为是冻结历史，本票钉的是「拒绝形态可被 catch
//      捕获」而非抛崩溃形）。
//   V4 新 schema × 真 server 捕获金样：#920 归档的实机响应（docs/verify/
//      920/wire-new/manifest-new.json）必须通过现行 schema——金样与实现
//      互为独立来源，防 schema 漂移后金样静默失效。
//   V5 旧 server 字节闸 400 形：#920 归档实机响应（wire-old-before/
//      manifest-old-400.json）钉「旧 server 对超限库出非 2xx」这一腿的
//      形状真值——新 daemon 侧非 2xx → MachineApiError → 步 failed 显式
//      收尾已由 runner-team-skills.test.ts R2/R6 钉死，此处只钉归档证据
//      与端点语义仍一致（status 4xx + body.error 点名根因）。
//
// 冻结旧 schema 的出处：`git show b3072007^:packages/shared/src/protocol/
// machine-wire.ts`（machineSkillsResponseSchema，#920 改写前原文逐字拷贝）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { machineSkillsManifestResponseSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

/** 冻结副本（provenance 见文件头）：#920 前的整包响应 schema 原文。 */
const frozenOldMachineSkillsResponseSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      dirName: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          content: z.string(),
        }),
      ),
    }),
  ),
});

/** 旧 server 200 整包形 fixture（V2 先行自证：过冻结旧 schema 才算数）。 */
const OLD_BUNDLE_200 = {
  skills: [
    {
      id: 'alpha',
      name: 'alpha',
      description: '旧整包分发形',
      dirName: 'alpha',
      files: [
        { path: 'SKILL.md', content: '---\nname: alpha\n---\n\nbody\n' },
        { path: 'notes.md', content: 'notes body\n' },
      ],
    },
  ],
};

function archived(relFromRepoRoot: string): unknown {
  // apps/daemon/test/ → 仓根 = 上三级（vitest projects 模式下 cwd 不保证，
  // 一律以本文件 URL 锚定）。
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../${relFromRepoRoot}`, import.meta.url)), 'utf8'),
  ) as unknown;
}

describe('skills 分发 wire 版本歪斜（#919 seam：新 daemon × 旧 server / 旧 daemon × 新 server）', () => {
  test('V2 旧整包形 fixture 通过冻结旧 schema（fixture 有效性反证）', () => {
    expect(frozenOldMachineSkillsResponseSchema.safeParse(OLD_BUNDLE_200).success).toBe(true);
  });

  test('V1 新 daemon × 旧 server 200：现行清单 schema 干净拒绝旧整包形', () => {
    const result = machineSkillsManifestResponseSchema.safeParse(OLD_BUNDLE_200);
    expect(result.success).toBe(false);
    // 拒绝理由必须点名新形必填位（selection / sizeBytes / sha256）——防
    // 「碰巧因别的字段拒了」的假阴性。
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.')).join(' ');
      expect(paths).toContain('selection');
    }
  });

  test('V3 旧 daemon × 新 server：冻结旧 schema 对实机捕获的新清单形干净拒绝', () => {
    const golden = archived('docs/verify/920/wire-new/manifest-new.json') as {
      manifest: unknown;
    };
    const result = frozenOldMachineSkillsResponseSchema.safeParse(golden.manifest);
    // 干净拒绝 = safeParse 形态（旧 fail-open catch 可捕获的 ZodError 族），
    // 且理由点名旧形必填的 files[].content 缺位。
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.')).join(' ');
      expect(paths).toContain('content');
    }
  });

  test('V4 现行 schema 通过实机捕获的新清单金样（#920 归档，独立来源）', () => {
    const golden = archived('docs/verify/920/wire-new/manifest-new.json') as {
      manifest: unknown;
    };
    expect(machineSkillsManifestResponseSchema.safeParse(golden.manifest).success).toBe(true);
  });

  test('V5 旧 server 字节闸 400 归档形仍是「非 2xx + body.error 点名根因」', () => {
    const old400 = archived('docs/verify/920/wire-old-before/manifest-old-400.json') as {
      status: number;
      body: { error: string };
    };
    expect(old400.status).toBe(400);
    expect(old400.body.error).toContain('skill file too large');
  });
});
