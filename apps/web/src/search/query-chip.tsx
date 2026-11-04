import type { ParsedSearchFilter } from '@cairn/shared';
import { cn } from 'cn';
import { X } from 'lucide-react';
import { MENU_SURFACE_CLS } from '../components/ui/menu.js';
import { useI18n } from '../i18n/provider.js';
import { CHIP_PROBLEM_COPY, type ChipProblem, SYNTAX_ROWS } from './search-query.js';

export function QueryChip({
  chip,
  problem,
  onRemove,
}: {
  chip: ParsedSearchFilter;
  problem: ChipProblem | null;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const key = `${chip.negated ? '-' : ''}${chip.key}:`;
  return (
    <span
      data-testid="query-chip"
      data-invalid={problem === null ? undefined : ''}
      title={problem === null ? undefined : t(CHIP_PROBLEM_COPY[problem])}
      className={cn(
        'inline-flex h-6 flex-none items-center gap-0.5 rounded-(--cds-radius-md) bg-secondary pr-1 pl-2 text-meta',
        problem !== null && 'text-destructive ring-1 ring-destructive/40',
      )}
    >
      <span className={problem === null ? 'text-content-tertiary' : ''}>{key}</span>
      <span className={cn('font-medium', problem === null && 'text-foreground')}>{chip.value}</span>
      <button
        type="button"
        aria-label={t('移除筛选 {filter}', { filter: chip.raw })}
        className="flex size-4.5 flex-none items-center justify-center rounded-sm text-content-tertiary hover:bg-(--menu-hover) hover:text-foreground"
        onClick={onRemove}
      >
        <X width={12} height={12} />
      </button>
    </span>
  );
}

export function ChipProblems({
  chips,
  problems,
}: {
  chips: readonly ParsedSearchFilter[];
  problems: readonly (ChipProblem | null)[];
}) {
  const { t } = useI18n();
  const flagged = chips.flatMap((chip, index) => {
    const problem = problems[index];
    return problem === null || problem === undefined ? [] : [{ chip, problem }];
  });
  if (flagged.length === 0) return null;
  return (
    <ul
      data-testid="chip-problems"
      className="m-0 flex list-none flex-col gap-0.5 border-b border-border px-4 py-1.5 text-meta text-destructive"
    >
      {flagged.map(({ chip, problem }) => (
        <li key={chip.raw}>
          <span className="font-mono text-code">{chip.raw}</span> · {t(CHIP_PROBLEM_COPY[problem])}
        </li>
      ))}
    </ul>
  );
}

export function SyntaxHelp({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="syntax-help"
      className={cn(MENU_SURFACE_CLS, 'flex flex-col gap-2 p-3', className)}
    >
      <div className="flex items-center gap-2">
        <h3 className="m-0 flex-1 text-ui font-medium text-foreground">{t('搜索筛选')}</h3>
        <span className="text-caption text-content-tertiary">{t('可以任意组合，需同时满足')}</span>
      </div>
      <dl className="m-0 grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 max-[640px]:grid-cols-[4.5rem_minmax(0,1fr)]">
        {SYNTAX_ROWS.map((row) => (
          <div key={row.key} className="contents">
            <dt className="font-mono text-code text-foreground">{row.key}</dt>
            <dd className="m-0 text-meta text-content-secondary">{t(row.meaning)}</dd>
            <dd className="m-0 font-mono text-code text-content-tertiary max-[640px]:hidden">
              {row.example}
            </dd>
          </div>
        ))}
      </dl>
      <p className="m-0 border-t border-border pt-2 text-meta text-content-tertiary">
        {t('没有筛选的词匹配标题。在筛选前加 - 表示排除。')}
      </p>
    </div>
  );
}
