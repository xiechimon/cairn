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
      variant="outline"
      className={cn(
        'tag-chip max-w-40 justify-start gap-1.5 bg-card text-foreground transition-none',
        className,
      )}
      title={tag.name}
    >
      <span
        aria-hidden="true"
        className="size-2 flex-none rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span className="min-w-0 truncate">{tag.name}</span>
    </Badge>
  );
}
