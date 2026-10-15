// Drag overlay face (#616, 对齐 todos.dev 2026-10-02 live 实测): the lifted
// clone is NOT the board card — the reference mounts a purpose-built compact
// card (identity row + 2-line clamped title, no bottom row: agent avatar /
// rel-time / metrics / action button all stay out of the flight face).
// Geometry from the captured overlay DOM: 14px/3px project tile with a 7px
// initial, 11px project name (flex-1, truncated), 10px tabular seq, title at
// text-sm medium leading-snug clamped to 2 lines; padding 10px 12px, gap 6px,
// 方角 + 1px --border-default 实描边, bg --card-bg.
// #616 抬升态配方（原 board.css .board-drag-card，#943 迁工具类）：2° 倾角 +
// 0.92 不透明度 + 宽软影（--drag-shadow）。参考站把整套配方写在 overlay 根的
// 内联 style 上（rotate 与 translate 同一 transform）；这里 translate 归
// dnd-kit 的 fixed wrapper，倾角/影/透明度落在本卡上——合成结果逐像素同形。
// #391 的 --lift-shadow 四边墨配方随正典更替退役（值与理由见 tokens.css
// --drag-shadow 注释）。

import { PROJECT_INITIAL, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { ProjectAvatar } from './project-avatar.js';

interface DragCardProps {
  todo: TodoRecord;
  /** M5 live：项目 chip 真名（板面卡同位透传）；缺省 = capture canon 常量。 */
  projectName?: string;
}

export function DragCard({ todo, projectName }: DragCardProps) {
  const name = projectName ?? PROJECT_NAME;
  const initial = projectName ? projectName.charAt(0).toLowerCase() : PROJECT_INITIAL;
  return (
    <div
      /* #1054 清点：拖拽克隆镜像 todo-card 的卡族几何（rounded-2xl = 18px，
         2026-10-12 dsh 对齐随卡面同升）。 */
      className="board-drag-card flex flex-col gap-1.5 rounded-(--radius-panel) border border-(--border) bg-(--card) py-2.5 px-3 opacity-[0.92] rotate-2 [box-shadow:var(--drag-shadow)]"
      data-todo-id={todo.id}
    >
      <div className="flex items-center gap-1.5">
        {/* 身份行项目徽标 = ProjectAvatar 的紧凑档（参考站 14px/3px 圆角/
            7px 字号，对 16px/4px/10px 的板面档）——原 board.css 的后代
            选择器覆写，#943 起走 className 逐组覆写（TagChip row-flush
            档同手法）。 */}
        <ProjectAvatar
          char={initial}
          className="size-3.5 rounded-[3px] text-[7px] leading-[14px]"
        />
        <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground">
          {name}
        </span>
        <span className="flex-none text-[10px] leading-4 text-muted-foreground/70 tabular-nums">
          #{todo.seqNum}
        </span>
      </div>
      <div className="line-clamp-2 text-sm leading-snug font-medium text-card-foreground">
        {todo.title}
      </div>
    </div>
  );
}
