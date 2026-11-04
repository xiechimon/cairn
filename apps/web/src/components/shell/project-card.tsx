import type { ProjectColor, ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProjectAvatar } from '../../board/project-avatar.js';
import { ToneGlyph } from '../stone/tone-glyph.js';
import { Button } from '../ui/button.js';
import { StatusChip } from '../ui/status-chip.js';

export interface ProjectCardProps {
  name: string;
  tone: number;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
  repo: string;
  created: string;
  goal: string;
  waiting: number;
  running: number;
  threads: number;
  merged: number;
  onOpen?: () => void;
  menu?: ReactNode;
}

export function ProjectCard({
  name,
  tone,
  icon,
  color,
  repo,
  created,
  goal,
  waiting,
  running,
  threads,
  merged,
  onOpen,
  menu,
}: ProjectCardProps) {
  return (
    <article
      data-slot="project-card"
      className="group/pcard relative flex items-start gap-3.5 rounded-(--radius-card) bg-card p-4 shadow-(--e1) hover:shadow-(--card-lift)"
    >
      <ProjectAvatar
        name={name}
        tone={tone}
        icon={icon}
        color={color}
        className={icon == null ? 'size-9 rounded-(--cds-radius-xl) text-heading' : undefined}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Button
            variant="link"
            onClick={onOpen}
            className="h-auto min-w-0 justify-start p-0 text-card-title font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline"
          >
            <span className="truncate">{name}</span>
          </Button>
          {waiting > 0 && (
            <StatusChip tone="confirm" className="flex-none text-caption">
              {waiting} waiting on you
            </StatusChip>
          )}
        </div>
        <p className="mt-0.5 mb-0 truncate text-meta text-content-tertiary">
          {repo} · created {created}
        </p>
        <p className="mt-2 mb-0 line-clamp-2 text-ui text-content-secondary">{goal}</p>
        <p className="mt-2.5 mb-0 flex gap-3 text-meta text-content-tertiary">
          <span className="inline-flex items-center gap-1.25">
            <ToneGlyph tone="working" still className="size-3" />
            {running} running
          </span>
          <span>{threads} threads</span>
          <span>{merged} merged</span>
        </p>
      </div>
      <span className="relative z-10 flex-none">
        {menu ?? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Project menu"
            className="text-content-tertiary"
          >
            <Ellipsis />
          </Button>
        )}
      </span>
    </article>
  );
}

export function ArchivedProjectCard({
  name,
  tone,
  note,
  className,
}: {
  name: string;
  tone: number;
  note: string;
  className?: string;
}) {
  return (
    <article
      data-slot="project-card"
      data-archived=""
      className={cn(
        'flex items-start gap-3.5 rounded-(--radius-card) bg-card p-4 opacity-60 shadow-(--e1)',
        className,
      )}
    >
      <ProjectAvatar
        name={name}
        tone={tone}
        className="size-9 rounded-(--cds-radius-xl) text-heading"
      />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-card-title font-semibold text-foreground">{name}</b>
        <p className="mt-0.5 mb-0 text-meta text-content-tertiary">{note}</p>
      </div>
    </article>
  );
}
