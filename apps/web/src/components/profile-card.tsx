// 个人页模板（XMON-117）：一张卡 + 头像头 + 行式字段。正本来源是
// `/app/account`（r7 13 逐像素探测的原件形态），抽出来给 agent 资料页
// 复刻同一套模板用。
//
// 为什么是组合件而不是 registry 原语：这不是通用盒子，是**一种页面排版**——
// label 在哪、值槽怎么对齐、行怎么分隔都是模板的一部分。抽成组件后两页不再
// 各写一遍行结构。
//
// 分层（XMON-117 × XMON-104；#983 panel→Card 判决执行）：卡盒的**皮肤**不在
// 这里实现——ProfileCard 的根元素就是 components/ui/card.tsx 的 registry
// `Card`（bg-card + ring-1 + rounded-xl，默认皮肤全归件）。本件只管**排版**：
// 头像头 / 行 / label / 值槽的几何。皮肤只住 Card 一处，改描边或底色不改这里。
//
// #952（profile-card.css 退役，spec/22 §3.1）：模板几何全部改件上 token
// utility，单源在本文件的 PROFILE_* 常量。行高逐值沿用 r7 13 的探测
// （41 = 40 内高 + 1px 分隔线；名称行 49、语言行 57）；带副
// 文案的行走 auto 档（高度由内容撑开，上下各 8px 内垫，label 列封顶 60%）。
// 模板类名（profile-card/head/avatar/row/label/label-text/hint/value）原样
// 输出——components 自有件类是 e2e 直取载体（#944 provider 面判例，
// checkbox-unified.spec 头注同律）；消费点保留自己的别名类（`account-card` /
// `agent-*`）。
//
// 消费点档差走导出常量（h-[49px] 名称行 / h-[57px] 语言行 / 值槽 grow·editor
// 档），raw div 行（不走 ProfileRow 的记忆行等）用 PROFILE_ROW_AUTO_CLS 取
// 同一份行盒配方——不再有两套行几何。

import { cn } from 'cn';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { SquarePen } from '../icons/index.js';
import { Button } from './ui/button.js';
// #1031 改名编辑器（Button/Input/SquarePen）与 Card 化（panel→Card，#1005 /
// #1007 两车道同面收敛于本件）合并：皮肤只住 registry Card 一处，改名交互
// 逻辑零分叉。
import { Card } from './ui/card.js';
import { Input } from './ui/input.js';

/** 卡盒（原 .profile-card 三律）：overflow visible 保留——agent 资料页的模型
 *  菜单仍走 FloatingShell 卡内锚定（select.tsx 退役 = #1010，波 2；Popover 化
 *  后随件摘除；语言 dropdown 已随 registry DropdownMenuContent Portal 化，
 *  不受裁切影响）。圆角裁切换挂首末子件的逻辑角属性：ring-1 是 box-shadow
 *  环、不占布局位，子件逻辑角 = 卡角原值（rounded-xl = --radius-xl，无
 *  「−1px 环」内缩复算——该复算属 border 时代遗留，#983 判决作废；协调裁决
 *  2026-10-08：取更贴 registry 默认者）。用逻辑角而非 rounded-t/b 简写：
 *  单行卡的首末是同一个元素，简写会互相覆盖。gap-0/py-0 中和 Card 内距
 *  节奏——行盒自持几何。 */
const PROFILE_CARD_CLS =
  'profile-card gap-0 overflow-visible py-0 [&>:first-child]:rounded-ss-xl [&>:first-child]:rounded-se-xl [&>:last-child]:rounded-es-xl [&>:last-child]:rounded-ee-xl';

/** 行盒基底（原 .profile-row）：41 = 40 内高 + 1px 分隔线（r7 13 行界）。
 *  行自带的 border-top 是行间分隔线；做首件时上方没有行可分，那条线只会与卡
 *  的描边叠成 2px、且是直线不吃圆角——first: 档摘掉。 */
const PROFILE_ROW_CLS =
  'profile-row flex h-[41px] items-center justify-between gap-4 border-t border-border bg-secondary px-4 first:border-t-0';

/** 带副文案的行（原 .profile-row--auto）：高度随内容（label 列两行时行自然
 *  变高），上下 8px 内垫保住行与行的呼吸，与固定档的 41/49/57 同一节奏。
 *  raw div 消费面（agent 记忆行 / 权限空态行）与 ProfileRow 的 hint 档共用
 *  本配方。 */
export const PROFILE_ROW_AUTO_CLS =
  'profile-row flex h-auto min-h-[41px] items-center justify-between gap-4 border-t border-border bg-secondary px-4 py-2 first:border-t-0';

/** 名称行档（原 .profile-row--name，r7 13 探测 49）。 */
export const PROFILE_ROW_NAME_CLS = 'h-[49px]';

/** 语言行档（原 .profile-row--tall，r7 13 探测 57）。 */
export const PROFILE_ROW_TALL_CLS = 'h-[57px]';

/** 副文案律（原 .profile-hint）：registry 词汇 text-xs + muted-foreground。 */
export const PROFILE_HINT_CLS = 'profile-hint text-xs leading-[1.5] text-muted-foreground';

/** 值槽吃余量（原 .profile-value--grow）：行内编辑（名称输入框 / 职责
 *  textarea）与长值时用。 */
export const PROFILE_VALUE_GROW_CLS = 'min-w-0 flex-[1_1_auto]';

/** 编辑器形态（原 .profile-value--editor）：值槽转列（输入框在上、动作行在
 *  下），纵向撑满。 */
export const PROFILE_VALUE_EDITOR_CLS = 'min-w-0 flex-[1_1_auto] flex-col items-stretch gap-2';

/** 卡盒：皮肤 = registry Card 默认（ring / 底色 / rounded-xl 只住 Card 一处），
 *  本件只挂 overflow 与首末子件圆角；件默认纵向垫/gap 归零（行满幅贴边，
 *  layout，住 PROFILE_CARD_CLS）。上边距归消费点（帐号面 r7 13 的 16px 是
 *  「头 44 + 16」的页面节奏，资源面的节奏由域配方给），本组件不带外边距。 */
export function ProfileCard({ className, children }: { className?: string; children: ReactNode }) {
  return <Card className={cn(PROFILE_CARD_CLS, className)}>{children}</Card>;
}

/** 头像头（原 .profile-head）：120px 居中带，头像贴顶 16px（头像圆
 *  y77..141）；底色与 Card 同槽（bg-card）；顶圆角 = 卡角原值（ring 环不占
 *  布局位，无内缩复算）。 */
export function ProfileHead({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'profile-head flex h-[120px] flex-col items-center rounded-t-xl pt-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 头像圆（原 .profile-avatar，64px）。子件透传而不收 src：agent 面的头像是
 *  SeededAvatar 适配层（种子 / 兜底 / 失败换图三律都在它那儿），帐号面是静态
 *  资产。 */
export function ProfileAvatar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'profile-avatar size-16 overflow-hidden rounded-full bg-card [&_img]:block [&_img]:size-16',
        className,
      )}
    >
      {children}
    </span>
  );
}

interface ProfileRowProps {
  /** 左列主文本。 */
  label: string;
  /** 左列副文案（模板外的档：[设计] 说明文字跟着 label 走，不挤值槽）。
   *  给了副文案即走自适应行高（auto 档）。 */
  hint?: string;
  /** 行盒附加类（per-face 几何 / e2e 别名）。 */
  className?: string;
  /** 左列文本附加类（e2e 别名，如 `.agent-field-label`）。 */
  labelClassName?: string;
  /** 左列副文案附加类（e2e 别名，如 `.agent-perm-hint`）。 */
  hintClassName?: string;
  /** 值槽附加类。 */
  valueClassName?: string;
  children: ReactNode;
}

/** 一行：左 label（可带副文案）+ 右值槽。auto 档（给了 hint）下 label 列
 *  封顶 60%（原 .profile-row--auto 两列律）：副文案是整句话（职责/权限六档
 *  的说明），不封顶会把值槽挤到贴边；封顶后长句在列内折行。 */
export function ProfileRow({
  label,
  hint,
  className,
  labelClassName,
  hintClassName,
  valueClassName,
  children,
}: ProfileRowProps) {
  const auto = hint != null;
  return (
    <div className={cn(PROFILE_ROW_CLS, auto && 'h-auto min-h-[41px] py-2', className)}>
      <span
        className={cn(
          'profile-label flex flex-col gap-0.5',
          auto && 'max-w-[60%] min-w-0 flex-[1_1_auto]',
        )}
      >
        <span className={cn('profile-label-text text-sm text-muted-foreground', labelClassName)}>
          {label}
        </span>
        {auto && <span className={cn(PROFILE_HINT_CLS, hintClassName)}>{hint}</span>}
      </span>
      <span
        className={cn(
          'profile-value flex items-center gap-3.5 text-sm text-foreground [&_svg]:text-muted-foreground',
          auto && 'min-w-0 flex-[1_1_auto]',
          valueClassName,
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** 进输入态即聚焦。聚焦走 ref + effect 而非 autoFocus：biome 的
 *  a11y/noAutofocus 在本仓是 error 档，composer / mention-picker 同法。
 *  名称行（ProfileNameRow）与 agent 职责行（RoleRow）共用。 */
export function useEditorFocus<T extends HTMLElement>(editing: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  return ref;
}

interface ProfileNameRowProps {
  /** 当前名（显示态文本 + 编辑态预填值）。 */
  value: string;
  /** 提交回调（已过 trim + 非空 + 变更闸，收到的 next 一定是有效新名）。 */
  onCommit: (next: string) => void;
  /** 显示态值钮附加类（几何/皮肤 + e2e 锚别名，如 `.agent-name`）。 */
  nameClassName?: string;
  /** 编辑铅笔钮附加类（e2e 锚别名，如 `.agent-name-edit`）。 */
  editClassName?: string;
  /** 编辑态输入框附加类（几何/皮肤）；e2e 锚走 inputId（#agent-name-input），
   *  类名别名已随 #1036 dead-class 终摘。 */
  inputClassName?: string;
  /** 编辑态输入框 id（e2e 锚，如 `agent-name-input`）。 */
  inputId?: string;
  /** label 列附加类（e2e 锚别名，如 `.agent-field-label`）。 */
  labelClassName?: string;
}

/** 名称行内编辑（模板单源，r3 §4 / r7 13：名称（行内编辑））——点文本或
 *  铅笔进输入态，Enter 或失焦提交，Esc 放弃；空串/纯空白不算提交（trim 后
 *  min(1)），未变更也不触发 onCommit。铅笔钮是图标-only，靠 aria-label 拿
 *  可访问名（SquarePen 自带 aria-hidden）。
 *
 *  #1031：account 与 agent 详情两面共用本件——旧 account 名称行是纯文本 +
 *  装饰 svg（无 button、无 onClick = 假可供性），本件把 agent 详情已接好的
 *  那套（agent-detail.spec 钉死）提成模板，两面只经 props 注入各自的几何/
 *  e2e 锚，交互逻辑零分叉。行高恒名称档（PROFILE_ROW_NAME_CLS，49px）。 */
export function ProfileNameRow({
  value,
  onCommit,
  nameClassName,
  editClassName,
  inputClassName,
  inputId,
  labelClassName,
}: ProfileNameRowProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useEditorFocus<HTMLInputElement>(draft !== null);
  if (draft === null) {
    return (
      <ProfileRow
        className={PROFILE_ROW_NAME_CLS}
        label={t('名称')}
        labelClassName={labelClassName}
      >
        <Button variant="ghost" className={nameClassName} onClick={() => setDraft(value)}>
          {value}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className={editClassName}
          aria-label={t('编辑')}
          onClick={() => setDraft(value)}
        >
          <SquarePen width={14} height={14} />
        </Button>
      </ProfileRow>
    );
  }
  const commit = () => {
    const next = draft.trim();
    if (next !== '' && next !== value) onCommit(next);
    setDraft(null);
  };
  return (
    <ProfileRow
      className={PROFILE_ROW_NAME_CLS}
      label={t('名称')}
      labelClassName={labelClassName}
      valueClassName={PROFILE_VALUE_GROW_CLS}
    >
      {/* 名称编辑进 Input 原语；几何/皮肤随消费点注入的 inputClassName；focus
          行为收敛底座环（#849 方向），不再是 UA 默认 outline。 */}
      <Input
        id={inputId}
        ref={inputRef}
        className={inputClassName}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
    </ProfileRow>
  );
}
