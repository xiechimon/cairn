// Board todo card（V2 骨架，base-ui-theme §1.1）：Card 承载
// 盒型（bg-card/ring 1px）。2026-10-12 用户派「看板卡对齐 deepseek-harness
// 对话框观感」：几何升一档圆角（rounded-2xl = 18px，dsh 卡件档 16-20 区间）、
// 静止吃 --card-lift 微抬升投影（dsh elevation 柔光律）；hover 微染 / 入场
// 浮入 / superellipse 面形三件套在 motion.css / app.css 的承载层。
// 行为与锚点原位：stretched title link、data-todo-id、
// todo-card/todo-card-action--* 类别名、相对时间、phase 徽标全部保留；
// 宽度随 #351 的四列流体网格铺满列宽。
// 阶段点与徽标的语义色（蓝/琥珀/绿/灰）不随 B 换——它们承载 phase 语义，
// 不是中性表面；全面 chart 化留待铺开期裁决。

import { Link, useLocation } from 'react-router';
import { useAgentAvatarUrlById } from '../api/provider.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { TagChip, type TagChipData } from '../components/ui/tag-chip.js';
import { PROJECT_INITIAL, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  CheckWhite,
  FileText,
  GitBranch,
  GitCommit,
  SearchWhite,
  UserCircle,
} from '../icons/index.js';
import { cardAction } from './columns.js';
import { ProjectAvatar } from './project-avatar.js';
import { relativeTime } from './rel-time.js';

interface TodoCardProps {
  todo: TodoRecord;
  now: number;
  /** Card action button (确认/完成/回复); the page decides what it does
   *  (issue #68: review-phase 完成 opens the accept dialog). */
  onAction?: (todo: TodoRecord) => void;
  /** Card branch icon (issue #68): opens the 分支与 PR dialog. */
  onBranch?: (todo: TodoRecord) => void;
  /** #828: false = 无分支的卡不渲染分支钮（旧下载箭头 glyph 误导 + 无
   *  内容卡的点击零响应；缺省 true 保持调用方行为不变）。 */
  hasBranch?: boolean;
  /** M5 live：项目 chip 真名（fixture.projectNames 位）；缺省 = capture
   *  canon 常量（r7 22 `r3-lifecycle`）。 */
  projectName?: string;
  /** #445：卡片标签行（cardTag 解析结果，每卡至多 1 = 渲染上限）；
   *  null/缺省 = 不渲染占位——无标签卡几何与 r7 基线零漂移。 */
  tag?: TagChipData | null;
  /** #1216：该卡有一轮总管编排在飞（live 派生态，orchestration-inflight.ts
   *  单源）——开始/重试 钮位改渲染禁用「编排中」：编排回合落位不写相位
   *  （#640），click→chief 派发之间卡片此前零在飞标识、钮还照亮，实测用户
   *  连点出重复线程。缺省 false = fixture 面与既有 live 卡零变化。 */
  orchestrating?: boolean;
}

/** Badge on the agent avatar: amber magnifier while the run is waiting on
 *  the user (待确认 02 #9, 待验收 33 #9, 等待回复 01 #1), green check once
 *  done (r7 01b #2, 35 #9). Fresh cards carry a gray idle badge with the
 *  same magnifier glyph (r7 22/22d — badge shape pixel-matches the amber
 *  one at gray #9ea3ae). */
function badgeFor(todo: TodoRecord): 'idle' | 'attention' | 'done' | 'failed' | null {
  if (todo.phase === 'done') return 'done';
  // r8 55: the failed card's avatar carries the red `!` badge
  if (todo.phase === 'failed') return 'failed';
  if (todo.phase === 'confirm' || todo.phase === 'review' || todo.awaitingReply === true) {
    return 'attention';
  }
  if (todo.phase === 'todo' || todo.phase === 'queued') return 'idle';
  return null;
}

export function TodoCard({
  todo,
  now,
  onAction,
  onBranch,
  hasBranch = true,
  projectName,
  tag,
  orchestrating = false,
}: TodoCardProps) {
  // XMON-105: executor avatar override join (same identity as team page).
  const agentAvatarUrl = useAgentAvatarUrlById();
  const chipName = projectName ?? PROJECT_NAME;
  const chipInitial = projectName ? projectName.charAt(0).toLowerCase() : PROJECT_INITIAL;
  const { t } = useI18n();
  const action = cardAction(todo);
  const badge = badgeFor(todo);
  const fresh = badge === 'idle';
  const { search } = useLocation();
  return (
    /* #629 卡面选中封锁（参考站 2026-10-02 实测：卡根 user-select: none、
       卡内零 <a>——点击是 Pressable 行为，无原生链接可拖）。select-none 原
       住 board.css .todo-card 规则，#943 随文件清零迁到件上；配对的第二锁
       （标题链接 -webkit-user-drag）在下方 Link。 */
    <Card
      data-todo-id={todo.id}
      className="todo-card relative w-full gap-0 rounded-2xl px-[13.5px] pt-[9.5px] pb-[11.5px] shadow-(--card-lift) select-none"
    >
      <div className="flex min-h-4 items-center">
        <ProjectAvatar char={chipInitial} />
        <span className="ml-1 truncate text-[11px] leading-4 text-muted-foreground">
          {chipName}
        </span>
        {/* #445 卡片标签 chip：首行项目名之后（身份行语义位）。#1006 R5
            实审裁决（用户 2026-10-08，与 L1 裁决①一致）：row-flush 16px
            消费点覆写收编 registry Badge 默认 20px——两尺寸不并存（#980
            前提④几何 registry 默认赢）。行盒 h-4 → min-h-4：无 chip 卡
            保持 16px 节奏，有 chip 卡随行内容长到 20（回流由本域探针
            重钉）。todo-card-tag = e2e 别名。 */}
        {tag != null && <TagChip tag={tag} className="todo-card-tag ml-1 flex-none" />}
        <span className="todo-card-seq mr-[13px] ml-auto flex-none text-[11px] leading-4 text-muted-foreground/70">
          #{todo.seqNum}
        </span>
        {onBranch != null && hasBranch && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="todo-card-branch relative z-10 -mr-[1.5px] h-4 w-[13px] text-muted-foreground"
            aria-label={t('分支与 PR')}
            onClick={() => onBranch?.(todo)}
          >
            <GitBranch className="size-[13px]" />
          </Button>
        )}
      </div>

      <h3 className="todo-card-title mt-1 wrap-break-word text-sm leading-5 font-medium text-card-foreground">
        <Link
          /* #629 双锁之二/三（本仓卡面是 stretched link，参考站无 <a>）：
             不可拖列（待处理/已完成，#616 传感器不武装）按住微移会命中
             <a href> 的缺省可拖性，触发原生 link drag——Chrome 的拖影 chip
             （链接文本 + URL）即用户报的「偶尔出现一个小链接」。
             [-webkit-user-drag:none] 是 webkit 生效位（原 board.css
             .todo-card-link 规则，#943 迁工具类），draggable={false} 是
             标准属性位第三锁；选中高亮由卡根 select-none 绝迹。 */
          className="todo-card-link text-inherit no-underline after:absolute after:inset-0 after:content-[''] [-webkit-user-drag:none]"
          to={{ pathname: `/app/todo/${todo.id}`, search }}
          draggable={false}
        >
          {todo.title}
        </Link>
      </h3>

      <div className="mt-[7.5px] flex h-[26px] items-center">
        <span className="todo-agent-avatar relative size-5 flex-none [&_img]:block [&_img]:size-5">
          {fresh ? (
            // owner placeholder while no agent run exists (r7 22/22d)
            <UserCircle width={20} height={20} className="text-muted-foreground/70" />
          ) : (
            // #387: 执行者头像按 agent displayName 种子生成;未指派退静态资产
            <SeededAvatar
              className="size-5"
              name={todo.agent?.displayName}
              src={todo.agent ? (agentAvatarUrl.get(todo.agent.id) ?? null) : null}
              fallback="/avatar-robot-1.svg"
            />
          )}
          {badge != null && (
            <span
              aria-hidden={badge === 'failed' ? true : undefined}
              className={`todo-agent-badge--${badge} absolute -top-[2px] -right-1 flex size-[9px] items-center justify-center rounded-full text-[8px] leading-none font-bold ${
                badge === 'idle'
                  ? 'bg-(--badge-idle)'
                  : badge === 'attention'
                    ? 'bg-(--badge-attention)'
                    : badge === 'done'
                      ? 'bg-(--badge-done)'
                      : 'bg-(--destructive) text-white'
              }`}
            >
              {badge === 'failed' ? (
                '!'
              ) : badge === 'done' ? (
                <CheckWhite width={9} height={9} />
              ) : (
                <SearchWhite width={9} height={9} />
              )}
            </span>
          )}
        </span>
        <span className="relative top-[1.5px] ml-[7px] text-[11px] leading-4 text-muted-foreground">
          {relativeTime(todo.phaseAt, now, t)}
        </span>
        {/* #640 / r14 §5.4：总管建卡芯片（参考站 11-todo12-card-zoom 同构，
            判定位 = chiefCreated ← wire sourceBuildId）。row-flush 16px 档
            随 todo-card-tag 同律（26px 底行不溢出行盒）；中性描边 pill，
            不与 tag 的数据色 chip 抢墨。 */}
        {todo.chiefCreated === true && (
          <Badge
            variant="outline"
            className="ml-[10.5px] h-4 flex-none rounded-4xl border-border px-1.5 py-0 text-[10px] leading-none font-normal text-muted-foreground"
          >
            {t('由总管创建')}
          </Badge>
        )}
        {todo.hasPlan && (
          <span
            className="ml-[10.5px] flex flex-none items-center text-muted-foreground"
            role="img"
            aria-label={t('方案')}
          >
            <FileText />
          </span>
        )}
        {todo.hasChanges && (
          <span
            className={`flex flex-none items-center text-muted-foreground ${todo.hasPlan ? 'ml-[2px]' : 'ml-[10.5px]'}`}
            role="img"
            aria-label={t('变更')}
          >
            <GitCommit />
          </span>
        )}
        <span className="flex-1" />
        {action != null &&
          (orchestrating && (todo.phase === 'todo' || todo.phase === 'failed') ? (
            // #1216 在飞编排态：钮位不禁用会被连点成重复编排线程——禁用 +
            // 「编排中」把 click→chief 派发的静默窗口显性化（相位不动，#640）。
            <Button
              variant={action.kind === 'primary' ? 'default' : 'outline'}
              size="xs"
              className="todo-card-action relative z-10 h-[26px] flex-none px-[7.25px] text-xs"
              data-orchestrating="true"
              disabled
            >
              {t('编排中')}
            </Button>
          ) : (
            <Button
              variant={action.kind === 'primary' ? 'default' : 'outline'}
              size="xs"
              className={`todo-card-action todo-card-action--${action.kind} relative z-10 h-[26px] flex-none px-[7.25px] text-xs`}
              onClick={() => onAction?.(todo)}
            >
              {t(action.label)}
            </Button>
          ))}
      </div>
    </Card>
  );
}
