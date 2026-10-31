import type { TagRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Badge } from './badge.js';

export type TagChipData = Pick<TagRecord, 'id' | 'name' | 'color'>;

interface TagChipProps {
  tag: TagChipData;
  className?: string;
}

export function TagChip({ tag, className }: TagChipProps) {
  return (
    <Badge
      className={cn(
        'tag-chip max-w-40 justify-start gap-0 rounded-(--cds-radius-sm) px-1.5 transition-none',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${tag.color} var(--tag-tint), var(--card))`,
        color: `color-mix(in srgb, ${tag.color} var(--tag-ink), var(--foreground))`,
      }}
      title={tag.name}
    >
      <span className="min-w-0 truncate">{tag.name}</span>
    </Badge>
  );
}
