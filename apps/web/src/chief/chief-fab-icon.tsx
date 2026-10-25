// 唯一消费点 = 根 host 的全站 FAB（chief-root.tsx，ADR 0013 D6 单实例）。

import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { ChiefContent } from '../fixtures/records.js';
import { BUSY_SPIN_CLS } from './chief-spiral-face.js';

function ChiefFabMark({ busy }: { busy: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="-142 -254 452 452"
      className={`size-5.5 text-(--fab-mark) ${busy ? BUSY_SPIN_CLS : ''}`}
    >
      <path
        d="M0 0 A84 84 0 0 1 168 0 A140 140 0 0 1 -112 0 A196 196 0 0 1 280 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="58"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChiefFabIcon({
  chief,
  busy,
  expanded,
}: {
  chief: ChiefContent;
  busy: boolean;
  expanded: boolean;
}) {
  return chief.agent ? (
    // #444/#950：头像铺满 FAB 圆（字形的内边距不适用于头像面），尺寸由本
    // 槽钉死——Avatar 加载失败退静态资产时盒子不变，无布局跳动。utility
    // 单源在此，五族 FAB（board inline + 四个 wake 壳）同配方。
    <span
      className={`block flex-none overflow-hidden rounded-full [&_img]:block [&_img]:size-full [&_img]:object-cover ${expanded ? 'size-8' : 'size-full'}`}
    >
      <SeededAvatar
        className="size-full"
        name={chief.agent.displayName}
        src={chief.agent.avatarUrl}
        fallback="/avatar-robot-1.svg"
        busy={busy}
      />
    </span>
  ) : expanded ? (
    <span className="flex size-8 flex-none items-center justify-center">
      <ChiefFabMark busy={busy} />
    </span>
  ) : (
    <ChiefFabMark busy={busy} />
  );
}
