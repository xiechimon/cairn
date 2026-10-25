import { cn } from 'cn';

const CHIP_BASE =
  'mention-chip mx-0.5 inline-flex items-center gap-0.5 rounded-[3px] bg-(--spot-soft) px-1.5 py-px align-baseline font-sans text-xs leading-[1.4] font-medium text-(--spot-text-on-tint) no-underline';

const KIND_CHIP_CLS: Record<string, string> = {
  todo: 'cursor-pointer',
  agent: 'bg-(--chip-done-bg) text-(--chip-done-fg)',
  project: 'bg-(--tile-orange-bg) text-(--tile-orange-fg)',
  machine: 'bg-(--chip-idle-bg) text-(--col-dot-building)',
  skill: 'bg-(--chip-idle-bg) text-(--chip-idle-fg)',
  file: 'bg-(--chip-idle-bg) text-(--chip-idle-fg)',
};

export function mentionChipClass(kind: string | null | undefined): string {
  if (kind == null || KIND_CHIP_CLS[kind] === undefined) return CHIP_BASE;
  return cn(CHIP_BASE, `mention-chip--${kind}`, KIND_CHIP_CLS[kind]);
}

const ICON_BASE =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-(--surface-tertiary) text-(--foreground)';

const KIND_ICON_CLS: Record<string, string> = {
  todo: 'bg-[color-mix(in_srgb,var(--spot-text-on-tint)_18%,transparent)] text-(--spot-text-on-tint)',
  skill: 'bg-[color-mix(in_srgb,var(--chip-idle-fg)_18%,transparent)] text-(--chip-idle-fg)',
  agent: 'bg-[color-mix(in_srgb,var(--col-dot-done)_18%,transparent)] text-(--col-dot-done)',
  project: 'bg-[color-mix(in_srgb,var(--tile-orange-fg)_18%,transparent)] text-(--tile-orange-fg)',
  machine:
    'bg-[color-mix(in_srgb,var(--col-dot-building)_18%,transparent)] text-(--col-dot-building)',
};

export function mentionIconClass(kind: string): string {
  return cn(ICON_BASE, `mention-icon--${kind}`, KIND_ICON_CLS[kind] ?? '');
}
