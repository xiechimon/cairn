// 模型选择实现核心（#626 收敛）：四个面——agent 创建槽与概览槽（两级 Select
// 级联，#617 裁决形态）、chief 主模型 dialog（r5 108 / #615 裁决形态）、压缩
// 模型 popover（#204 形态）——共用的实现律单源在此：行投影（ModelOption →
// 行形）、值回显兜底裸串律、选中当前值空操作关面律、默认行语义（清空/继承
// 文案由各面传入，本层不硬编码三种变体）。
//
// 壳与几何不收编、归各面：chief 两个 flat 面各带自己的类名组（skin 参数），
// 节点结构与收敛前逐一同构——dialog 面多一层 col 列容器（r5 108 形态），
// popover 面 name/provider 直挂行下；agent 两面继续走 components/ui/select.tsx
// registry compound 族（#1010 回源），只消费本文件的回显兜底律。明确不收敛壳：chief 面直接换
// AgentRuntimeSelect 已被票面否决——两级级联与 r5 108 的 flat+副题+搜索+
// 继承默认行不同构，强行统一壳是产品决策不是代码决策。
//
// 本层不碰 i18n（api/mappers.ts toThinkingLevelDisplay 同律）：词典键单源在
// 各调用面的 t()，默认行/未设槽文案一律作参数传入。

import type { ModelRef } from '@pacman/shared';
import { cn } from 'cn';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelOption } from '../fixtures/records.js';
import { Check, Search } from '../icons/index.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';

/** 模型维槽值：对象形 {provider, modelId}（chiefCompactionModelSchema 同构；
 *  agent 面的两字段拼成同形传入）。modelId null = 槽未设；provider null 仅
 *  agent 级联面出现（内置 pi 档，此时二级禁用、回显走未设文案）。 */
export interface ModelSlotValue {
  provider: string | null;
  modelId: string | null;
}

/** 选项命中：(provider, modelId) 联合键唯一行（toModelOptions 已同键去重，
 *  至多一行相等）。值未命中（改名/删除/退役 preset）返 null，由回显律兜底。 */
export function findModelOption(
  options: readonly ModelOption[],
  value: ModelSlotValue | null,
): ModelOption | null {
  if (value == null || value.modelId == null) return null;
  return (
    options.find((row) => row.provider === value.provider && row.modelId === value.modelId) ?? null
  );
}

/** 行选中标记：槽值 × 行直接比对。值未命中任何选项时（stale preset / 已删
 *  模型）无行选中——101-stale-model 场景钉的就是这一态。 */
export function isOptionSelected(value: ModelSlotValue | null, row: ModelOption): boolean {
  return value != null && value.provider === row.provider && value.modelId === row.modelId;
}

/** 两槽值同值判定（「选中当前值 = 空操作关面」律的谓词）：双 null = 同；
 *  单 null = 不同；否则 provider + modelId 两位都比（裸串跨 provider 撞名，
 *  只比 modelId 是错的——chiefCompactionModelSchema 对象形槽值立法理由同）。 */
export function sameModelValue(a: ModelSlotValue | null, b: ModelSlotValue | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.provider === b.provider && a.modelId === b.modelId;
}

/** 模型维回显兜底裸串律（#180 裁决收敛到值回显层）：选项命中 → 模型名；
 *  未命中 → 裸串 provider/modelId 即名，不空白不崩；槽未设 → 面传入的
 *  未设/继承文案（清空与继承两类语义由调用面给，本层不辨）。 */
export function modelEchoLabel(
  value: ModelSlotValue | null,
  options: readonly ModelOption[],
  unsetLabel: string,
): string {
  if (value == null || value.modelId == null) return unsetLabel;
  return findModelOption(options, value)?.modelName ?? `${value.provider}/${value.modelId}`;
}

/** provider 维回显兜底裸串律（agent 一级面）：分组命中 → 分组显示名；
 *  未命中（provider 已被改名/删除）→ 裸串 = provider id 本身；null → 面
 *  传入的清空档文案。candidates 收 ModelOption[] 或 providerGroups 输出
 *  皆可（只需 provider + providerLabel 两位）。 */
export function providerEchoLabel(
  provider: string | null,
  candidates: readonly { provider: string; providerLabel: string }[],
  unsetLabel: string,
): string {
  if (provider == null) return unsetLabel;
  return candidates.find((row) => row.provider === provider)?.providerLabel ?? provider;
}

/** 「选中当前值 = 空操作关面」律 + accept 律（选择即关）单源：同值只关面
 *  不上报；不同值先关面再上报（live 真值经 invalidateAll 重取回显，不做
 *  本地乐观态；fixture 面 onPick 缺省 = 选择即关）。 */
export function createModelPicker(params: {
  value: ModelRef | null;
  close: () => void;
  onPick?: (value: ModelRef | null) => void;
}): (next: ModelRef | null) => void {
  const { value, close, onPick } = params;
  return (next) => {
    close();
    if (!sameModelValue(value, next)) onPick?.(next);
  };
}

/** 行投影后的行视图形（ModelOption → 行形）：key = provider/modelId（与
 *  toModelOptions 去重键同形，React key 防撞）；selected 走 isOptionSelected；
 *  value = 选中时上报的槽值。#1288：disabled = dead 模型（置灰不可选）。 */
export interface ModelRowVm {
  key: string;
  label: string;
  providerLabel: string;
  selected: boolean;
  /** #1288：dead 模型 = 置灰不可选（不隐藏）。 */
  disabled: boolean;
  value: ModelRef;
}

/** 行投影：候选清单 × 当前槽值 → 行视图形清单（顺序 = 候选序，不排序——
 *  序由数据源给，toModelOptions 的投影序即展示序）。#1288：dead 模型
 *  投影为 disabled 行（置灰 +「已下架」标注，不隐藏）。 */
export function toModelRows(
  options: readonly ModelOption[],
  value: ModelSlotValue | null,
  /** dead 行标注模板（i18n 单源在各面 t()，core 层只吃传入模板做 {name} 替换）。 */
  delistedTemplate: string,
): ModelRowVm[] {
  return options.map((row) => ({
    key: `${row.provider}/${row.modelId}`,
    label:
      row.liveness === 'dead' ? delistedTemplate.replace('{name}', row.modelName) : row.modelName,
    providerLabel: row.providerLabel,
    selected: isOptionSelected(value, row),
    disabled: row.liveness === 'dead',
    value: { provider: row.provider, modelId: row.modelId },
  }));
}

/** flat 行面钩子类名组（#950 per-face 清零后 = token utility 串，spec/22
 *  §3.1）：几何/皮肤正本在各面传入的 utility，核心只保证节点结构与选中律。
 *  col 缺省 = name/provider 直挂行下（#204 popover 面）；给了 = 包一层列
 *  容器（r5 108 dialog 面）。 */
export interface ModelRowSkin {
  row: string;
  col?: string;
  name: string;
  provider: string;
  check: string;
}

/** #1095 内描焦点环配方单源（行钮与 listbox 容器共用）：2px outline
 *  offset -2px——环墨落进元素盒内缘，滚动容器裁不到；环色走 #388 全局律
 *  --focus-ring。outline-solid 不可省：Button 底座 outline-none 把
 *  --tw-outline-style 钉成 none，outline-2 的 outline-style:
 *  var(--tw-outline-style) 会算出 none——computed 宽度/偏移全对、像素零墨
 *  的静默失败（实测踩过）；focus-visible 前缀的 outline-solid 以 0-2-0
 *  特异性压回 solid。Button 底座消费方另配 ring-0 摘底座外环。 */
export const FOCUS_INSET_CLS =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--focus-ring)';

/** 行钮基底（#950 裸控件收编 Button ghost）：ghost 件配方按七通道律归零
 *  （#908 comment-6001887439 裁决 3——hover bg 含 dark: / aria-expanded
 *  bg+text / hover text / press translate / gap·px / font-weight / border），
 *  hover 底 = 旧行皮 --surface-secondary 等值；选中态载体 = aria-selected
 *  （#910 裁定 3 状态类归行为）：行底 --pick-selected-bg、名/勾墨
 *  --pick-selected-fg（#751 单源律随基底走，skin 只做各面几何）。
 *  #1095 焦点配方（票面候选 a）：Button 底座的外环（focus-visible:ring-3，
 *  3px box-shadow 画在行盒外）会被 listbox 滚动容器裁掉——#872 整行铺满律下
 *  行盒四缘与裁剪盒齐平，贴边环段无墨（#883 原报、docs/verify/1011 归因实
 *  测）。环改内描走 FOCUS_INSET_CLS（墨落行盒内，滚动容器裁不到；环色收敛
 *  到 #388 全局律 --focus-ring，行灰环 --ring/50 双源就此退役），ring-0 摘
 *  底座外环。transition 收窄到底座七通道里真会变的 background-color/color
 *  ——底座 transition-all 违反「只过渡变化的属性」，但 components/ui 已冻结
 *  （#1003），修在行级不动底座。 */
export const PICK_ROW_BTN_CLS = `w-full cursor-pointer justify-start border-none bg-transparent text-left font-normal whitespace-nowrap transition-[background-color,color] hover:bg-(--secondary) hover:text-(--foreground) dark:hover:bg-(--secondary) aria-expanded:bg-transparent aria-expanded:text-(--foreground) aria-selected:bg-(--spot-soft) active:not-aria-[haspopup]:translate-y-0 focus-visible:ring-0 ${FOCUS_INSET_CLS} [&_svg:not([class*='size-'])]:size-auto`;

interface ModelPickRowProps {
  skin: ModelRowSkin;
  selected: boolean;
  /** #1288：dead 模型行禁用（置灰不隐藏）。 */
  disabled?: boolean;
  /** 行主文案：模型行 = modelName；默认行 = 各面传入的清空/继承语义文案。 */
  label: string;
  /** 行副题 = provider 显示名；默认行不传即不出。副题只投影 providerLabel
   *  ——原版捕获位 r3-gw 后那段 128k 是原版内置模型目录的上下文窗口，本地
   *  BYOK 无此数据源，不编造。 */
  providerLabel?: string;
  onPick: () => void;
}

/** chief 两面共用的 flat 行（Button[role=option] + 名 + 副题 + 选中 check）
 *  单源。行序、搜索过滤、空态归各面壳；本件只出一行。 */
export function ModelPickRow({
  skin,
  selected,
  disabled = false,
  label,
  providerLabel,
  onPick,
}: ModelPickRowProps) {
  // name/check 的 data-testid = #910 二级结构载体（#751/#872 的对比度与
  // 内衬探针钉这两个 span 的 computed 值；无 role 可表达）。
  const name = (
    <span
      data-testid="model-pick-name"
      className={cn(skin.name, 'group-aria-selected:text-(--spot-text-on-tint)')}
    >
      {label}
    </span>
  );
  const provider =
    providerLabel == null ? null : <span className={skin.provider}>{providerLabel}</span>;
  return (
    <Button
      variant="ghost"
      className={cn(
        'group',
        PICK_ROW_BTN_CLS,
        skin.row,
        disabled && 'pointer-events-none opacity-50',
      )}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onPick}
    >
      {skin.col == null ? (
        <>
          {name}
          {provider}
        </>
      ) : (
        <span className={skin.col}>
          {name}
          {provider}
        </span>
      )}
      {selected && (
        <span
          data-testid="model-pick-check"
          className={cn(skin.check, 'group-aria-selected:text-(--spot-text-on-tint)')}
        >
          <Check width={14} height={14} />
        </span>
      )}
    </Button>
  );
}

/** 搜索盒容器（#950 清零：旧 .chief-pick-search 等值迁移，控制高随件正典
 *  36→32，§2.6-1 D2 吸收）：card-border 描边 + surface 底 + tertiary 图标墨。
 *  两面同形单源在此；宿内横向缩进归各消费点（弹层壳行铺满律 #872：菜单壳
 *  零横垫、盒自带 mx-3；dialog 面骑自己的 p-4，不另缩）。 */
export const SEARCH_BOX_CLS =
  // #1054 清点：手搓输入盒接 Input 件圆角档 rounded-lg（ADR 0012 D1；
  // 盒内 input 中和件骑本盒，focus 环律不变）。
  'flex h-8 items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-3 text-(--text-tertiary)';

/** typeahead 搜索框 input 中和件单源（#756 续：用户裁决框不常驻、打字才
 *  现形）：框形由 SEARCH_BOX_CLS 承载，input 本体零装饰；focus 环走 #388
 *  家族律（#944 先例）——旧 #855「环清零」
 *  护栏随 per-face 退役，键盘可见环由全局律承接。 */
export const SEARCH_INPUT_CLASS =
  'h-auto min-w-0 flex-1 rounded-none border-none bg-transparent p-0 text-sm leading-5 text-(--foreground) shadow-none placeholder:text-(--text-tertiary) focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring) focus-visible:ring-0 dark:bg-transparent';

export interface ModelPickListProps {
  skin: ModelRowSkin;
  /** 候选清单（序 = 数据源序）；过滤律在本层。 */
  options: readonly ModelOption[];
  value: ModelSlotValue | null;
  /** 默认行文案（清空/继承语义由各面传入，本层不硬编码）。 */
  defaultLabel: string;
  /** listbox 的 aria-label 与搜索框占位/空态文案（i18n 单源在各面 t()）。 */
  listLabel: string;
  /** #1288 dead 行标注模板（如 t('{name}（已下架）')）；core 层不持 t()。 */
  delistedTemplate: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  onPick: (value: ModelRef | null) => void;
}

/** 行清单 + typeahead 搜索的单源壳（#756 续）：chief 两个 picker 面共用。
 *  搜索框**不常驻**——开面零占位（不渲染，非透明）；壳捕获可打印字符
 *  （preventDefault + stopPropagation，底层快捷键与行激活都截不到）现形
 *  搜索框并吃掉该字符（预填 + 即刻过滤 + 焦点进 input）。空格保留给行
 *  激活（键盘 a11y 契约），不触现形。
 *  **收回律（本票裁决，写进 PR）**：query 清空 = 收回——框消失、清单回
 *  全量、焦点回清单容器（后续打字可再现形）；不留空框占位。
 *  壳随 FloatingShell 卸载重置：重开回无框全清单态。 */
export function ModelPickList({
  skin,
  options,
  value,
  defaultLabel,
  listLabel,
  delistedTemplate,
  searchPlaceholder,
  emptyLabel,
  onPick,
}: ModelPickListProps) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 开面即焦点进清单容器（typeahead 契约：未现形时键必经 listbox 冒泡）。
  // Base UI 的 initialFocus 是异步移入——重载下它与首键竞态，e2e 实锤丢
  // 过键；本层在挂载（= 开面，FloatingShell 关面即卸载）同步确立，之后
  // 它再移到行钮仍在清单内，契约不断。
  useEffect(() => {
    listRef.current?.focus();
  }, []);
  // 现形即焦点进 input（吃掉的那个字符已预填，光标在尾）。
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source =
      q === ''
        ? options
        : options.filter(
            (row) =>
              row.modelName.toLowerCase().includes(q) ||
              row.providerLabel.toLowerCase().includes(q),
          );
    return toModelRows(source, value, delistedTemplate);
  }, [options, query, value, delistedTemplate]);

  return (
    <div className="flex min-h-0 flex-col gap-1">
      {searchOpen && (
        <div className={cn(SEARCH_BOX_CLS, 'mx-3')}>
          <Search width={14} height={14} />
          {/* #855：typeahead 搜索框进 Input 原语。可见皮肤挂容器行
              （SEARCH_BOX_CLS 32px 框，#950 随件正典收缩），框内 input 保持
              视觉中性——中性类单源 SEARCH_INPUT_CLASS。 */}
          <Input
            ref={inputRef}
            className={SEARCH_INPUT_CLASS}
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              // 收回律：清空即收回，焦点回清单容器承后续 typeahead。
              if (next === '') {
                setSearchOpen(false);
                setQuery('');
                listRef.current?.focus();
                return;
              }
              setQuery(next);
            }}
            placeholder={searchPlaceholder}
          />
        </div>
      )}
      <div
        ref={listRef}
        // #1095 附带：容器是开面程序焦点的落点（typeahead 契约），键盘模态下
        // :focus-visible 命中 div——#388 全局律的元素表不含 div，此前吃 UA 默
        // 认蓝环（配方不同词）。改挂仓内环配方 FOCUS_INSET_CLS；内描形态：
        // 容器横缘与壳内缘齐平（壳 px-0），外描环会越出弹层描边。
        className={`max-h-80 overflow-y-auto overscroll-contain ${FOCUS_INSET_CLS}`}
        role="listbox"
        aria-label={listLabel}
        tabIndex={-1}
        onKeyDown={(event) => {
          // typeahead 捕获挂在 listbox 上（静态元素禁事件handler 的 biome
          // 律：交互归有 role 的元素）：未现形时焦点恒在清单内（行钮或本
          // 容器），键必经此冒泡。现形后键归 input，本 handler 不插手
          // （Esc 关面归 FloatingShell/Base UI）。空格保留给行激活（键盘
          // a11y 契约），不触现形；preventDefault + stopPropagation 让底层
          // 快捷键（hotkeys 的 window 监听认 defaultPrevented）截不到。
          if (searchOpen || event.metaKey || event.ctrlKey || event.altKey) return;
          if (event.key.length !== 1 || event.key === ' ' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          setSearchOpen(true);
          setQuery(event.key);
        }}
      >
        <ModelPickRow
          skin={skin}
          selected={value === null}
          label={defaultLabel}
          onPick={() => onPick(null)}
        />
        {rows.map((row) => (
          <ModelPickRow
            key={row.key}
            skin={skin}
            selected={row.selected}
            disabled={row.disabled}
            label={row.label}
            providerLabel={row.providerLabel}
            onPick={() => onPick(row.value)}
          />
        ))}
        {searchOpen && query.trim() !== '' && rows.length === 0 && emptyLabel != null && (
          <div className="px-2 py-4 text-center text-[13px] text-(--text-tertiary)">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
