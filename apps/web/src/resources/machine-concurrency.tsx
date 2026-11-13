import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, Minus, Plus, Restore } from '../icons/index.js';

const FALLBACK_RANGE = { min: 1, max: 8 };

export const CONCURRENCY_SOURCE_LABEL = {
  manual: '手动',
  measured: '推荐',
  estimate: '估算',
} as const;

function BasisRow({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-content-tertiary">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  );
}

export function MachineConcurrencySelect({
  machine,
  value,
  onPick,
  onReset,
  disabled = false,
}: {
  machine: MachineRow;
  value: number;
  disabled?: boolean;
  onPick: (n: number) => Promise<unknown> | undefined;
  onReset: () => Promise<unknown> | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const range = machine.concurrencyRange ?? FALLBACK_RANGE;
  const outOfRange = value < range.min || value > range.max;
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const inFlight = useRef(0);
  const current = pendingTarget ?? value;
  const track = (target: number | null, req: Promise<unknown> | undefined) => {
    if (!req) return;
    inFlight.current += 1;
    setPendingTarget(target);
    void req.finally(() => {
      inFlight.current -= 1;
      if (inFlight.current === 0) setPendingTarget(null);
    });
  };
  const send = (n: number) => track(n, onPick(n));
  const [draft, setDraft] = useState(String(current));
  const [dirty, setDirty] = useState(false);
  const skipCommit = useRef(false);
  useEffect(() => {
    if (!dirty) setDraft(String(current));
  }, [current, dirty]);
  const clampTo = (n: number) => Math.min(range.max, Math.max(range.min, n));
  const settle = (n: number) => {
    setDraft(String(n));
    setDirty(false);
  };
  const commit = () => {
    if (!dirty) return;
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      settle(current);
      return;
    }
    const next = clampTo(parsed);
    settle(next);
    if (next !== current) send(next);
  };
  const step = (delta: number) => {
    const parsed = Number.parseInt(draft, 10);
    const base = dirty && !Number.isNaN(parsed) ? parsed : current;
    const next = clampTo(clampTo(base) + delta);
    settle(next);
    if (next !== current) send(next);
  };
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();
  const recommended = machine.recommendedConcurrent;
  const hardware = machine.capabilities?.hardware;
  const source = machine.concurrencySource;
  const estimate = source === 'estimate';
  const overridden = machine.maxConcurrentOverridden === true;
  const label =
    source !== undefined
      ? t('并发上限 {n}，{source}', { n: value, source: t(CONCURRENCY_SOURCE_LABEL[source]) })
      : t('并发上限 {n}', { n: value });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          settle(current);
          skipCommit.current = false;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label={label}
            title={label}
            disabled={disabled}
            data-machine-id={machine.id}
            data-testid="machine-concurrency"
            data-concurrency-source={source}
            className="h-8 w-20 cursor-pointer justify-between gap-2 rounded-md px-2.5 text-ui font-normal text-foreground"
          />
        }
      >
        <span className="tabular-nums">{value}</span>
        <ChevronDown width={12} height={12} className="flex-none text-content-tertiary" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        aria-label={t('并发上限')}
        className="w-52 p-(--menu-pad)"
      >
        <div className="flex items-baseline justify-between px-1">
          <span className="text-meta text-content-tertiary">{t('并发上限')}</span>
          <span className="text-ui font-medium tabular-nums text-foreground">{value}</span>
        </div>
        {source !== undefined && (
          <div className="px-1 text-meta text-content-tertiary">
            {t(CONCURRENCY_SOURCE_LABEL[source])}
          </div>
        )}
        <div className="flex items-center gap-1 px-1 py-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('减少并发上限')}
            data-testid="machine-concurrency-dec"
            disabled={current <= range.min && Number.parseInt(draft, 10) <= range.min}
            className="size-7 cursor-pointer rounded-md text-content-secondary hover:bg-(--surface-hover)"
            data-concurrency-action="step"
            onMouseDown={keepFocus}
            onClick={() => step(-1)}
          >
            <Minus width={12} height={12} />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            role="spinbutton"
            aria-label={t('并发上限')}
            aria-valuemin={range.min}
            aria-valuemax={range.max}
            aria-valuenow={value}
            aria-describedby={`concurrency-hint-${machine.id}`}
            min={range.min}
            max={range.max}
            data-testid="machine-concurrency-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                skipCommit.current = true;
                settle(current);
              }
            }}
            onBlur={(e) => {
              const to = e.relatedTarget as HTMLElement | null;
              if (skipCommit.current || to?.dataset.concurrencyAction !== undefined) {
                skipCommit.current = false;
                return;
              }
              commit();
            }}
            className="h-7 flex-1 [appearance:textfield] rounded-md px-1 text-center text-ui tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('增加并发上限')}
            data-testid="machine-concurrency-inc"
            disabled={current >= range.max && Number.parseInt(draft, 10) >= range.max}
            className="size-7 cursor-pointer rounded-md text-content-secondary hover:bg-(--surface-hover)"
            data-concurrency-action="step"
            onMouseDown={keepFocus}
            onClick={() => step(1)}
          >
            <Plus width={12} height={12} />
          </Button>
        </div>
        <div
          id={`concurrency-hint-${machine.id}`}
          data-testid="machine-concurrency-hint"
          className="px-1 pb-1 text-meta text-content-tertiary"
        >
          {t(estimate ? '可选 {min}–{max}（默认档位）' : '可选 {min}–{max}（按内存）', range)}
          {recommended !== undefined && ` · ${t('推荐 {n}', { n: recommended })}`}
          {outOfRange && (
            <span data-testid="machine-concurrency-out-of-range" className="block">
              {t('当前值 {n} 超出可选范围', { n: value })}
            </span>
          )}
        </div>
        {(estimate || hardware?.memoryTotalMb !== undefined) && (
          <div
            className="flex flex-col gap-1 px-1 text-meta"
            data-testid="machine-concurrency-basis"
          >
            {estimate ? (
              <span className="text-content-tertiary">
                {t('未收到能力指纹，按保守默认 {n} 估算', { n: recommended ?? value })}
              </span>
            ) : null}
            {estimate || hardware === undefined || hardware.memoryTotalMb === undefined ? null : (
              <>
                <BasisRow label={t('核数')} value={String(hardware.cpuCores)} />
                <BasisRow
                  label={t('总内存')}
                  value={`${(hardware.memoryTotalMb / 1024).toFixed(1)} GiB`}
                />
                <BasisRow label={t('负载')} value={hardware.loadAvg1.toFixed(2)} />
              </>
            )}
          </div>
        )}
        {overridden && (
          <Button
            variant="ghost"
            data-testid="machine-concurrency-reset"
            data-concurrency-action="reset"
            onMouseDown={keepFocus}
            className="h-7 cursor-pointer justify-start gap-1.5 rounded-md px-1 text-meta font-normal text-content-secondary hover:bg-(--surface-hover)"
            onClick={() => {
              setDirty(false);
              setOpen(false);
              track(recommended ?? null, onReset());
            }}
          >
            <Restore width={12} height={12} className="flex-none text-content-tertiary" />
            {t('恢复推荐')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
