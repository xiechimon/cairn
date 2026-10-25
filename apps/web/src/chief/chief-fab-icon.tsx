import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { ChiefContent } from '../fixtures/records.js';
import { BUSY_SPIN_CLS } from './chief-spiral-face.js';

export function SpiralMark({
  busy,
  className = 'size-5.5 text-(--fab-mark)',
}: {
  busy: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="-142 -254 452 452"
      className={`${className} ${busy ? BUSY_SPIN_CLS : ''}`}
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
      <SpiralMark busy={busy} />
    </span>
  ) : (
    <SpiralMark busy={busy} />
  );
}
