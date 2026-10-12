// AI 审核模态（M7 #312 / r8 §2.5/§3.1）：560 宽居中（448 弹层律之外新档） +
// 搜索行 + Agent 行（头像 + 名 + 厂商 · 模型；选中行 bg-indigo-500/10）+ 独立
// 性提示行（#509）+ 可选关注点 textarea + 32×32「开始审核」按钮。点击「开始
// 审核」→ POST /api/builds/{id}/steps {action:"review", agentId, focus?};server
// 入队审核步 + 时间线插 REVIEW_ANNOUNCEMENT（r8 §3.1 实测）→ phase 留
// confirm/review（审核步是额外 agent 步，不推进主时序），chip 文案切「审核
// 中」、composer placeholder 切「AI 审核进行中…」、停止钮复用 steer（#308）。
//
// 选人（#509）：默认选中经 producerProvider 跨厂商优先（判定规则单源 =
// review-default.ts，默认值与用户改选共用同一条比较），本组件只负责在选中项
// **不构成独立复核**时出声——同源与无法判定分两档措辞，都不静默。判定规则不在
// 服务端：用户显式改选同厂商照常发起。

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { classifyReviewChoice } from './review-default.js';

// #1006 原型（#980 前提④）：FOCUS_TEXTAREA / FOCUS_ROW 手写皮律退役——
// Textarea / Input / Label 走 registry 件默认形态（rounded-lg border-input、
// field-sizing-content、text-sm/500 标签），中和串（field-sizing-fixed /
// ring 清零 / UA 占位墨回退）随皮肤一起消失。

/** AI 审核选择器行最小投影（live = members 读面投影 + 厂商槽 + 模型槽；
 * fixture = canon 单默认行）。 */
export interface ReviewAgentOption {
  id: string;
  name: string;
  /** 模型标识（如「sonnet」）；fixture 面 canon 字符串 `默认`。 */
  model: string;
  /** 服务商归属（members 读面 actor.provider）；null = 未配置，不参与跨厂商
   *  判定。 */
  provider: string | null;
}

interface ReviewDialogProps {
  /** #73 retained-mount open flag。 */
  open?: boolean;
  onClose: () => void;
  /** 候选 Agent 集（live = members 读面 memberType:"agent" 行 + agent.modelId；
   * fixture 面 = canon 单默认行）；缺省 = fixture 兜底。 */
  agents?: ReviewAgentOption[];
  /** 默认选中行 id（live = 跨厂商优先判定结果；fixture = canon 单默认）。 */
  defaultAgentId?: string;
  /** 产出步 Agent 的 provider（#509）。undefined = 本面不做独立性判定
   *  （fixture 兜底面）；null = 已判定但无基准（任务未指派产出 Agent）。 */
  producerProvider?: string | null;
  /** #1250（ADR 0018 层 1）：三视角并行审可用（团队 persona 命中 ≥1 员）——
   *  开启「fan-out」行；勾选 = 不选人，POST {action:"review"} 不带 agentId，
   *  server 按 persona 三员各入队一条 review 步。缺省 false = fixture 面
   *  与既有单审核人路径零变化。 */
  fanoutAvailable?: boolean;
  /** 开始审核点击：POST steps {action:"review", agentId?, focus?} 入队审核步
   *  （agentId 缺省 = fan-out 三视角，#1250）。缺省 = fixture 静态面（仅关闭
   *  即止，不触发）。 */
  onStart?: (input: { agentId?: string; focus: string }) => void;
}

const DEFAULT_AGENT: ReviewAgentOption = {
  id: 'r3-builder',
  name: 'r3-builder',
  model: '默认',
  provider: null,
};

export function ReviewDialog({
  open,
  onClose,
  agents,
  defaultAgentId,
  producerProvider,
  fanoutAvailable,
  onStart,
}: ReviewDialogProps) {
  const { t } = useI18n();
  const source = agents ?? [DEFAULT_AGENT];
  // 搜索态（r8 §2.5 搜索行实测）；空串视为不过滤。
  const [query, setQuery] = useState('');
  // 选中态（r8 §2.5「选中行 bg-indigo-500/10」）；retained-mount 重开回 default。
  const [selected, setSelected] = useState<string>(defaultAgentId ?? source[0]?.id ?? '');
  // #1250 fan-out 勾选态：勾选 = 不选人（server 按 persona 三员入队）。
  const [fanout, setFanout] = useState(false);
  // 可选关注点 textarea（M7 #312 票 A 票面规格：r8 §3.1 实测有 textarea + 工具
  // 条；具体工具条配置 [推断] —— 票 A 不消费，本票只挂空容器）。
  const [focus, setFocus] = useState('');
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(defaultAgentId ?? source[0]?.id ?? '');
      setFanout(false);
      setFocus('');
    }
  }, [open, defaultAgentId, source]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? source : source.filter((row) => row.name.toLowerCase().includes(q));
  }, [source, query]);

  // 独立性提示（#509）：跟手**当前选中**（用户改选后立即重判，票面 story 4），
  // 判定走 review-default 的同一条比较规则，本处只做措辞分档。跨厂商 = 无提
  // 示；同源 / 无法判定各一档，都不静默（票面「降级要出声」）。#1250 fan-out
  // 勾选时不判定（三员并行即多视角独立复核，不再是单选同源问题）。
  const notice = useMemo(() => {
    if (producerProvider === undefined || fanout) return null;
    const row = source.find((candidate) => candidate.id === selected);
    if (row === undefined) return null;
    const verdict = classifyReviewChoice(row, producerProvider);
    return verdict === 'cross-vendor' ? null : verdict;
  }, [producerProvider, source, selected, fanout]);

  const submit = () => {
    if (!fanout && selected === '') return;
    onStart?.({
      ...(fanout ? {} : { agentId: selected }),
      focus: focus.trim(),
    });
    onClose();
  };

  return (
    <DialogShell
      title={t('AI 审核')}
      open={open}
      onClose={onClose}
      width={560}
      footer={
        // #1006 原型（#980 前提④）：registry DialogFooter band + Button
        // 默认档（取消 outline / 开始审核 default），h-7/13px 冻结几何退役。
        <>
          <Button variant="outline" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button onClick={submit} disabled={!fanout && selected === ''}>
            {t(fanout ? '开始三视角审核' : '开始审核')}
          </Button>
        </>
      }
    >
      {/* #1006 原型：body 纵向栈只留 layout 位（间距走 DialogContent 的
          registry gap-4 与本栈 gap-3），16 垫随壳 p-4 退役。 */}
      <div className="flex flex-col gap-3">
        {/* #1250 fan-out 行（ADR 0018 层 1）：勾选 = 不选人，server 按 persona
            三员（CodeReviewer / SecurityAuditor / TestEngineer）各入队一条
            review 步——三份 verdict 并行落会话。勾选后 agent 列表与独立性
            提示退场（视角并行本身即独立复核）。 */}
        {fanoutAvailable === true && (
          /* #908 债闸（D2 裸控件只减不增）：勾选态走 registry Checkbox 原语
             （stop-confirm 同族），不养新裸 input。 */
          /* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */
          <label
            className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-(--secondary) px-3 py-2 text-sm text-(--foreground)"
            data-testid="review-fanout-toggle"
          >
            <Checkbox checked={fanout} onCheckedChange={setFanout} />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{t('三视角并行审')}</span>
              <span className="text-xs leading-[1.5] text-(--text-secondary)">
                {t('CodeReviewer · SecurityAuditor · TestEngineer 各审一轮，三份结论并行落会话')}
              </span>
            </span>
          </label>
        )}
        {!fanout && (
          <>
            {/* XMON-24：搜索框 = registry Input 默认形态（h-8 rounded-lg
                border-input），外包描边行 + 中和串（无边框/无底/UA 占位墨）退役。 */}
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索 Agent…')}
              aria-label={t('搜索 Agent…')}
            />
            <div
              className="flex max-h-[200px] flex-col gap-1 overflow-y-auto"
              role="listbox"
              aria-label={t('选择审核 Agent')}
            >
              {rows.length === 0 ? (
                <div className="p-4 text-center text-sm text-(--text-tertiary)">
                  {t('没有匹配的 Agent')}
                </div>
              ) : (
                rows.map((row) => {
                  const isSelected = row.id === selected;
                  return (
                    // #1006 原型（#980 前提②④）：agent 行钮 = ghost 底座默认
                    // 形态（hover:bg-muted 生效，不再漆底恒压）；64 高 / card-border
                    // 描边 / 8 圆角 per-face 皮肤退役，只留 layout 位（撑满行、
                    // 内容靠左、两行文本栈）。选中态 = data-on + --spot-soft
                    // （运行语义的状态色，token 层承载——前提④合法通道；
                    // r8 §2.5 spot 14% mix 契约不变）。role/aria-selected 直通。
                    <Button
                      variant="ghost"
                      key={row.id}
                      className="h-auto w-full justify-start gap-3 p-2 text-left font-normal data-[on=true]:bg-(--spot-soft)"
                      data-on={isSelected}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setSelected(row.id)}
                    >
                      <span
                        className="grid size-9 flex-none place-items-center rounded-full bg-(--secondary) text-sm text-(--text-secondary)"
                        aria-hidden="true"
                      >
                        {row.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm text-(--foreground)">{row.name}</span>
                        <span className="text-xs text-(--text-tertiary)">
                          {row.provider === null ? row.model : `${row.provider} · ${row.model}`}
                        </span>
                      </span>
                    </Button>
                  );
                })
              )}
            </div>
            {/* 独立性提示行（#509）：同源与无法判定两档共用本容器（两档只差文案，
            不做红黄分色）。左缘 amber 竖条与 chat-review-finding--suggestion
            同色，读作「留意」而非「出错」——状态色走 token 层。 */}
            {notice === null ? null : (
              <div
                className="flex flex-col gap-1 rounded-lg border-l-[3px] border-(--badge-attention) bg-(--secondary) px-3 py-2.5"
                role="status"
              >
                <span className="text-sm font-semibold text-(--foreground)">
                  {notice === 'same-vendor' ? t('本次审核与产出同源') : t('无法判定审核独立性')}
                </span>
                <span className="text-xs leading-[1.5] text-(--text-secondary)">
                  {notice === 'same-vendor'
                    ? t('审核人与产出该方案的 Agent 来自同一模型厂商，不构成独立复核。')
                    : t(
                        '产出该方案的 Agent 或所选审核人未配置模型厂商，缺少比对基准，不构成独立复核。',
                      )}
                </span>
              </div>
            )}
          </>
        )}
        <div className="flex flex-col gap-2">
          {/* #1006 原型：标签走 registry Label 件（批次 0b 引入），--label-size
              手写标签律退役。 */}
          {/* CJK 标签行高修正（leading-none → 1.25，墨盒不贴行底被邻位
              focus 环压住）：就地 className，件保持 pristine（#980 S5）。 */}
          <Label className="leading-tight">{t('希望 Agent 审核时重点关注什么？（可选）')}</Label>
          <Textarea
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            rows={3}
            placeholder={t('希望 Agent 审核时重点关注什么？（可选）')}
          />
        </div>
      </div>
    </DialogShell>
  );
}
