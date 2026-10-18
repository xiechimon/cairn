// Shared row parts of the resource surfaces (issue #69): the icon tile
// (20px small / 28px large / 48px empty-state hero, r7 06–10 probes), the
// gray status pill (`未启用`), the row-end chevron and the empty-state
// block (hero tile + heading + description + primary action + optional
// 总管 hint, layout probed from r7 10, copy from r2 §6; the captured
// 查看文档 link is gone — #307 wontfix, local-first 无文档站).
// #423 第一片真域收编（#422 裁决 a）：卡片系落 components/ui Card 底座 +
// 本文件的域内列表行卡组合件（RowCard / GroupCard）；StatusPill 骑 Badge；
// EmptyState 落 Empty 底座 + components/ui Button（default 档）。
// #1005 registry 对齐（#980 裁决②④、ADR 0012）：件皮肤回归 registry 默认
// ——Card 自带 rounded-xl/ring-1/bg-card（CARD_SKIN_CLS 灭皮配方退役），
// Badge/Empty 走默认档与官方 compound（EmptyHeader/Media/Title/Description/
// Content）；消费点只保留 layout（行高/间距/外边距）与 token 层墨色。

import { cn } from 'cn';
import { Plus } from 'lucide-react';
import type { ComponentProps, ComponentType, ReactNode, SVGProps } from 'react';
import { Link, useLocation } from 'react-router';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia } from '../components/ui/empty.js';
import { useI18n } from '../i18n/provider.js';
import type { TVars } from '../i18n/translate.js';
import { ChevronRight, Lock } from '../icons/index.js';

/* ---- 搜索 + 排序行（#306/#854 家族）----
   正本原住 resources.css（.res-searchrow 族），清零后配方以 utility 常量
   单源在此。#1005 registry 对齐：资源域消费点（skills-page 搜索/排序）与
   agent-detail 记忆 tab（#1006/#1007）都已迁 registry 件默认形（InputGroup /
   DropdownMenu 官方皮肤）；手写盒形/盘形/行形常量（RES_SEARCH_BOX /
   RES_SEARCH_INPUT / RES_SORT_TRIGGER / RES_SORT_MENU / RES_SORT_ROW /
   RES_SORT_WRAP）随最后一个消费点迁完删除（#1054 消费点方角清点执行，
   台账见 docs/spec/27）。行容器是纯 layout，留守。 */

/** Top bar `+ 新建` of the resource pages: the ink primary button.
 *  data-testid="resource-new" is the hit-test probe handle (title-band-clicks). */
export function ResourceNewButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Button className={TOPBAR_PRIMARY_BUTTON} onClick={onClick} data-testid="resource-new">
      <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
      {t('新建')}
    </Button>
  );
}

/** 搜索 + 排序的工具行容器（纯 layout，两域共用）。 */
export const RES_SEARCH_ROW_CLS = 'flex gap-2';

/* ---- 行卡与行内文字族 ---- */

/** Icon tile: tinted rounded square carrying the row glyph. 几何 = r7
 *  06–10 实测（20/28/48px，圆角 6/8/12px——阶梯外一次性尺寸，§3.1(a)）。
 *  tone 只有一个值（orange——原 .res-tile--orange 唯一族），皮肤直接内联，
 *  prop 保留是 API 形状不动（消费点仍显式声明色调）。 */
export function Tile({
  Icon,
  size,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  size: 'sm' | 'lg' | 'hero';
  tone: 'orange';
}) {
  const glyph = size === 'sm' ? 12 : size === 'lg' ? 16 : 26;
  return (
    <span
      className={cn(
        'flex flex-none items-center justify-center rounded-[6px] bg-(--tile-orange-bg) text-(--tile-orange-fg)',
        size === 'sm' && 'size-5',
        size === 'lg' && 'size-7 rounded-[8px]',
        size === 'hero' && 'size-12 rounded-[12px] bg-(--tile-hero-bg)',
      )}
    >
      <Icon width={glyph} height={glyph} />
    </span>
  );
}

/** 域内列表行卡组合件：单行卡（skills / secrets / mcp 行，64/62px）。
 *  皮肤 = Card 件 registry 默认（rounded-xl / ring-1 / bg-card，#1005 裁决④
 *  官方几何赢）；本件只补 layout（行高、行内 gap、横垫）。
 *  onOpen（XMON-114 技能行开编辑弹窗）：整行可点——role=button + 键盘
 *  Enter/Space 同律；focus 环由 app.css 的 #388 全局 :where([role=button])
 *  规则承载，无需就地补钉。
 *  data-testid="resource-row"（+ mcp 档 data-mcp）= #910 二级结构载体：
 *  行卡无 role（静态行），计数/文本断言的锚。 */
export function RowCard({
  mcp = false,
  className,
  onOpen,
  children,
}: {
  /** mcp 行 62px 高变体（r7 09 实测）。 */
  mcp?: boolean;
  className?: string;
  /** 整行点击（打开编辑面）；缺省 = 静态行（secrets/mcp 现状）。 */
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      data-testid="resource-row"
      {...(mcp ? { 'data-mcp': '' } : {})}
      className={cn(
        'mt-4 h-16 flex-row items-center gap-3 rounded-(--cds-radius-2xl) px-4 py-0 shadow-none',
        mcp && 'h-[62px]',
        onOpen !== undefined && 'cursor-pointer',
        className,
      )}
      role={onOpen !== undefined ? 'button' : undefined}
      tabIndex={onOpen !== undefined ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen !== undefined
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      {children}
    </Card>
  );
}

/** 域内列表行卡组合件：分组卡（machines / providers 模型行容器）；行本体
 *  是卡内结构 div，分隔线走 RowGrow 的 divided 档。皮肤 = Card 件 registry
 *  默认；行满幅贴边，件默认纵向垫/gap 归零（layout）。data-testid =
 *  #910 二级结构载体（分组卡无 role，几何/计数断言的锚）。 */
export function GroupCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Card
      data-testid="resource-group"
      className={cn('gap-0 rounded-(--cds-radius-2xl) py-0 shadow-none', className)}
    >
      {children}
    </Card>
  );
}

/** 分组卡内行（原 .res-grow，60px；divided = 59px + 上分隔线，行高补偿
 *  1px 边框，卡总高不漂）。data-divided = 分隔行的状态载体（#910 裁定 3：
 *  状态断言载体走 data-*，原 --divided 修饰类退役）。 */
export function RowGrow({
  divided = false,
  className,
  children,
  ...rest
}: {
  divided?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<'div'>, 'className' | 'children'>) {
  return (
    <div
      {...(divided ? { 'data-divided': '' } : {})}
      className={cn(
        'flex items-center gap-3 px-4',
        divided ? 'h-[calc(var(--row-h)-1px)] border-t border-(--border)' : 'h-(--row-h)',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 行文字列（与 tile 的间距由行容器的 gap-3 承载；模型行等零间距面由
 *  消费点经 className 调档，tailwind-merge 收口）。 */
export function RowText({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('flex min-w-0 flex-col', className)}>{children}</span>;
}

/** 行内标题线（标题 + dot/tag 的横排）。 */
export function RowLine({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('flex items-center gap-2', className)}>{children}</span>;
}

/** 行标题（14/20，primary 墨，不换行）。 */
export function RowTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('whitespace-nowrap text-sm leading-5 text-(--foreground)', className)}>
      {children}
    </span>
  );
}

/** 12px dim 副行（machine/mcp/provider 行，r7 ink bands 实测 16px 行盒）；
 *  strong 档 = 技能/密钥卡描述的 13px 次级墨（20px 行盒）。 */
export function RowDesc({
  strong = false,
  className,
  children,
}: {
  strong?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'truncate text-xs leading-4 text-(--text-tertiary)',
        strong && 'text-[13px] leading-5 text-(--text-secondary)',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 行内 kind 注记（mcp 行类型标签，12px tertiary——原 dim 档实测不过
 *  4.5，#908 裁决 2 授权消费面换槽）。 */
export function RowKind({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('text-xs leading-4 text-(--text-tertiary)', className)}>{children}</span>
  );
}

/** 行右缘相对时间（mcp 行，12px dim，margin-left auto 撑到行尾）。 */
export function RowAgo({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('ml-auto text-xs leading-4 text-(--text-tertiary)', className)}>
      {children}
    </span>
  );
}

/** Right-side status pill (`未启用`, r7 06/07)。Badge 底座（#422）；
 *  #1005 registry 对齐：皮肤 = Badge secondary 默认档（h-5 圆角 pill /
 *  text-xs / secondary 墨对），只保留 ml-auto 行末 layout。 */
export function StatusPill({ label }: { label: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="secondary" className="ml-auto">
      {t(label)}
    </Badge>
  );
}

/** Row-end `>` chevron (r7 06–10 row right edge). */
export function RowChevron() {
  return (
    <span className="ml-auto flex text-(--text-tertiary)">
      <ChevronRight width={13} height={13} />
    </span>
  );
}

/** 在线状态点（machine 行 r7 06）：在线 --col-dot-done / 离线
 *  --col-dot-idle（与 overlay 的 new-task-machine-dot 同族同值；灰点只表示
 *  状态，不禁用该行——步可钉离线机器等它上线）。data-on 是状态载体
 *  （#910 裁定 3：状态断言载体走 data-*）。 */
export function OnlineDot({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        on ? 'bg-(--col-dot-done)' : 'bg-(--col-dot-idle)',
      )}
      data-on={on}
    />
  );
}

/** Empty-state block：48px hero tile + 标题 + 两行描述 + 主钮 + 可选总管
 *  hint 行（查看文档 link removed #307 — local-first 无文档站, #149
 *  schedules 同律）。spec 13（#367/#368）：actionLabel 可选——只读资源面
 *  （技能 / MCP）无主钮；description 经 descriptionVars 走 {vars} 插值
 *  （空态指路配置目录 / ~/.claude.json，单点 t()）。
 *  #1005 registry 对齐：走 Empty 官方 compound（EmptyHeader/Media/Content），
 *  居中列 + 默认间隙即 registry 形态（#980 裁决④），r7 10 的左对齐实测形由
 *  原型实审复核。标题/描述保留 h2/p 语义标签（不用 EmptyTitle/Description 的
 *  div——heading 语义是 a11y 资产，skills-page/dead-buttons spec 以
 *  getByRole('heading') 与 locator('p') 钉描述），只把 registry 件的文字档
 *  （text-sm font-medium / text-sm/relaxed muted）挂上去取齐观感。 */
export function EmptyState({
  Icon,
  title,
  description,
  descriptionVars,
  actionLabel,
  actionHref,
  onAction,
  hint,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  /** description 模板 {vars} 插值位（i18n translate 机制，issue #74）。 */
  descriptionVars?: TVars;
  /** Primary action 文案；缺省 = 无主钮（只读面，spec 13 #367/#368）。 */
  actionLabel?: string;
  /** SPA target for the primary action (issue #153); absent keeps the
   *  inert button (dialog-opening actions land in a later ticket). */
  actionHref?: string;
  /** Dialog-opening primary action (wayfinder #173): renders when
   *  `actionHref` is absent, giving the bare button its handler. */
  onAction?: () => void;
  hint?: string;
}) {
  const { t } = useI18n();
  const { search } = useLocation();
  return (
    <Empty data-testid="resource-empty" className="mt-4">
      <EmptyHeader>
        <EmptyMedia>
          <Tile Icon={Icon} size="hero" tone="orange" />
        </EmptyMedia>
        <h2 className="text-[15px] font-semibold tracking-tight text-balance text-foreground">
          {t(title)}
        </h2>
        <p className="text-sm/relaxed text-muted-foreground text-balance">
          {t(description, descriptionVars)}
        </p>
      </EmptyHeader>
      {(actionLabel != null || hint != null) && (
        <EmptyContent>
          {actionLabel != null &&
            (actionHref == null ? (
              <Button size="sm" onClick={onAction}>
                {t(actionLabel)}
              </Button>
            ) : (
              <Link to={{ pathname: actionHref, search }}>{t(actionLabel)}</Link>
            ))}
          {/* 「查看文档」钮全除（#307 wontfix）：local-first 自托管无文档站
              可链（#149 schedules 同律）——skills/secrets/mcp 空态随共享件
              一并出账，spec 08 档 4。 */}
          {hint != null && (
            <p className="flex items-center gap-[7px] text-[13px] leading-[18px] text-(--text-tertiary)">
              <Lock width={11} height={11} />
              {t(hint)}
            </p>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
