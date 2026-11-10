import { ChiefSpiralFace } from './chief-spiral-face.js';

export function ChiefStatusMark({ status }: { status: string | null }) {
  return (
    <div
      data-testid="chief-status-mark"
      className="pointer-events-none absolute top-2 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5"
    >
      <span className="flex size-12 flex-none items-center justify-center rounded-full bg-card shadow-(--e2)">
        <ChiefSpiralFace size={32} busy={status !== null} />
      </span>
      {status !== null && (
        <span
          data-testid="chief-status-pill"
          className="max-w-60 truncate rounded-full bg-card px-3 py-1 text-meta leading-5 text-foreground shadow-(--e2)"
        >
          {status}
        </span>
      )}
    </div>
  );
}
