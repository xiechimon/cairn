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
        'tag-chip max-w-40 justify-start gap-0 text-(--text-on-accent) transition-none',
        className,
      )}
      style={{ backgroundColor: tag.color }}
      title={tag.name}
    >
      <span className="min-w-0 truncate">{tag.name}</span>
    </Badge>
  );
}
