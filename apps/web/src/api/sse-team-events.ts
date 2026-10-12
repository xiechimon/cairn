// team stream 事件 → 失效键映射（#666 抽缝）。单缝：把 useTeamStream 的
// switch 里「事件翻成哪些 invalidateQueries 键」独立成纯函数——不引 React /
// react-query 运行时（同 sse-connection.ts 的先例），node 环境单测可直接铺
// 真 wire 形状事件驱动（apps/web/test/sse-team-events.test.ts）。副作用
// （桌面通知）不在映射里，留在 hook。
//
// #666 的洞：['plans'] 此前只由 conversation stream 的 message/step 事件
// 失效（sse.ts），而 plan 行本体经 machine upload 缝静默落库。详情页 conv
// 流迟到建连（服务端不重放）或哑掉时，三层看护全不覆盖「相位已到 confirm、
// 方案卡缺席」态——XMON-60 闸门恰好在 confirm 关闭（非在飞相位）、#462
// 看门狗要完全静默（ping 在流）、seq 空洞要建连后吞帧。team 流是另一条
// 连接，CI 三次实锤里它都活着（相位 chip 翻了）：todo/build 文档事件恒在
// plan 行落库之后发布（daemon 顺序 PUT plan.md → done；server receivePlan
// Upload 同步落库 → completeStep → setTodoPhase → publishTodoDoc），把
// plans 挂上这两个事件 = 方案卡与相位 chip 同事件收敛，conv 流死活不再
// 决定方案卡上屏。

/** 一条 team stream 事件应失效的查询键集（空集 = ping / 未知事件）。 */
export function teamEventInvalidations(
  ev: Record<string, unknown>,
  teamId: string,
): (readonly string[])[] {
  switch (ev.type) {
    case 'todo': {
      const doc = ev.doc as { id: string };
      // ['plans'] 走前缀失效：活跃 plans 查询每页至多一个（详情页当前
      // build），代价一次小表重取；todo 事件不带 buildId，前缀是全覆盖里
      // 最窄的可靠形态。
      return [['todos'], ['todo', doc.id], ['schedules'], ['plans']];
    }
    case 'build': {
      const doc = ev.doc as { id: string; todoId: string };
      return [
        ['build', doc.id],
        ['steps', doc.id],
        ['todos'],
        ['todo', doc.todoId],
        ['plans', doc.id],
      ];
    }
    case 'notification':
      return [['notifications', teamId], ['chiefThreads', teamId], ['todos']];
    case 'machine_presence':
      // #1257：todo 的挂起态（等机器）派生自机器 presence——机器上下线必须
      // 连带失效 todos，否则板面挂起 chip 停在旧值直到下一次 todo 文档事件。
      return [['machines', teamId], ['todos']];
    case 'branch_sync': {
      // M7 #319（08 册附录 B）：分支对话框「同步到机器」结果落账→ team
      // stream 推回 web，按 buildId 键失效结果卡查询（pending → running
      // → synced/failed 四态）。事件载荷 = BranchSyncRecord（shared 单源，
      // `sync` 字段非 `doc`，区别于 todo/build 文档事件 [设计]）。
      const rec = ev.sync as { buildId: string };
      return [['branchSync', rec.buildId]];
    }
    default:
      return []; // ping / 未知事件
  }
}
