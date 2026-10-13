// Shared live row (#873): one behaviour source for every chat surface that
// shows a running step — the detail transcript (r7 16/26 `准备工作区...`) and
// the chief drawer (#739 in-flight presence row). The two used to be separate
// copies that drifted: the chief's row became a real disclosure in #822 while
// the detail's kept a bare chevron, and only the detail carried a seconds
// counter — frozen, because nothing re-rendered it.
//
// Failure ways this component closes (enumerated before the code):
//   F1 the seconds only advanced when something ELSE re-rendered the row
//      (a text delta, a refetch): in a silent window the label froze at the
//      value it had when the row first painted (the reported `1s`). Fix =
//      the row owns a 1s ticker over a real `startedAt`.
//   F2 the row tail carried a chevron with nothing behind it (#634's「形必须
//      带义」violation, the detail-page twin of #822): a disclosure glyph is
//      rendered only when the caller supplies a panel.
//   F3 the surfaces disagreed: same situation, different affordances. Fix =
//      both render through this row, with the skin and the panel content as
//      the only per-surface inputs.
//
// #471 law: seconds never lie. The counter reads a real start timestamp and
// stops the moment the row unmounts; a surface with no start timestamp (the
// chief's activeRun envelope has none) passes `startedAt` null and renders no
// counter at all — an absent number, not a frozen one.

import { Atom } from 'loading-dev';
import { type ReactNode, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import type { TVars } from '../../i18n/translate.js';
import { ChevronDown, ChevronRight } from '../../icons/index.js';
import { Button } from '../ui/button.js';

/** 2026-10-13 发送黑盒拆除：标签静默超过本阈值（s）时折叠行挂「· 信号 Ns
 *  前」走表——静默本身成为可见事实（相位标签可能冻结在早先的上报，用户
 *  实测「59s 正在连接模型」零下文）。阈值取 10s：正常相位迁移/增量流都在
 *  秒级，10s 静默已经值得可见。 */
export const QUIET_AFTER_SECONDS = 10;

/** Elapsed whole seconds since `startedAt`, re-read on a 1s beat while a
 *  start stamp is present. Returns null when there is no stamp — the caller
 *  then renders no counter (never a fabricated one). */
export function useLiveSeconds(startedAt: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt == null) return null;
  return Math.max(1, Math.round((now - startedAt) / 1000));
}

/** Per-surface skin. The row skeleton and every behaviour stay shared.
 *  #945（detail.css 清零）：detail 皮肤从 per-face 规则迁到 token
 *  utilities——类名保留为惰性别名（detail-b 票的 spec 与 integration 仍按
 *  它定位）。值 = 老 computed 逐项同形：行 20px / 12px 墨 / tertiary
 *  标签（--text-dim 在非 background 面 light 模实测 < 槽地板 3，#908
 *  裁决 2 换槽 --text-tertiary，token 值不动）/ spinner 走 spot 实底 +
 *  spinner-breathe 脉冲（keyframes 正本在 motion.css carrier 层，
 *  reduced-motion 冻结走 motion-reduce 变体）。
 *  chief 皮肤 #950 清零后 = token utility（旧 .chief-streaming 族等值，
 *  类名别名已退役）。headBtn = 仅 Button 形态（disclosure 在位）追加的
 *  行钮中和：#885 靶高律（纵向内边距被等量负 margin 抵掉、墨迹零位移）+
 *  ghost 件配方七通道归零（旧 unlayered background:none/border:none 恒压
 *  件层——迁移后逐通道显式钉回：无 hover 涂底、无 hover/expanded 墨变、
 *  墨常驻）。两侧各自携带完整中和串，Button 不再铺共享尾串——detail 的
 *  h-6 与旧共享尾串的 h-auto 同 twMerge 轴、后写者胜会砸 #885 命中盒。 */
const SKIN = {
  detail: {
    head: 'ml-[15px] flex h-5 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs leading-4 text-(--text-tertiary)',
    /** #873/#885 disclosure 钮形态：命中盒 20→24px（WCAG 2.5.8），纵向
     *  +2px 内边距被等量负 margin 抵掉，content box 仍 20px、相邻行零位移。
     *  ghost 七通道中和（#908 裁决 3）：hover/aria-expanded 底与墨、字重、
     *  边框、gap·px、press 位移全数钉回老 per-face 的透明形态。 */
    headBtn:
      "h-6 -my-0.5 cursor-pointer rounded-none justify-start border-none bg-transparent py-0.5 text-left text-[length:inherit] leading-[inherit] font-normal hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto",
    spinner:
      'flex-none text-(--card-button) animate-[spinner-breathe_3600ms_var(--ease-standard)_infinite] motion-reduce:animate-none',
    secs: 'tabular-nums',
    /** #910 二级载体：live 行是无 role 结构位；spinner 是库件封闭 props
     *  （loading-dev SpinnerProps 无 data-* 透传），spec 按 row scope +
     *  aria-hidden 库根载体定位，不另铺钩。 */
    rowTestid: 'live-row',
    label: 'chat-streaming-label truncate text-(--text-tertiary)',
  },
  chief: {
    rowTestid: undefined,
    head: 'flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs leading-4 text-(--text-tertiary)',
    /** #950：chief 面等值迁 utility（旧规则原住 chief.css，类名别名随
     *  清零退役）。尾段 = 原 Button 共享尾串（h-auto / rounded-none /
     *  justify-start / font-normal / press 位移 / svg 尺寸豁免）并入本
     *  皮肤——两侧形态一致，Button 处只做拼接。 */
    headBtn:
      "-my-[1.5px] h-auto cursor-pointer rounded-none justify-start border-none bg-transparent py-[1.5px] text-left text-sm leading-normal font-normal hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto",
    spinner:
      'flex-none animate-[spinner-breathe_3600ms_var(--ease-standard)_infinite] text-(--card-button) motion-reduce:animate-none',
    secs: 'tabular-nums',
    label: 'truncate text-(--text-tertiary)',
  },
} as const;

/** 「最近信号：Ns 前」（#905，两面共用的披露行）：对 activity 事件的 server
 *  盖章时刻走 1s 表（useLiveSeconds 复用）——数字持续增长即「卡住」的诚实
 *  呈现，daemon 只在真有流事件时上报，静默期无人推新（#471 律：没有真实
 *  时刻就整行不渲染，绝不摆冻结数）。 */
export function LiveSignal({ at, className }: { at?: number | null; className: string }) {
  const { t } = useI18n();
  const secs = useLiveSeconds(at ?? null);
  if (secs == null) return null;
  return <span className={className}>{t('最近信号：{n}s 前', { n: secs })}</span>;
}

export interface LiveRowProps {
  variant: keyof typeof SKIN;
  /** Already-translated row label (`处理中...` / `正在停止…` / …). */
  label: string;
  /** t(label) 的插值参数（#905 活动标签 `正在执行工具：{n}` 等）。 */
  labelVars?: TVars;
  /** Live start stamp — the row ticks `Ns` from it. Null/absent = no counter. */
  startedAt?: number | null;
  /** Static capture value (fixture records carry a frozen `3s`). Ignored when
   *  `startedAt` is present: a live row reads the clock, a capture reads the
   *  capture. */
  seconds?: number | null;
  /** Present ⇒ the row head is a real button (with a chevron) that toggles
   *  `children`; absent ⇒ plain text, and no chevron is rendered at all. */
  disclosure?: { expand: string; collapse: string } | null;
  /** 2026-10-13 发送黑盒拆除：最近信号时刻（相位 at 与文本增量取新）。在位
   *  且静默超过 QUIET_AFTER_SECONDS ⇒ 标签后挂「· 信号 Ns 前」走表（1s
   *  计时器，#471 同律：真时刻驱动，不摆冻结数）；缺省 = 无信号面不挂。 */
  lastSignalAt?: number | null;
  /** The disclosure panel. Rendered only while expanded. */
  children?: ReactNode;
}

export function LiveRow({
  variant,
  label,
  labelVars,
  startedAt,
  seconds,
  lastSignalAt,
  disclosure = null,
  children,
}: LiveRowProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const tick = useLiveSeconds(startedAt);
  const shown = tick ?? seconds ?? null;
  // 静默走表（发送黑盒拆除）：同一枚 1s 计时器族驱动，超过阈值才挂——
  // 新鲜信号期零噪声；无 lastSignalAt（fixture / 旧 server）整段不渲染。
  const quietSecs = useLiveSeconds(lastSignalAt ?? null);
  const quiet = quietSecs != null && quietSecs > QUIET_AFTER_SECONDS ? quietSecs : null;
  const skin = SKIN[variant];
  const labelText = t(label, labelVars);
  const body = (
    <>
      <Atom size={16} duration={1800} className={skin.spinner} />
      {shown != null && <span className={skin.secs}>{shown}s</span>}
      {disclosure != null &&
        (expanded ? (
          <ChevronDown width={10} height={10} />
        ) : (
          <ChevronRight width={10} height={10} />
        ))}
      {/* 2026-10-12 dsh 对齐：跑动期标签带扫光（dsh TextShimmer 同族）——
          真文本保持 tertiary 原色，aria-hidden 叠加层走 105° mask 扫
          （样式在 motion.css 的 chat-shimmer-sweep；reduced-motion 整层
          摘除）。本行是「在跑」的载体——挂载期即在跑，扫光恒随。 */}
      <span className={`${skin.label} relative`}>
        {labelText}
        {/* 扫光层是纯光带、零文本（textContent 翻倍的实测坑见 motion.css
            本类注），aria-hidden 只为保险。 */}
        <span className="chat-shimmer-sweep" aria-hidden="true" />
      </span>
      {/* 静默走表（发送黑盒拆除）：标签之后挂「· 信号 Ns 前」——标签可能
          冻结在早先的相位上报，静默时长让「卡住」与「在长考」可区分。不进
          扫光标签 span（它是 meta 不是标签文本；进 textContent 会重复）。 */}
      {quiet != null && (
        <span className={`${skin.secs} flex-none`} data-testid="live-quiet">
          {t('· 信号 {n}s 前', { n: quiet })}
        </span>
      )}
    </>
  );
  return (
    <>
      {disclosure == null ? (
        <span className={skin.head} data-testid={skin.rowTestid}>
          {body}
        </span>
      ) : (
        <Button
          variant="ghost"
          className={`${skin.head} ${skin.headBtn}`}
          data-testid={skin.rowTestid}
          aria-label={t(expanded ? disclosure.collapse : disclosure.expand)}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {body}
        </Button>
      )}
      {disclosure != null && expanded && children}
    </>
  );
}
