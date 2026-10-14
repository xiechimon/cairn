// #1313：review「完成」是否该提供合并。
//
// todo.hasChanges 的真值是 conv 分支 countAhead>0（daemon runner）。空提交
// 也让这个计数大于 0，卡会进 review，但相对默认分支的文件 diff 是空的。
// 合并勾选在「已上报且 git 没有文件头」时消失。`changed` 看原始 diff 里
// 有没有 `diff --git` 行：二进制、100% 重命名、mode-only、空文件没有 hunk，
// parseUnifiedDiff 会丢掉，但这些行还在。没读到，或 reported 缺席 / false，
// 保持合并勾选。changed 缺席时退回文件数。
//
// 本判据只喂 AcceptDialog。产物闸 stepArtifactGate 仍读 done 载荷的
// hasChanges，空提交继续以 hasChanges=true 过闸，漂移文案的触发条件不变。

export interface ReportedChanges {
  files: readonly unknown[];
  reported?: boolean;
  /** 原始 git diff 是否含文件头。true = 有改动（含解析器丢掉的）。
   *  false = 已上报且 diff 没有文件头。缺席 = 旧响应，退回 files。 */
  changed?: boolean;
}

/** null = 判据未知（查询未完成、失败，或响应没声明 reported）。
 *  true = 有 git 改动。false = 已上报且 git 没有文件头。 */
export function substantiveChangesOf(
  changes: ReportedChanges | null | undefined,
  settled: boolean,
): boolean | null {
  if (!settled || changes == null || changes.reported !== true) return null;
  if (typeof changes.changed === 'boolean') return changes.changed;
  return changes.files.length > 0;
}
