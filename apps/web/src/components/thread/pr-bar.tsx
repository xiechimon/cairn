import { cn } from 'cn';
import { Check, ChevronDown, GitPullRequest, LoaderCircle, X } from 'lucide-react';
import { useId } from 'react';
import { ToggleSwitch } from '../toggle-switch.js';
import { Button } from '../ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { StatusChip } from '../ui/status-chip.js';

export type CiState = 'passed' | 'running' | 'failed';

export interface PrBarProps {
  number: number;
  branch: string;
  merged?: boolean;
  ci: { state: CiState; passed: number; total: number };
  autoFix: boolean;
  onAutoFixChange: (next: boolean) => void;
  autoMerge: boolean;
  onAutoMergeChange: (next: boolean) => void;
  lockedOption?: { label: string; reason: string };
  onMerge?: () => void;
  className?: string;
}

const CI_LABEL: Record<CiState, string> = {
  passed: 'CI passed',
  running: 'CI running',
  failed: 'CI failed',
};

function ToggleRow({
  label,
  help,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (next: boolean) => void;
}) {
  const id = useId();
  const helpId = useId();
  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5 text-ui text-foreground">
      <ToggleSwitch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={helpId}
        className="mt-0.5"
      />
      <span className={cn('min-w-0 flex-1', disabled && 'text-content-tertiary')}>
        <label htmlFor={id}>{label}</label>
        <small id={helpId} className="block text-caption text-content-tertiary">
          {help}
        </small>
      </span>
    </div>
  );
}

export function PrBar({
  number,
  branch,
  merged = false,
  ci,
  autoFix,
  onAutoFixChange,
  autoMerge,
  onAutoMergeChange,
  lockedOption,
  onMerge,
  className,
}: PrBarProps) {
  const CiIcon = ci.state === 'passed' ? Check : ci.state === 'failed' ? X : LoaderCircle;
  return (
    <div
      data-slot="pr-bar"
      data-merged={merged ? '' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-xl bg-card py-2 pr-2.5 pl-3 text-meta shadow-(--e1)',
        className,
      )}
    >
      <GitPullRequest className="size-3.5 flex-none text-content-secondary" />
      <span className="font-mono text-content-secondary">#{number}</span>
      <span className="min-w-0 truncate font-mono text-content-secondary">{branch}</span>
      <span className="ml-auto flex flex-none items-center gap-2">
        {merged ? (
          <StatusChip tone="plan" className="h-6.5 gap-1.5 rounded-lg px-2.25 text-meta">
            <Check className="size-3" />
            Merged
          </StatusChip>
        ) : (
          <>
            <Popover>
              <PopoverTrigger
                data-ci={ci.state}
                className={cn(
                  'inline-flex h-6.5 items-center gap-1.5 rounded-lg px-2.25 text-meta font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  ci.state === 'passed' && 'bg-(--chip-done-bg) text-(--chip-done-fg)',
                  ci.state === 'running' && 'bg-(--chip-confirm-bg) text-(--chip-confirm-fg)',
                  ci.state === 'failed' && 'bg-(--chip-failed-bg) text-(--chip-failed-fg)',
                )}
              >
                <CiIcon
                  className={cn(
                    'size-3',
                    ci.state === 'running' && 'animate-spin motion-reduce:animate-none',
                  )}
                />
                {CI_LABEL[ci.state]}
                <ChevronDown className="size-3" />
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-75 gap-0.5 p-2.5">
                <div className="flex items-baseline justify-between px-1 py-1.5 text-ui">
                  <b className="font-semibold text-foreground">Checks</b>
                  <span className="text-content-tertiary">
                    {ci.passed} of {ci.total} passed
                  </span>
                </div>
                <ToggleRow
                  label="Auto-fix CI and address comments"
                  help="Pushes fixes to this branch when a check fails or a reviewer comments."
                  checked={autoFix}
                  onCheckedChange={onAutoFixChange}
                />
                <ToggleRow
                  label="Auto-merge when ready"
                  help={
                    autoMerge
                      ? 'Squash-merges once checks and the review gate pass.'
                      : 'Off. Use Merge when you are ready.'
                  }
                  checked={autoMerge}
                  onCheckedChange={onAutoMergeChange}
                />
                {lockedOption != null && (
                  <ToggleRow
                    label={lockedOption.label}
                    help={lockedOption.reason}
                    checked={false}
                    disabled
                  />
                )}
              </PopoverContent>
            </Popover>
            <Button size="sm" onClick={onMerge} className="h-6.5 px-2.25 text-meta">
              Merge
            </Button>
          </>
        )}
      </span>
    </div>
  );
}
