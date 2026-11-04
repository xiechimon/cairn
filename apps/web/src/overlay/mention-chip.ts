import { cn } from 'cn';

const CHIP_BASE =
  'mention-chip mx-0.5 inline-flex items-center gap-0.5 rounded-(--cds-radius-sm) bg-(--spot-soft) px-1.5 py-px align-baseline font-sans text-xs leading-[1.4] font-medium text-(--spot-text-on-tint) no-underline';

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
  'inline-flex size-7 shrink-0 items-center justify-center rounded-(--cds-radius-md) bg-(--surface-tertiary) text-(--foreground)';

const KIND_ICON_CLS: Record<string, string> = {
  todo: 'bg-(--spot-text-on-tint)/18 text-(--spot-text-on-tint)',
  skill: 'bg-(--chip-idle-fg)/18 text-(--chip-idle-fg)',
  agent: 'bg-(--col-dot-done)/18 text-(--col-dot-done)',
  project: 'bg-(--tile-orange-fg)/18 text-(--tile-orange-fg)',
  machine: 'bg-(--col-dot-building)/18 text-(--col-dot-building)',
};

export function mentionIconClass(kind: string): string {
  return cn(ICON_BASE, `mention-icon--${kind}`, KIND_ICON_CLS[kind] ?? '');
}
