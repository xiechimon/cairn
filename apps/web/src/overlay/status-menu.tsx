import { cn } from 'cn';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import type { Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Check } from '../icons/index.js';
import { PHASE_STATUS } from '../phase.js';

const LIST_PHASES: { phase: Phase; label: string }[] = [
  { phase: 'todo', label: '待开始' },
  { phase: 'planning', label: '规划中' },
  { phase: 'confirm', label: '确认方案' },
  { phase: 'building', label: '构建中' },
  { phase: 'review', label: '审核' },
  { phase: 'done', label: '已完成' },
];

const NEXT_NOTE: Record<Phase, string> = {
  todo: '点击开始后，Agent 会先写方案。',
  queued: '排队中，轮到它时会自动开始。',
  planning: '方案写好后，Agent 会把它移到确认方案。',
  confirm: '你确认方案后，Agent 开始构建。',
  building: '构建完成后，Agent 会把它移到审核。',
  review: '审核无误后，你可以把它标记为已完成。',
  done: '任务已完成，发送消息即可继续。',
  failed: '这次运行失败了，可以重跑，或移回待开始。',
  closed: '任务已取消。',
};

const ROW_CLS =
  'h-8 w-full justify-start gap-2.5 rounded-(--radius-menu-item) border-none px-2 text-ui font-normal text-foreground';

interface StatusMenuProps {
  phase: Phase;
  elapsed: string;
  onMoveBack?: () => void;
  onMarkDone?: () => void;
}

export function StatusMenu({ phase, elapsed, onMoveBack, onMarkDone }: StatusMenuProps) {
  const { t } = useI18n();
  const hasMoves = onMoveBack != null || onMarkDone != null;
  return (
    <div className="flex flex-col gap-px text-left" data-testid="status-menu">
      {LIST_PHASES.map((row) => {
        const current = row.phase === phase;
        const status = PHASE_STATUS[row.phase];
        return (
          <div
            key={row.phase}
            aria-current={current ? 'step' : undefined}
            data-phase={row.phase}
            data-current={current ? '' : undefined}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-(--radius-menu-item) px-2 text-ui',
              current ? 'bg-(--menu-hover) text-foreground' : 'text-content-tertiary',
            )}
          >
            <StatusGlyph kind={status.glyph} className={status.ink} />
            <span>{t(row.label)}</span>
            {current && (
              <>
                <span className="ml-auto text-meta text-content-tertiary tabular-nums">
                  {elapsed}
                </span>
                <Check aria-hidden="true" className="size-4 flex-none text-foreground" />
              </>
            )}
          </div>
        );
      })}
      {hasMoves && (
        <>
          <div aria-hidden="true" className="mx-2 my-1 h-px bg-border" />
          {onMoveBack != null && (
            <Button
              variant="ghost"
              className={`${ROW_CLS} hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)`}
              data-action="move-back"
              onClick={onMoveBack}
            >
              {t('移回待开始')}
            </Button>
          )}
          {onMarkDone != null && (
            <Button
              variant="ghost"
              className={`${ROW_CLS} hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)`}
              data-action="mark-done"
              onClick={onMarkDone}
            >
              {t('标记为已完成')}
            </Button>
          )}
        </>
      )}
      <p className="m-0 px-2 pt-1.5 pb-1 text-meta text-content-tertiary" data-testid="status-note">
        {t(NEXT_NOTE[phase])}
      </p>
    </div>
  );
}
