// 更多 menu (issue #66): popover anchored under the detail header's 更多
// button. Four items 完成 / 复制链接 / 关闭 / 删除 (+ the review-phase 请求修改
// row, #701, and the queued 停止 row, #1446); 删除 is the danger row.
// #318: 完成/关闭 接真(r1 changelog 09-16「菜单项按当前 phase 出:Complete
// 走看板自带 confirm-and-merge、Close 关闭语义」)——完成 = 相位适配动作
// (confirm 关口确认 / review 验收弹层→merge 链,调用位裁定),关闭 = 关闭
// 语义落 closed。无该相位语义的行渲染 disabled(原站按相位出项,pacman
// 保持四行恒定;运行中禁用同 r1 Delete-in-turn 先例)。r1 的
// 延迟 Undo 窗口不落地([设计] 票内裁量 wontfix:关闭即刻生效,重开走
// closed→todo reopen 面)。
//
// #1008（#983 判决：floating-shell 族拆退役，菜单族 → DropdownMenu）：
// 壳从 FloatingShell(非模态 Dialog) + 手写透明 catcher + fixed 冻结坐标
// （top-39.5/right-96.5，#366）迁 registry DropdownMenu——触发钮住 dhead、
// 菜单体住页面层，跨组件锚定走 Content 的 anchor prop（#454 dropdown-menu
// 既有透出，project-new-page 先例）。Esc / 外点关（modal 默认档 = 外点
// 不穿透，旧 ClickCatcher 同语义）/ roving focus / typeahead 全归原语；
// 行带高冻结值（40/37/41/45）、行间分隔线、描边 Arrow、--fab-shadow 手写
// 皮肤全退役，几何归 DropdownMenuItem 默认（#991 Q9 registry 默认赢）。
// 行 = DropdownMenuItem（role=menuitem 原生），删除行走 destructive 档；
// data-action 载体原样保留（e2e 行为锚），别名 more-menu / more-menu-item
// 随行透传（#411 别名优先）。

import { CircleStop } from 'lucide-react';
import type { ComponentProps } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';
import { Ban, Check, Copy, MessageSquare, Trash2 } from '../icons/index.js';

interface MoreMenuProps {
  /** #73: retained-mount open flag — the exit pop outlives the close. */
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  /** #318: 完成 = 相位适配动作(confirm/review);其余相位 disabled。 */
  onComplete: () => void;
  canComplete: boolean;
  /** #318: 关闭 = phase closed 落账;可关相位由页面层判定（canClose）。 */
  onCloseTask: () => void;
  canClose: boolean;
  /** #1446: queued 卡的停止（停掉等机器的 pending 步，卡回排队前的相位）——
   *  它没有 composer，停止钮无处可挂；缺省 = 行不渲染。 */
  onStop?: () => void;
  /** #701: 审核关口人肉打回（请求修改）——live review 静息态在场；缺省 =
   *  行不渲染（fixture 捕获面与其余相位保持四行几何，DOM 字节不变）。 */
  onReject?: () => void;
  /** #1008: 定位锚 = dhead 的 更多 钮（跨组件，页面层持 ref 双投）。类型 =
   *  Content anchor 位直通（RefObject<Element>）。 */
  anchor?: ComponentProps<typeof DropdownMenuContent>['anchor'];
}

/** 面板 layout 槽：220 宽是内容布局（行文案 + icon 节奏的捕获宽度），皮肤
 *  归 Content 默认；w-(--anchor-width) 底座被本类压掉（anchor 是 28px 钮）。 */
const PANEL_CLS = 'more-menu w-[220px]';

export function MoreMenu({
  open,
  onClose,
  onDelete,
  onComplete,
  canComplete,
  onCloseTask,
  canClose,
  onStop,
  onReject,
  anchor,
}: MoreMenuProps) {
  const { t } = useI18n();
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    onClose();
  };
  // #701 五行面：打回行插在 完成 之后（行序 = 渲染序，旧 :has + nth-child
  // 的 JSX 等价形）；delete 恒 destructive 档。
  const rows = [
    {
      key: 'complete',
      label: t('完成'),
      Icon: Check,
      disabled: !canComplete,
      onClick: onComplete,
    },
    ...(onReject !== undefined
      ? [
          {
            key: 'reject',
            label: t('请求修改'),
            Icon: MessageSquare,
            action: 'reject',
            disabled: false,
            onClick: onReject,
          },
        ]
      : []),
    ...(onStop !== undefined
      ? [
          {
            key: 'stop',
            label: t('停止'),
            Icon: CircleStop,
            action: 'stop',
            disabled: false,
            onClick: onStop,
          },
        ]
      : []),
    {
      key: 'copy',
      label: t('复制链接'),
      Icon: Copy,
      disabled: false,
      onClick: copyLink,
    },
    {
      key: 'close',
      label: t('关闭'),
      Icon: Ban,
      disabled: !canClose,
      onClick: onCloseTask,
    },
    {
      key: 'delete',
      label: t('删除'),
      Icon: Trash2,
      action: 'delete',
      disabled: false,
      danger: true,
      onClick: onDelete,
    },
  ];
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DropdownMenuContent
        anchor={anchor}
        align="end"
        side="bottom"
        sideOffset={4}
        aria-label={t('更多')}
        className={PANEL_CLS}
      >
        {rows.map((row) => [
          row.danger === true && <DropdownMenuSeparator key={`${row.key}-sep`} />,
          <DropdownMenuItem
            key={row.key}
            variant={row.danger === true ? 'destructive' : 'default'}
            className="more-menu-item"
            {...('action' in row ? { 'data-action': row.action } : {})}
            disabled={row.disabled}
            onClick={row.onClick}
          >
            <row.Icon />
            {row.label}
          </DropdownMenuItem>,
        ])}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
