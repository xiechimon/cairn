// #1313：review「完成」是否该提供合并。
//
// todo.hasChanges 的真值是 conv 分支 countAhead>0（daemon runner）。空提交
// 也让这个计数大于 0，卡会进 review，但相对默认分支的文件 diff 是空的。
// 合并勾选只在「已上报且确有文件」时出现。没读到、或服务端没说这份 diff
// 是上报过的（reported 缺席 / false），保持合并勾选——把「没上报」当成
// 「没有改动」会让真有 diff 的卡跳过合并。
//
// 本判据只喂 AcceptDialog。产物闸 stepArtifactGate 仍读 done 载荷的
// hasChanges，空提交继续以 hasChanges=true 过闸，漂移文案的触发条件不变。

export interface ReportedChanges {
  files: readonly unknown[];
  reported?: boolean;
}

/** null = 判据未知（查询未完成、失败，或响应没声明 reported）。
 *  true = 已上报且至少有一个文件。false = 已上报且文件集为空。 */
export function substantiveChangesOf(
  changes: ReportedChanges | null | undefined,
  settled: boolean,
): boolean | null {
  if (!settled || changes == null || changes.reported !== true) return null;
  return changes.files.length > 0;
}
