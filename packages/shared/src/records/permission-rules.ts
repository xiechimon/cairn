// 命令闸规则表形状（#866 T5 tracer：对齐 AMP 闸门哲学 + cairn 双闸）。
// AMP 权限模型（docs/research/amp-native-sandbox-orb.md §1.2）：每次工具调用
// 前按序匹配规则表，命中即执行动作，未命中回落默认。本表取其三动作子集
// allow/ask/reject（AMP 还有 delegate——外接 OPA/脚本，本仓 tracer 不做）：
// - allow：放行；ask：要审批；reject：恒拒。
// - 默认放行：无命中 = allow（AMP 全自动档同律：`allow '*'` + 只拦疑似删文件）。
// - 可逆免闸：规则只应对不可逆形态设闸（AMP §2.1：Git 让改错成本趋零）。
// 与双闸的关系（#861 不确定点定案）：confirm（方案审批）与 review（改后审计）
// 是流程闸；本表是执行层命令闸，第三道，不替代前两者。ask 在无人值守 daemon
// 面按拒执行（没有审批面可问），人的判断仍在 confirm/review。
// 本文件只定形状 + 通用 glob 匹配器（纯函数，可单测）；bash 命令形态的精确判
// 定（操作数级：rm 删的是 / 还是 worktree 子目录）在 daemon
// backend/command-gate.ts——glob 表达不了"操作数恰为 /"。

import { z } from 'zod';

/** 规则动作三值（AMP 子集；delegate 留给将来外接审批面）。 */
export const permissionActionSchema = z.enum(['allow', 'ask', 'reject']);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

/** 单条规则（AMP 形 `{tool, matches, action}`；matches 值持 `*` 通配，
 * 大小写敏感；缺 matches = 命中该工具一切调用）。 */
export const permissionRuleSchema = z.object({
  /** 稳定 id（审计口径：日志行与拒绝文案引用它）。 */
  id: z.string().min(1),
  /** 工具名（pi 面小写 `bash` / SDK 面 `Bash` 等均可写；`*` = 全工具）。 */
  tool: z.string().min(1),
  /** 参数槽 glob（bash 面即 `{command: '<glob>'}`；缺省 = 全匹配）。 */
  matches: z.record(z.string(), z.string()).optional(),
  action: permissionActionSchema,
  /** 给人看的一句话（为什么拦/放）。 */
  description: z.string().optional(),
});
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

/** `*` 通配匹配（大小写敏感；`?`/字符类不支持——tracer 够用，见测试）。 */
export function matchGlob(pattern: string, value: string): boolean {
  // 切 `*` → 字面段全序包含（空段跳过；首尾段不锚定 = contains 语义）。
  const parts = pattern.split('*');
  let from = 0;
  for (const part of parts) {
    if (part === '') continue;
    const hit = value.indexOf(part, from);
    if (hit === -1) return false;
    from = hit + part.length;
  }
  return true;
}

/** 按序匹配：首命中胜出；无命中 = undefined（调用方按 allow 处理——默认放
 * 行是本函数的调用方契约，不是返回值）。params 缺失的槽按空串匹配。 */
export function matchPermissionRule(
  rules: readonly PermissionRule[],
  toolName: string,
  params: Readonly<Record<string, string>>,
): PermissionRule | undefined {
  for (const rule of rules) {
    if (rule.tool !== '*' && rule.tool !== toolName) continue;
    const slots = rule.matches ?? {};
    let hit = true;
    for (const [slot, pattern] of Object.entries(slots)) {
      if (!matchGlob(pattern, params[slot] ?? '')) {
        hit = false;
        break;
      }
    }
    if (hit) return rule;
  }
  return undefined;
}
