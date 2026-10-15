// 新建任务面隔离根（XMON-93）：dialog 的 open 态与 live 正文输入态收进本
// 叶子组件内部——此前它们经 useNewTaskSurface 住在页面组件（board /
// project / 侧栏全局面）里，开合 dialog 甚至敲一个字符都会整页同步重渲染。
// 实测（300 卡 live 看板，CDP profile）：ESC 关闭 = keydown 离散事件走
// React SyncLane，全板 300 张 TodoCard 重渲染挤成一个 ~80ms 长任务，退场
// 动画首帧即掉——这就是「ESC 退出卡顿」的根因。隔离后开关/输入只重渲染
// 本叶子（dialog 子树），看板零重渲染。
//
// 页面经可变 ref 取 openDialog：读 ref 不引发订阅。ref 在 effect 里每渲染
// 刷新，唯一滞后窗口 = 挂载首帧，而 opener 的最早调用点（热键/点击）远在
// 挂载之后。（#640 前此面还携带 firstAgentId 供卡片级 开始 点击瞬间取用——
// 开始入口已改直发总管编排回合，指派由总管裁定，命令面随之收窄。）

import { type RefObject, useEffect } from 'react';
import type { FixtureSet } from '../fixtures/records.js';
import { NewTaskDialog } from './new-task-dialog.js';
import { type NewTaskSurfaceOpts, useNewTaskSurface } from './use-new-task-surface.js';

/** 页面持有的命令面：开 dialog（点击时读，不订阅）。 */
export interface NewTaskSurfaceApi {
  openDialog: () => void;
}

interface NewTaskSurfaceRootProps {
  fixture: FixtureSet;
  /** useNewTaskSurface 的差异参数位（eager / onFixtureSave / anchorProjectId
   *  / mentions / fixtureTodos），语义与原 hook 调用点逐字一致。 */
  opts?: NewTaskSurfaceOpts;
  apiRef: RefObject<NewTaskSurfaceApi | null>;
}

export function NewTaskSurfaceRoot({ fixture, opts, apiRef }: NewTaskSurfaceRootProps) {
  const { openDialog, dialogProps } = useNewTaskSurface(fixture, opts);
  // 无依赖数组 = 每渲染刷新（openDialog 恒定）；不做 cleanup——各消费点持
  // 各自 ref，路由切换的新旧两实例写的是不同对象，无跨面串扰。
  useEffect(() => {
    apiRef.current = { openDialog };
  });
  return <NewTaskDialog {...dialogProps} />;
}
