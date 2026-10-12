// Detail header (issue #56, r7 §3.3): back button, #seq, status chip, the
// 更多 icon and the 50.5×28 primary button. #366 stripped the centered
// 文档|聊天 tab group (the route is a 3-pane layout now) and the
// 分支与 PR/Token 用量/运行历史 icon trio (static right-pane sections).
// #58: the back button carries the current search string home so the
// dev/fixture ?scenario= selection survives the round trip; the board
// scroll position is restored by BoardSurface from sessionStorage.
// #67: the chip is a real button — it toggles the status popover (r7
// 19/29), and the chevron rides outside the pill (r7 17 measure).

import { type Ref, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { StatusChip } from '../components/ui/status-chip.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, ChevronLeft, EllipsisVertical } from '../icons/index.js';
import { ChipPopover } from '../overlays/chip-popover.js';
import { PHASE_UI } from '../phase.js';

/** #945（#942 正典表 §5.2 C1）：头 chip 从老 ui/chip 原语迁 StatusChip
 *  适配件（Badge 骨架 + 五对 --chip-* token utility 皮肤；default 档 h-5，
 *  替旧 md 18px——D2 授权几何）。状态载体 = data-tone（件自带）；
 *  detail-chip--<tone> 别名退役（全库零 spec 消费，grep 复核 @ 034bf7d5）。
 *  触发面 .detail-chip 类名保留（detail-b 的 reject-chain/review-reject 与
 *  integration m5/web-plans 按它定位；重钉归各自批次），皮肤迁 utilities。 */

// 头带 44px（43 + 1px 缝线，r7 §3.1）是 layout 位。#1006 原型（#980
// 前提④ registry 默认赢）：r7 §3.3 冻结几何（主钮 50.5×28 @12px、icon 钮
// 28×28 透明底）与 ghost 七通道中和串退役——icon 钮 = registry ghost
// icon-sm 档（28×28 + hover:bg-muted 反馈），主钮 = default 档默认几何，
// chevron/图标吃底座 [&_svg]:size-4 律。

interface DetailHeadProps {
  todo: TodoRecord;
  /** Rendered phase; the reject chain overrides the record's phase
   *  (replan streaming / building rounds, issue #75). */
  phase?: TodoRecord['phase'];
  /** #66: opens the 更多 menu popover. */
  onMore?: () => void;
  /** Primary button (开始/确认/完成/重开/重跑); the page decides what it
   *  does — the reject chain's 确认 step, the failed 重跑 dialog (#75). */
  onAction: () => void;
  /** Scenario-frozen initial open state of the chip popover (#67). */
  chipPopoverOpen?: boolean;
  /** #209: chip popover「编辑分配」入口——关 popover 后由页层开 agent 选择
   *  弹层(弹层挂页层:popover 关即卸载,挂内层会被带走)。 */
  onEditAssign?: () => void;
  /** M7 #312 / r8 §3.1：审核中态旗标——chip 改「审核中」、composer placeholder
   * 改「AI 审核进行中…」、期间显示停止钮（复用 #308）。 */
  reviewActive?: boolean;
  /** #1250 / ADR 0018 层 1：验证中态旗标——chip 改「验证中」（reviewActive
   *  同律：额外 agent 步，phase 不动）。verify 优先于 review 显示（同刻
   *  并行时验证是更晚的相位事实）。 */
  verifyActive?: boolean;
  /** #1216：在飞编排回合（todo 开始 / failed 重跑 已发出，chief 尚未落位）
   *  ——主钮翻禁用「编排中」，相位不动的静默窗口显性化。缺省 false =
   *  fixture 面与既有行为零变化。 */
  actionInFlight?: boolean;
  /** #1008: 更多 钮的定位锚 ref（MoreMenu 迁 DropdownMenu 后触发钮与菜单体
   *  分住两层，页面层持 ref 双投：这里挂到钮上，Content 走 anchor）。 */
  moreButtonRef?: Ref<HTMLButtonElement>;
}

export function DetailHead({
  todo,
  phase,
  onMore,
  onAction,
  chipPopoverOpen,
  onEditAssign,
  reviewActive,
  verifyActive,
  actionInFlight,
  moreButtonRef,
}: DetailHeadProps) {
  const { t } = useI18n();
  // AI 审核中态（M7 #312，r8 §3.1）：chip 文案与 phase 解耦——「审核中」字面
  // 反映活动步 kind 而非 phase（review 步是额外 agent 步，phase 留 confirm/
  // review）。tone 用 confirm（同色与待确认期一致，不引入新色）。#1250
  // 验证中态同位覆盖（verify 优先）。
  const ui = verifyActive
    ? { ...PHASE_UI[phase ?? todo.phase], chip: '验证中' }
    : reviewActive
      ? { ...PHASE_UI[phase ?? todo.phase], chip: '审核中' }
      : PHASE_UI[phase ?? todo.phase];
  const { search } = useLocation();
  const [popover, setPopover] = useState(chipPopoverOpen === true);
  return (
    <header
      className="detail-head relative flex h-11 flex-none items-center border-b border-(--border) pl-3"
      data-testid="detail-head"
    >
      {/* #1006 原型：返回钮 = registry ghost icon-sm 档经 render prop 落
          router Link（Base UI useRender 组合，锚语义/中键/新标签行为保留；
          .detail-back 别名透传）。 */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="flex-none"
        render={<Link to={{ pathname: '/app', search }} />}
        aria-label={t('返回')}
      >
        <ChevronLeft />
      </Button>
      <span className="ml-1 flex-none text-xs leading-4 text-(--text-tertiary)">
        #{todo.seqNum}
      </span>
      {/* #949：chipwrap 定位类随 overlays.css 清零退役（relative flex
          items-center 等值 utility）。 */}
      <span className="relative flex items-center">
        {/* #1006 原型（#980 前提④）：触发钮皮肤——七通道中和串退役，
            ghost 底座的 hover:bg-muted / aria-expanded:bg-muted 反馈生效
            （registry 默认赢），只留 layout 位（h-auto 随 chip 内容、gap-0
            保 chevron 5px 左距为唯一间距、p-0.5 给 hover 盒留呼吸）。
            #951：detail-b 两 spec 重钉到 phase-chip testid；detail-chip
            基类保留至执行域退役（chip-assign/chip-hotzone/integration m5
            按它定位）。 */}
        {/* #1008（#983 判决：floating-shell 族拆退役，锚定 absolute 族 →
            registry Popover）：chip 钮 = PopoverTrigger（toggle/aria-expanded
            归原语，#666 双写 state 竞态的根因随之消失）；定位归 Positioner
            参数（side=bottom align=start alignOffset=-18 sideOffset=8 =
            原「chip 左缘 −18、底缘 +8」捕获几何）。initialFocus=false 保
            #666 键盘契约（焦点留触发钮，同一个键再按一次关面）；外点关走
            原生 outside-press（实审裁决 1：接受穿透）。#634: chevron 在
            触发钮内——整只 chip 一个热区。 */}
        <Popover open={popover} onOpenChange={setPopover}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                data-testid="phase-chip"
                className="detail-chip ml-2 h-auto flex-none gap-0 p-0.5"
              />
            }
          >
            <StatusChip tone={ui.tone} className="shrink-0 whitespace-nowrap">
              {t(ui.chip)}
            </StatusChip>
            {/* #949: chevron 皮肤等值迁 utility。testid = 二级载体
                （chip-hotzone 的 H1 热区钉扎位，#910 裁定 1）。 */}
            <span
              className="ml-[5px] flex flex-none text-(--text-tertiary)"
              data-testid="chip-chevron"
            >
              <ChevronDown width={12} height={12} />
            </span>
          </PopoverTrigger>
          {/* 298 宽 = 捕获设计的内容 layout 槽（#983 宽度归消费点判例）；
              皮肤/圆角/描边/投影/Arrow 归 PopoverContent 默认（#991 Q9）。 */}
          <PopoverContent
            side="bottom"
            align="start"
            alignOffset={-18}
            sideOffset={8}
            initialFocus={false}
            aria-label={t('任务分配')}
            className="w-[298px]"
          >
            <ChipPopover
              todo={todo}
              onEditAssign={
                onEditAssign == null
                  ? undefined
                  : () => {
                      // 先关 popover 再开弹层:两 overlay 不叠(家族律单实例)。
                      setPopover(false);
                      onEditAssign();
                    }
              }
            />
          </PopoverContent>
        </Popover>
      </span>

      {/* XMON-55 P1: the head carries the task subject. Without it the only
          way to tell which task the page belongs to was to read the thread's
          taskline — the head showed an id and a status word and nothing to
          attach them to. Ellipsised, never wrapped: the head is a fixed 44px
          band. */}
      <span
        className="ml-3.5 min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold text-(--foreground)"
        title={todo.title}
        data-testid="detail-title"
      >
        {todo.title}
      </span>

      <div
        className="ml-3 flex flex-none items-center gap-1.5 pr-3"
        data-testid="detail-head-actions"
      >
        {/* XMON-24 更多钮 shadcn ghost 底座；#1006 原型：registry ghost
            icon-sm 档默认形态（hover 反馈生效、svg 吃底座 size-4 律）。
            --more 别名保留（8 处 spec 钉）。 */}
        <Button
          variant="ghost"
          ref={moreButtonRef}
          size="icon-sm"
          className="detail-head-icon--more flex-none"
          aria-label={t('更多')}
          onClick={onMore}
        >
          <EllipsisVertical />
        </Button>
        {ui.action != null &&
          (actionInFlight === true ? (
            // #1216 在飞编排态：主钮禁用 +「编排中」——重入点击此前会静默
            // 多发一轮编排线程（生产实测同卡 3–5 条），拒绝反馈住
            // use-orchestrate-start 的 toast 位。
            <Button className="detail-head-action flex-none" data-orchestrating="true" disabled>
              {t('编排中')}
            </Button>
          ) : (
            // #1006 原型（#980 前提④）：主钮 50.5×28 @12px 冻结几何退役——
            // registry Button default 档默认几何（h-8 text-sm font-medium）。
            <Button className="detail-head-action flex-none" onClick={onAction}>
              {t(ui.action)}
            </Button>
          ))}
      </div>
    </header>
  );
}
