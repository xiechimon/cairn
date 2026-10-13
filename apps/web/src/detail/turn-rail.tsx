// 2026-10-13 dsh TurnNavigator port（用户 review 钉「3和5 都要」的 3）：
// 稳定距纵列（10px 节距），悬停弹出回合预览，点击跳转；配方源自 dsh
// TurnNavigator.tsx + TurnNavigator.module.css 源码实测。
//
// 情况简化（pacman 不看对话历史，数据全在本地内存）：
//   - 不走 @tanstack/react-virtual：回合数 bounded（典型 <30），全量渲染，
//     内部 overflow 撑滚动 + fade 遮罩与 dsh 同律。
//   - 无 unloaded 态（本地面无 history paging）、无 busy 脉（无分页谓词）。
//   - 每枚刻度 = loaded 面（10px 距，2px 横线 tick，右缘对齐）。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

interface TurnRailTurn {
  /** 该回合用户行的 transcript 序号（scrollIntoView 锚）。 */
  userIndex: number;
  prompt: string;
  response: string;
}

interface TurnRailProps {
  turns: TurnRailTurn[];
}

/** 从 transcript 项派生紧凑回合表：每个 user 行开一轮；prompt = 用户话
 *  （markdown 优先、平文本兜底）；response = 其后第一个 robot 行的文本
 *  （markdown 优先、首段兜底）。 */
export function turnsFromTranscript(transcript: readonly TranscriptItem[]): TurnRailTurn[] {
  const turns: TurnRailTurn[] = [];
  let pending: { userIndex: number; prompt: string } | null = null;
  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i];
    if (item == null) continue;
    if (item.kind === 'user') {
      if (pending !== null) turns.push({ ...pending, response: '' });
      pending = { userIndex: i, prompt: item.markdown ?? item.text };
    } else if (item.kind === 'robot' && pending !== null) {
      const firstPara = item.paragraphs?.[0];
      const paraText = Array.isArray(firstPara)
        ? firstPara.map((s) => s.text).join('')
        : (firstPara?.segments ?? []).map((s) => s.text).join('');
      turns.push({ ...pending, response: item.markdown ?? paraText });
      pending = null;
    }
  }
  if (pending !== null) turns.push({ ...pending, response: '' });
  return turns;
}

// — geometry (dsh literal) ——————————————————————————————————————————

const INSET = 6; // 首刻上方 + 末刻下方的内垫，每端
const PITCH = 10; // 相邻刻度节距
const MAX_FRAME_H = 420; // 框高上限
const PREVIEW_H = 100; // 预览卡高（顶/底 clamp 用）
const MARK_OFFSET = INSET; // 首刻度 top（末刻内垫由 marks 总高吸收）

function prefScrollBehavior(): ScrollBehavior {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

/** -webkit-box 行截断（dsh 的 line-clamp 律；Tailwind line-clamp 在
 *  content-visibility 下偶发零高，不依赖）。 */
function clampStyle(lines: number): React.CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
  };
}

export function TurnRail({ turns }: TurnRailProps) {
  const { t } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);
  const [band, setBand] = useState(600); // default fallback before observer fires
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);

  // 框的竖中 = 根元高之半（dsh：--turn-rail-band/2，由 Scrollport observe 供）。
  // pacman 没有 dsh 的全局 CSS 变量通道，直接从 parent 尺寸读。
  useEffect(() => {
    const parent = slotRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBand(entry.contentRect.height);
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // 视口 = 页面内唯一一棵详情列 scroller（slotRef 有 ref 时序盲区，
  //  parentElement 在首渲 effect 时刻未必就位——全局 selector 稳且
  //  全站只有一棵详情列，不存在歧义）。 */
  const viewport = useCallback(
    () => document.querySelector<HTMLDivElement>('[data-slot="message-scroller-viewport"]'),
    [],
  );

  // 滚锚 spy：active = 顶缘已越过视口中线的最近 user 行序号。
  // 用 getBoundingClientRect（视口坐标系，offsetParent 无关）比 offsetTop
  // 稳：MessageScroller 的 relative root 会截获 offsetParent，offsetTop 量到
  // root 顶而非视口滚动原点，嵌套定位下会漂。
  const spy = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const vp = viewport();
      if (!vp) return;
      const rows = vp.querySelectorAll<HTMLElement>('[data-row="user"]');
      const vpRect = vp.getBoundingClientRect();
      const mid = vpRect.top + vpRect.height * 0.5;
      let hit = -1;
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i]?.getBoundingClientRect().top ?? Infinity) <= mid) hit = i;
      }
      setActive(hit < 0 ? null : hit);
    });
  }, [viewport]);

  useEffect(() => {
    const vp = viewport();
    if (!vp) return;
    vp.addEventListener('scroll', spy, { passive: true });
    spy();
    // 数据迟到（首帧 user 行未挂 / live 追加）：DOM 变更再跑一次 spy。
    const mo = new MutationObserver(spy);
    mo.observe(vp, { childList: true, subtree: true });
    return () => {
      vp.removeEventListener('scroll', spy);
      mo.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [spy, viewport]);

  const jump = useCallback(
    (index: number) => {
      const vp = viewport();
      if (!vp) return;
      const rows = vp.querySelectorAll<HTMLElement>('[data-row="user"]');
      rows[index]?.scrollIntoView({ block: 'start', behavior: prefScrollBehavior() });
    },
    [viewport],
  );

  if (turns.length < 2) return null;

  const marksHeight = turns.length * PITCH + INSET; // 首刻 INSET + (n-1)*PITCH，末刻下缘 = 末刻 top + 刻度盒高
  const frameHeight = Math.min(marksHeight, MAX_FRAME_H);
  const preview = previewIndex != null ? (turns[previewIndex] ?? undefined) : undefined;
  const previewCenter =
    previewIndex != null
      ? previewIndex * PITCH + MARK_OFFSET + PITCH / 2 - (scrollerRef.current?.scrollTop ?? 0)
      : 0;

  return (
    <div ref={slotRef} className="turn-rail-slot">
      <nav
        className="turn-rail-frame"
        style={{ maxHeight: frameHeight, top: Math.round(band / 2) }}
        aria-label={t('回合跳转')}
        onPointerLeave={() => setPreviewIndex(null)}
      >
        <div
          ref={scrollerRef}
          className="turn-rail-scroller"
          data-fade-top={fadeTop ? '' : undefined}
          data-fade-bottom={fadeBottom ? '' : undefined}
          onScroll={() => {
            const el = scrollerRef.current;
            if (!el) return;
            setFadeTop(el.scrollTop > 1);
            setFadeBottom(el.scrollTop < el.scrollHeight - el.clientHeight - 1);
          }}
        >
          <div className="turn-rail-marks" style={{ height: marksHeight }}>
            {turns.map((_turn, idx) => (
              <button
                key={idx}
                type="button"
                className="turn-rail-mark"
                data-active={idx === active ? '' : undefined}
                aria-label={t('跳到第 {n} 回合', { n: idx + 1 })}
                aria-current={idx === active ? 'true' : undefined}
                style={{ top: idx * PITCH + MARK_OFFSET }}
                onClick={() => jump(idx)}
                onPointerMove={() => setPreviewIndex(idx)}
                onFocus={() => setPreviewIndex(idx)}
                onBlur={() => setPreviewIndex(null)}
              />
            ))}
          </div>
        </div>
        {preview != null && previewIndex != null && (
          <div
            role="tooltip"
            className="turn-rail-preview"
            style={{
              top: Math.max(0, Math.min(frameHeight - PREVIEW_H, previewCenter - PREVIEW_H / 2)),
            }}
          >
            <div className="turn-rail-preview-prompt" style={clampStyle(1)}>
              {preview.prompt}
            </div>
            {preview.response !== '' && (
              <div className="turn-rail-preview-response" style={clampStyle(3)}>
                {preview.response}
              </div>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
