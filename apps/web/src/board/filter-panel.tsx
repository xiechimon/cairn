// 看板统一筛选面板（XMON-57）：顶栏从「左仓库 chip 组 + 右类型 popover 钮」
// 收敛成「左 = 生效筛选条 + 右 = 恰好一钮（筛选）」。
//
// 为什么不是「两个面各自加个全选键」：原来的痛点是**逐个点选**，而逐个点选
// 有两个来源——两条轴各占顶栏一半、各自只有单值切换语义。补全选键治的是
// 症状；把两轴收进同一个面板、批次操作（全选 / 反选 / 仅此）与计数挂在
// 维度行上，才是治因。对照面：Multica 是单 Filter 钮 + 弹层多维；todos.dev
// 是板级 Filters 图标 + 层内两段（「Created by」「Projects」）。三者同形，
// 本面取 Multica 的计数口径（另一轴收窄后的命中数）、不取 todos.dev 的排除式
// （并集 + 全选已覆盖，且换模型要重写 ?projects= 契约）；参考站的创建者维度
// 不搬——本仓自有类型轴（tag）取代它的位置（#636，用户点名）。
//
// 本文件 = 两轴的**共用视图**：轴自己「有哪些、怎么判」在 tag-filter.ts /
// repo-filter.ts，这里只吃归一化后的 FilterDimension，不写第二份判定。
//
// 弹层走新轨原语 components/ui/popover.tsx（Base UI Popover + Positioner），
// 不自造定位壳/背板/Esc 接线。esc 由 Base UI 的 useDismiss 承接，它挂的是
// **document** 上的 keydown（floating-ui-react/hooks/useDismiss 实测），与手写
// 族（#67 家族旧手写 hook，挂 window，已随 #656 退役）落点不同；e2e/escape-wiring
// 的探针两个目标都数，故本次换机制没有把那条 #462 重挂钉变成空虚绿——
// 开层期（URL 写回触发重渲染后、关层前读取）两个目标均零增删，实测见该用例。
// 触发钮走 PopoverTrigger 的 render 合成，Button 原语与 data-variant 契约
// （board-filter e2e 的材质钉）原样透出。
//
// per-face 类名（board-filter-panel / filter-dimension-* / filter-option-*
// 等）历史上是 e2e 定位别名；#411 别名优先政策已被 #910 裁定 1 废止——
// 本域 spec 重钉到 role/label/text 一级载体。零规则别名的终摘已随 #1036
// dead-class 闸落地：仍被 spec 命中的名字原位保留（board-type-filter /
// type-filter-popover / type-filter-option，闸的 selector-exempt 台账逐名
// 钉住引用文件），零引用的名字已摘除。
//
// 面板皮肤并全站 popup vocabulary（壳 p-1、行 rounded-md + hover/选中
// bg-accent、维度间分隔线全出血 -mx-1、计数留右端 shortcut 位），行形与批次
// 行照参考站（todos.dev）实测对齐（#636）：行首 = 16px 圆角 checkbox（选中 =
// indigo 实底白勾；槽位恒在，toggle 零布局位移）；计数仅有命中时画（零命中
// 不占右端位）；全选行居行表首（三态 checkbox：空选 off / 部分 mixed / 满选
// on；满选再点 = 清本维），反选挂该行右端；维度标题行只留标题 + 已选读数
// （批次键不再挂标题行）。「仅此」hover 现形，与计数共右端槽（静息计数、
// hover 仅此）——两控件位置都稳定，不随选集大小推移。

import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { EmptyDescription } from '../components/ui/empty.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Separator } from '../components/ui/separator.js';
import { TagChip } from '../components/ui/tag-chip.js';
import { useI18n } from '../i18n/provider.js';
import { Check, Funnel, X } from '../icons/index.js';

/** 选项超过此数才给搜索框——短词表（固定 6 词）搜索框是纯噪音。 */
const SEARCH_THRESHOLD = 8;

/** 面板选项（归一化）：两轴各自投影到这里，面板只认这四档。 */
export interface FilterChoice {
  /** 值键（类型轴 = 词表名，仓库轴 = 项目 id）。 */
  value: string;
  label: string;
  /** 色位：在场 = 渲染 TagChip（用户数据色，词表专属）；缺席 = 素文本行。 */
  color?: string;
  /** 另一轴收窄后的命中卡数（本轴自身不参与，见各轴 build*Options）。 */
  count: number;
}

export interface FilterDimension {
  key: string;
  name: string;
  choices: readonly FilterChoice[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  /** 反选 = 选集取源集补集（全选行右端键）；空选反选 = 全选、满选 = 清空。 */
  onInvert: () => void;
  onClear: () => void;
  onOnly: (value: string) => void;
}

/** 生效筛选条的一节：一个维度一条，点即清该维度。 */
export interface FilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

/** 行首勾选框（参考站实测形）：16px 方角。off = 控制边框空盒；on = 品牌
 *  实底勾；mixed = 品牌边框 + 横杠（全选行的部分选中态）。槽位恒在，
 *  状态切换零布局位移。 */
function CheckBox({ state }: { state: 'off' | 'on' | 'mixed' }) {
  return (
    <span
      aria-hidden
      className={`flex size-4 flex-none items-center justify-center rounded-[4px] border transition-colors ${
        state === 'off'
          ? 'border-input'
          : state === 'on'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-primary text-primary'
      }`}
    >
      {state === 'on' && <Check className="size-3" />}
      {state === 'mixed' && <span className="h-0.5 w-2 rounded-full bg-current" />}
    </span>
  );
}

/** 顶栏左侧的生效筛选条。空选中集不渲染任何条——「全部」态没有可摘的
 *  东西，画一个常驻「全部」pill 会把「当前无筛选」表达成一个筛选。
 *  实底高对比（bg-foreground）是刻意的：看板被收窄时「卡不见了」的观感
 *  与「卡真的没了」无法区分，解释这件事的东西就该是全屏最重的一小块
 *  墨；静息淡灰会让最需要被读到的状态变成最容易被略过的。 */
export function FilterChips({
  chips,
  onClearAll,
}: {
  chips: readonly FilterChip[];
  onClearAll: () => void;
}) {
  const { t } = useI18n();
  if (chips.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pl-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <Button
          key={chip.key}
          data-dimension={chip.key}
          /* 实审裁决 4（2026-10-08，#1004）：rounded-full 药丸 = 登记在案的有
             理由偏离——生效筛选条是「板被收窄」的解释面，刻意做全屏最重的实底
             墨（header 注），圆药丸与方/圆角面板形成材质对比；不向 registry
             button 默认几何对齐，理由见对账声明。 */
          className="h-5 flex-none gap-1 rounded-full border border-transparent bg-foreground px-2 text-[11px] leading-none font-medium text-background hover:bg-foreground active:not-aria-[haspopup]:translate-y-0"
          aria-label={t('清除{name}筛选', { name: chip.label })}
          onClick={chip.onClear}
        >
          <span className="max-w-40 truncate">{chip.label}</span>
          <X className="size-2.5" />
        </Button>
      ))}
      {chips.length > 1 && (
        <Button
          variant="ghost"
          className="h-5 flex-none rounded-full border-none px-2 text-[11px] leading-none font-medium text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent active:not-aria-[haspopup]:translate-y-0"
          onClick={onClearAll}
        >
          {t('清除全部')}
        </Button>
      )}
    </div>
  );
}

function DimensionSection({
  dimension,
  divided,
  query,
  onQuery,
}: {
  dimension: FilterDimension;
  /** 非首段加分隔线——两段是同一面板里的两个维度，不是两个面板。 */
  divided: boolean;
  query: string;
  onQuery: (next: string) => void;
}) {
  const { t } = useI18n();
  const selectedSet = new Set(dimension.selected);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ''
        ? dimension.choices
        : dimension.choices.filter((choice) => choice.label.toLowerCase().includes(needle)),
    [dimension.choices, needle],
  );
  const actionable = dimension.choices.length > 0;
  const allSelected = actionable && dimension.selected.length === dimension.choices.length;
  const someSelected = dimension.selected.length > 0;
  return (
    <section className="flex flex-col" data-dimension={dimension.key}>
      {/* 维度间分隔线全出血（壳 p-1 内 -mx-1，DropdownMenuSeparator 同形）；
          my-1 节奏 = 线上线下各 4px，故 divided 时标题不再另加 pt。 */}
      {divided && <Separator className="-mx-1 mt-1 mb-1" />}
      {/* 标题行只留标题 + 已选读数（参考站形：标题带不挂批次键）；批次操作
          下沉到行表首的全选行。 */}
      <header className={`flex items-baseline gap-1.5 px-2 pb-1 ${divided ? 'pt-1' : 'pt-1.5'}`}>
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          {t(dimension.name)}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {t('已选 {n}/{m}', { n: dimension.selected.length, m: dimension.choices.length })}
        </span>
      </header>
      {!actionable ? (
        // 空词表不是错误态：作用域里本来就没有可选项（旧 fixture 场景没有
        // 项目 / 标签源）。说清「本作用域内没有」而不是留一个空壳。
        <EmptyDescription className="px-1.5 pt-1 pb-2 text-xs">
          {dimension.key === 'repo' ? t('本作用域内没有可选的仓库') : t('本作用域内没有可选的类型')}
        </EmptyDescription>
      ) : (
        <>
          {dimension.choices.length > SEARCH_THRESHOLD && (
            <Input
              className="mb-1 h-6 px-2 text-xs"
              placeholder={t('搜索{name}', { name: t(dimension.name) })}
              aria-label={t('搜索{name}', { name: t(dimension.name) })}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
          )}
          {/* 全选行（行表首，参考站位置）：三态 checkbox + 全选文案；满选再点
              = 清本维——段内清除钮撤除后，「清」由本行满选态 / 反选 / 顶栏
              生效筛选条三路承接，功能不丢。反选挂该行右端（参考站位置与文案）。 */}
          <div className="flex items-center">
            {/* #952 回收（#943 deliberate-official 直消费 Root 的收口，#908
                comment-6001887439 裁决 1②）：三态走共享 Checkbox 件——
                indeterminate 官方一等 prop 直通 Root（aria-checked="mixed"
                与隐藏原生 input 的键盘/表单/读屏语义白送），mixed 视觉 =
                件上零皮肤语义映射（横杠图标，#952/#982）。#1003 起件为
                registry 同源，皮肤 = 上游默认；整行可点 = 消费点 label 包裹，
                点文案即 toggle。 */}
            {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
            <label className="inline-flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-(--cds-radius-sm) px-2 text-xs text-foreground transition-colors hover:bg-accent-soft">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onCheckedChange={() =>
                  allSelected ? dimension.onClear() : dimension.onSelectAll()
                }
                aria-label={t('全选')}
              />
              <span className="min-w-0 flex-1 truncate text-left">{t('全选')}</span>
            </label>
            <Button
              variant="link"
              className="mr-2 h-auto shrink-0 rounded border-none px-1 text-xs font-normal text-primary active:not-aria-[haspopup]:translate-y-0"
              onClick={dimension.onInvert}
            >
              {t('反选')}
            </Button>
          </div>
          <div
            className="flex max-h-[220px] flex-col overflow-y-auto"
            role="listbox"
            aria-multiselectable="true"
            aria-label={t(dimension.name)}
          >
            {shown.map((choice) => {
              const active = selectedSet.has(choice.value);
              // type-filter-option 是 spec 定位别名（escape-wiring /
              // shadcn-primitives / drive-tags）；repo 侧别名零引用，已随
              // #1036 dead-class 终摘（data-project 载体承担区分）。
              const alias = choice.color == null ? '' : 'type-filter-option';
              return (
                <div key={choice.value} className="group relative flex items-center">
                  <Button
                    variant="ghost"
                    {...(choice.color == null
                      ? { 'data-project': choice.value }
                      : { 'data-tag': choice.value })}
                    role="option"
                    aria-selected={active}
                    className={`${alias} h-7 min-w-0 flex-1 justify-start gap-2 rounded-(--cds-radius-sm) border-none px-2 text-xs font-normal text-foreground hover:bg-accent-soft dark:hover:bg-accent-soft active:not-aria-[haspopup]:translate-y-0 ${
                      active ? 'bg-accent' : ''
                    }`}
                    onClick={() => dimension.onToggle(choice.value)}
                  >
                    {/* 勾选态 = 圆角 checkbox（参考站形）：槽位恒在，toggle 与
                        「仅此」现形都不推挤标签/计数的列位。 */}
                    <CheckBox state={active ? 'on' : 'off'} />
                    {active && choice.color != null ? (
                      <TagChip
                        tag={{ id: choice.value, name: choice.label, color: choice.color }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-left">{choice.label}</span>
                    )}
                    {/* 计数仅有命中时画（参考站形：零命中不占右端位）。 */}
                    {choice.count > 0 && (
                      <span
                        data-testid="option-count"
                        className="ml-auto text-[11px] text-muted-foreground tabular-nums transition-opacity group-hover:opacity-0"
                      >
                        {choice.count}
                      </span>
                    )}
                  </Button>
                  {/* 「仅此」：多选轴的逆向操作（全选后取消一个的镜像）。
                      静息透明、hover/focus 现形，与计数共右端槽（静息计数、
                      hover 仅此）；恒渲染（无选中时 disabled）让行右缘几何
                      与选中集大小无关。 */}
                  {/* 静息隐藏、行 hover 现形：disabled 档把件基类的
                      disabled:opacity-50 归零回 opacity-0（现形仍由
                      group-hover 承担，双层变体链压在单层之上），
                      pointer-events-none 天然吃掉 disabled:hover 染色。 */}
                  <Button
                    variant="ghost"
                    disabled={dimension.selected.length === 0}
                    className="absolute right-2 h-auto shrink-0 rounded border-none px-1 text-[11px] font-normal text-muted-foreground opacity-0 transition-opacity hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-transparent disabled:opacity-0 disabled:group-hover:opacity-100 active:not-aria-[haspopup]:translate-y-0"
                    onClick={() => dimension.onOnly(choice.value)}
                  >
                    {t('仅此')}
                  </Button>
                </div>
              );
            })}
            {shown.length === 0 && (
              <EmptyDescription className="px-1.5 py-1.5 text-xs">
                {t('没有与“{q}”匹配的选项', { q: query })}
              </EmptyDescription>
            )}
          </div>
        </>
      )}
    </section>
  );
}

interface FilterPanelProps {
  dimensions: readonly FilterDimension[];
  /** 两轴选中值总数：驱动触发钮角标（收起态也读得出筛选在生效）。 */
  totalSelected: number;
  onClearAll: () => void;
}

/** 顶栏右动作区的筛选钮（无底色 ghost——与主操作实底材质区分）+ anchored
 *  popover。图标而非文字：Funnel 是本产品自己的筛选语汇（r2 24b 位图里就
 *  长在 project 任务工具条上），文字钮在此处只占宽不增信息量；可读名走
 *  aria-label，收起态「筛选在生效」由角标读数承担。
 *  开态由本组件自持（纯 UI 态，真值在 URL）；关闭三路 = Esc / 外点 /
 *  重点触发钮，全由 Base UI 承接。点选**保持开**——点选即关会把多选取缔
 *  成单选。查询串随开合周期复位（下次开层不该带着上次的过滤残留）。 */
export function FilterPanel({ dimensions, totalSelected, onClearAll }: FilterPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<Record<string, string>>({});
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery({});
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="board-type-filter h-7 gap-1.5 px-2"
            aria-label={t('筛选')}
          />
        }
      >
        <Funnel />
        {totalSelected > 0 && (
          <span
            data-testid="filter-count"
            className="rounded-full bg-accent px-1.5 text-[11px] leading-4 font-normal text-muted-foreground"
          >
            {totalSelected}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        aria-label={t('筛选')}
        className="type-filter-popover w-[268px] gap-0 p-1"
      >
        {dimensions.map((dimension, index) => (
          <DimensionSection
            key={dimension.key}
            dimension={dimension}
            divided={index > 0}
            query={query[dimension.key] ?? ''}
            onQuery={(next) => setQuery((prev) => ({ ...prev, [dimension.key]: next }))}
          />
        ))}
        {totalSelected > 0 && (
          <Button
            variant="ghost"
            className="mt-0.5 h-7 w-full rounded-(--cds-radius-sm) border-none text-xs font-normal text-muted-foreground hover:bg-accent-soft hover:text-foreground dark:hover:bg-accent-soft active:not-aria-[haspopup]:translate-y-0"
            onClick={onClearAll}
          >
            {t('清除全部')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
