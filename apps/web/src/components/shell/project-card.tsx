import type { ProjectColor, ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProjectAvatar } from '../../board/project-avatar.js';
import { useI18n } from '../../i18n/provider.js';
import { ToneGlyph } from '../tone-glyph.js';
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
  const { t } = useI18n();
  return (
    <article
      data-slot="project-card"
      className="group/pcard relative flex items-start gap-3.5 rounded-(--radius-card) bg-card p-4 shadow-(--e1)"
    >
      <ProjectAvatar name={name} tone={tone} icon={icon} color={color} />
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
              {t('{n} 件等你', { n: waiting })}
            </StatusChip>
          )}
        </div>
        <p className="mt-0.5 mb-0 truncate text-meta text-content-tertiary">
          {repo} · {t('创建于 {time}', { time: created })}
        </p>
        <p className="mt-2 mb-0 line-clamp-2 text-ui text-content-secondary">{goal}</p>
        <p className="mt-2.5 mb-0 flex gap-3 text-meta text-content-tertiary">
          <span className="inline-flex items-center gap-1.25">
            <ToneGlyph tone="working" still className="size-3" />
            {t('{n} 个运行中', { n: running })}
          </span>
          <span>{t('{n} 条对话', { n: threads })}</span>
          <span>{t('{n} 个已合并', { n: merged })}</span>
        </p>
      </div>
      <span className="relative z-10 flex-none">
        {menu ?? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('{name} 的菜单', { name })}
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
      <ProjectAvatar name={name} tone={tone} />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-card-title font-semibold text-foreground">{name}</b>
        <p className="mt-0.5 mb-0 text-meta text-content-tertiary">{note}</p>
      </div>
    </article>
  );
}
