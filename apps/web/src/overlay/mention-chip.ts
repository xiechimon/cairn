import { cn } from 'cn';

const CHIP_BASE =
  'mention-chip mx-0.5 inline-flex items-center gap-0.5 rounded-(--cds-radius-sm) bg-(--spot-soft) px-1.5 py-px align-baseline font-sans text-xs leading-[1.4] font-medium text-(--spot-text-on-tint) no-underline';

const KIND_CHIP_CLS: Record<string, string> = {
  todo: 'cursor-pointer gap-1 bg-secondary text-ui text-foreground',
  agent: 'bg-secondary text-content-secondary',
  project: 'bg-secondary text-content-secondary',
  machine: 'bg-secondary text-content-secondary',
  skill: 'bg-secondary text-content-secondary',
  file: 'bg-secondary text-content-secondary',
};

export function mentionChipClass(kind: string | null | undefined): string {
  if (kind == null || KIND_CHIP_CLS[kind] === undefined) return CHIP_BASE;
  return cn(CHIP_BASE, `mention-chip--${kind}`, KIND_CHIP_CLS[kind]);
}
