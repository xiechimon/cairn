// Agent 模型槽两级选择器（t-0024 诉求 2）：概览 tab 与创建 Agent 弹窗共用。
// 一级 = 运行时/服务商（provider 维），二级 = 该 provider 名下的具体模型。
// 改前是单个平铺下拉（行 = `模型名` + 右侧 provider 徽标），provider 与
// runtime 段的候选混在一列——用户原话「全部混杂在一起，只有一个模型的方框」。
//
// 为什么一级是 provider 维而不是 machine 维 runtime（pi / claude-code 词表，
// records/model-source.ts）：agent 记录只有 provider + modelId 两字段（wire 无
// 独立 runtime 字段），provider 位的语义 = null/pi 内置、claude-code 本机段、
// 其余 custom provider id（#499 只读行时期的裁决原文）；一级分组键因此只能是
// provider——它既是存值位，也是用户心智里「先指定 Claude / 先指定某个网关」
// 的那一层。machine 维 runtime 是「一台电脑 × 一个 CLI」的执行面概念
// （docs/research/r10-multica-runtime.md），agent 配置面没有这个选择。
//
// 候选清单投影 = api/mappers.ts `toModelOptions`（model-sources 非 pi 段；
// #770 起 providers 段已除——存量 provider 绑定值命中不了选项，走裸串兜底
// 回显）。一级分组 = 该投影的 provider 位去重保序。
//
// 壳 = components/ui/select.tsx registry compound 族（#1010 回源，#982 判决：
// XMON-75 手写 options 单体件退役；几何/皮肤归 registry 默认，ADR 0012 D1，
// 触发钮盒形/菜单锚边/封顶常量全退役——Base UI Positioner 自带碰撞翻转与
// --available-height 封顶，旧 absolute 壳的锚边覆写失去存在理由）。本件只剩
// 「值怎么投影成行」与两级级联：换一级清二级（modelId 只在 provider 内有
// 意义，跨 provider 带过去是脏值）；一级为内置 (pi)（= null，本仓 BYOK 无
// 内置模型目录）时二级无候选，走 Select Root 的 disabled 门（时序门，非
// #222 死钮）。「内置 (pi)」清空行 = Base UI 的 null item（value=null 是
// 一等选中值，ItemIndicator/回显都认它）。
//
// #1260：chief 模型覆盖槽退役后，本件是模型选择的唯一面——Agent 的模型
// 是自身配置项，没有「继承」态，也没有「默认（与 Chief 相同）」行。值回显
// 兜底裸串律的单源在 components/model-select-core（#626 收敛）：本件一级
// 消费 providerEchoLabel、二级消费 modelEchoLabel，壳与两级级联律仍归本件。
//
// 标签只出模型名：原版下拉项的 `· 128k` 是原版内置模型目录的上下文窗口——
// cairn 是本地 BYOK，没有这个数据源，不编造；provider 位升去一级后二级行内
// 也不再重复徽标。
//
// e2e 句柄（prefix，零规则类）：触发钮 `${prefix}-select`、弹层
// `${prefix}-menu`（= role=listbox 的 Popup 本体）、行 `${prefix}-row`。
// 旧 `${prefix}-wrap|shell|row-name|row-meta|check` 随手写壳退役——Root 不
// 落 DOM、退场桥归 Base UI 动效、行内名/勾归 SelectItem 结构。弹层经
// Portal 挂 body（不再嵌在触发钮 wrap 里），locator 一律页面级取。
// triggerClassName 承载布局位（弹窗面的 w-full 撑行宽）与设置卡的 Paper
// 白底框式触发钮配方（SETTINGS_SELECT_TRIGGER_CLS）。

import { cn } from 'cn';
import { modelEchoLabel, providerEchoLabel } from '../components/model-select-core.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

/** 内置 (pi) 的显示词（provider null/'pi' 的读回形）：一级选择器的清空行与
 *  触发钮回读同词，与 #499 只读行时期的运行时档文案逐字一致（原 agent-detail
 *  页本地常量，两级化后单源移此）。 */
export const BUILTIN_RUNTIME_LABEL = '内置 (pi)';

/** 一级候选分组：provider 位去重保序（toModelOptions 同键去重语义——分组键
 *  只能是 provider）。 */
export function providerGroups(
  options: ModelOption[],
): { provider: string; providerLabel: string }[] {
  const groups: { provider: string; providerLabel: string }[] = [];
  const seen = new Set<string>();
  for (const row of options) {
    if (seen.has(row.provider)) continue;
    seen.add(row.provider);
    groups.push({ provider: row.provider, providerLabel: row.providerLabel });
  }
  return groups;
}

interface AgentRuntimeSelectProps {
  /** Trigger id, so a form label can point at it. */
  id?: string;
  /** Trigger name where no <label> points at it (the agent detail row label
   *  is plain text, #1442). */
  ariaLabel?: string;
  /** 当前值 = provider 位；null = 内置 (pi)（清空行）。 */
  value: string | null;
  options: ModelOption[];
  /** 选定回调；级联清二级的决定权在调用面（存值形态各面不同）。 */
  onPick?: (provider: string | null) => void;
  /** 类名前缀——两个消费点的 e2e 各自钉自己的钩子（零规则句柄类）。 */
  prefix: string;
  /** 触发钮布局位（仅宽度类，如弹窗面的 w-full；皮肤/几何归 registry 默认）。 */
  triggerClassName?: string;
  unsetLabel?: string;
}

/** 一级：运行时/服务商。行 = provider 分组名（custom provider 的 label /
 *  runtime 段品牌名 `Claude Code`），首行恒是「内置 (pi)」清空档。 */
export function AgentRuntimeSelect({
  id,
  ariaLabel,
  value,
  options,
  onPick,
  prefix,
  triggerClassName,
  unsetLabel,
}: AgentRuntimeSelectProps) {
  const { t } = useI18n();
  const groups = providerGroups(options);
  // 值回显：分组命中 → 分组名；未命中（provider 已被改名/删除）→ 裸串兜底，
  // 不空白不崩（律单源 model-select-core，二级同律）。
  const unset = unsetLabel ?? t(BUILTIN_RUNTIME_LABEL);
  const label = providerEchoLabel(value, groups, unset);

  return (
    <Select value={value} onValueChange={(next) => onPick?.(next as string | null)}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(`${prefix}-select`, triggerClassName)}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent aria-label={t('运行时')} className={`${prefix}-menu`}>
        <SelectItem className={`${prefix}-row`} value={null}>
          {unset}
        </SelectItem>
        {groups.map((group) => (
          <SelectItem key={group.provider} className={`${prefix}-row`} value={group.provider}>
            {group.providerLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** #1301：二级弹层宽度随内容走——registry 默认 `w-(--anchor-width)` 把弹层
 *  钉在触发钮宽，概览 tab 的触发钮只有回显值那么宽，长 id（`deepseek-v4-pro[1M]`
 *  一类）右侧被裁。改为 max-content 宽：下限仍是触发钮宽，上限是 Positioner
 *  给的视口可用宽。 */
const MODEL_MENU_FIT = 'w-max min-w-(--anchor-width) max-w-(--available-width)';

/** #1301：撞到上限的超长 id 折行而不是被裁（ItemText 默认 nowrap + shrink-0），
 *  行 title 再兜一层全名。 */
const MODEL_ROW_WRAP =
  '[&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:break-all [&>:first-child]:whitespace-normal';

interface AgentModelSelectProps {
  /** Trigger id, so a form label can point at it. */
  id?: string;
  /** Same as AgentRuntimeSelect. */
  ariaLabel?: string;
  /** 一级当前值：候选按它过滤；null = 内置 (pi)，名下无可选模型，本级禁用。 */
  provider: string | null;
  modelId: string | null;
  options: ModelOption[];
  /** #1259 额外禁用位：claude-code 选了运行时但还没选归属机（候选按机
   *  过滤，无机无可选）。 */
  disabled?: boolean;
  /** 选定回调（modelId 或 null 清空）；provider 位由调用面自持。 */
  onPick?: (modelId: string | null) => void;
  /** 类名前缀——同 AgentRuntimeSelect。 */
  prefix: string;
  /** 触发钮布局位——同 AgentRuntimeSelect。 */
  triggerClassName?: string;
}

/** 二级：当前运行时/服务商名下的具体模型。 */
export function AgentModelSelect({
  id,
  ariaLabel,
  provider,
  modelId,
  options,
  disabled = false,
  onPick,
  prefix,
  triggerClassName,
}: AgentModelSelectProps) {
  const { t } = useI18n();
  const rows = options.filter((row) => row.provider === provider);
  // 值回显：选项命中 → 模型名；未命中（模型已被改名/删除）→ 裸串兜底，
  // 不空白不崩（律单源 model-select-core，chief 选择器同律）。
  const unset = t('未设置模型');
  const label = modelEchoLabel({ provider, modelId }, options, unset);

  return (
    <Select
      value={modelId}
      disabled={disabled || provider === null}
      onValueChange={(next) => onPick?.(next as string | null)}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(`${prefix}-select`, triggerClassName)}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        aria-label={t('模型')}
        className={cn(
          `${prefix}-menu rounded-(--radius-popover) shadow-(--shadow-popover)`,
          MODEL_MENU_FIT,
        )}
      >
        <SelectItem className={`${prefix}-row`} value={null}>
          {unset}
        </SelectItem>
        {rows.map((row) => (
          // #1259：两台机器可上报同名模型——key 带归属机防撞（value 仍是
          // modelId，归属机由提交面的 machineId 字段承担）。#1288：dead 模型
          // 置灰 +「已下架」标注不隐藏（保留可见性，用户看得到历史值为何
          // 不可选）。
          <SelectItem
            key={`${row.machineId ?? ''}/${row.modelId}`}
            className={cn(`${prefix}-row`, MODEL_ROW_WRAP)}
            title={row.modelName}
            value={row.modelId}
            disabled={row.liveness === 'dead'}
          >
            {row.liveness === 'dead' ? `${row.modelName}（${t('已下架')}）` : row.modelName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
