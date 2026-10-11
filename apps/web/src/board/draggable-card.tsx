// Draggable wrapper around the presentational TodoCard (#616, 对齐 todos.dev
// live 实测；前身 = #73 的 sortable-card；可拖面由 #753 扩到每列）。参考站的
// 拖拽没有列内重排：手势中兄弟卡零位移、同列落位零提交——所以 wrapper 从
// useSortable 换成 useDraggable，且**从不**把 transform 写回列表项（卡片钉在
// 原槽）。源卡淡出 0.4（参考站内联 opacity 实测值；旧 0.35 随正典更替）。
// #753（todos.dev 2026-10-03/04 live 重测）：每张卡都武装传感器——旧「待处理/
// 已完成卡不带传感器（按下直通卡内链接）」是 2026-10-02 旧测误判，已推翻；
// 参考站四列的卡按压超过阈值即进 grabbing 拖拽。点击导航仍保住：卡内
// stretched title link 的点击走 PointerSensor 的 distance 阈值（未移动的按压
// 直通链接，dnd-kit 抑制完成拖拽后的 click），#629 的原生链接拖抑制
// （draggable=false + -webkit-user-drag:none）在 todo-card.tsx 原位不动。
import { useDraggable } from '@dnd-kit/core';
import type { TagChipData } from '../components/ui/tag-chip.js';
import type { TodoRecord } from '../fixtures/records.js';
import { TodoCard } from './todo-card.js';

interface DraggableCardProps {
  todo: TodoRecord;
  now: number;
  onAction?: (todo: TodoRecord) => void;
  onBranch?: (todo: TodoRecord) => void;
  /** #828：透传 TodoCard 的无分支隐藏位。 */
  hasBranch?: boolean;
  /** M5 live：项目 chip 真名（TodoCard 透传位）。 */
  projectName?: string;
  /** #445：卡片标签行（cardTag 解析结果；null = 不渲染占位）。 */
  tag?: TagChipData | null;
  /** #1216：透传 TodoCard 的在飞编排态。 */
  orchestrating?: boolean;
}

export function DraggableCard({
  todo,
  now,
  onAction,
  onBranch,
  hasBranch,
  projectName,
  tag,
  orchestrating,
}: DraggableCardProps) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: todo.id });
  const style = { opacity: isDragging ? 0.4 : undefined };
  return (
    <div ref={setNodeRef} style={style} {...listeners}>
      <TodoCard
        todo={todo}
        now={now}
        onAction={onAction}
        onBranch={onBranch}
        hasBranch={hasBranch}
        projectName={projectName}
        tag={tag}
        orchestrating={orchestrating}
      />
    </div>
  );
}
