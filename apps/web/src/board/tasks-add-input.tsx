import { cn } from 'cn';
import { ArrowUp, ListChecks, Monitor } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { MachineIcon, machineDisplayName, machineSecondary } from '../components/machine-label.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

type MachineChoice = MachineRow & { id: string };

function machineChoices(machines: readonly MachineRow[]): MachineChoice[] {
  return machines.filter((machine): machine is MachineChoice => typeof machine.id === 'string');
}

function MachineStateDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-testid="tasks-add-machine-state"
      data-online={online}
      className={cn(
        'size-1.5 flex-none rounded-full',
        online ? 'bg-running' : 'rounded-full border border-content-tertiary bg-background',
      )}
    />
  );
}

export function TasksAddInput({
  machines,
  onSubmit,
  onClose,
}: {
  machines: readonly MachineRow[];
  onSubmit: (text: string, machineId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [machineId, setMachineId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const choices = useMemo(() => machineChoices(machines), [machines]);
  const pickerShown = choices.length > 1;
  const picked =
    machineId === null ? null : (choices.find((machine) => machine.id === machineId) ?? null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    if (machineId !== null && !choices.some((machine) => machine.id === machineId))
      setMachineId(null);
  }, [choices, machineId]);
  const trimmed = text.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '' || sending) return;
    setSending(true);
    onSubmit(trimmed, pickerShown ? machineId : null)
      .then(
        () => {
          setText('');
          setMachineId(null);
        },
        (error: unknown) => toastError(t('任务没有添加上，请重试。'), error),
      )
      .finally(() => {
        setSending(false);
        const focused = document.activeElement;
        if (focused === null || focused === document.body || formRef.current?.contains(focused))
          ref.current?.focus();
      });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-none px-2">
      <div
        data-testid="tasks-add-field"
        className="flex h-10.5 min-w-0 flex-1 items-center gap-4 rounded-(--radius-tile) border border-transparent bg-(--hover-1) pr-1.5 pl-2.5 focus-within:[outline:var(--focus-width)_solid_var(--focus-ring)]"
      >
        <span className="flex size-7 flex-none items-center justify-center">
          <span
            data-slot="tasks-add-tile"
            className="flex size-6 items-center justify-center rounded-(--cds-radius-md) bg-(--sidebar-active)"
          >
            <ListChecks aria-hidden className="size-4 text-content-secondary" strokeWidth={1.75} />
          </span>
        </span>
        <Input
          ref={ref}
          data-testid="tasks-add-input"
          aria-label={t('添加任务…')}
          placeholder={t('添加任务…')}
          value={text}
          readOnly={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 outline-hidden text-ui text-foreground placeholder:text-content-tertiary focus-visible:ring-0 md:text-ui dark:bg-transparent"
        />
        {pickerShown && (
          <Select value={machineId} disabled={sending} onValueChange={(next) => setMachineId(next)}>
            <SelectTrigger
              aria-label={t('执行机')}
              data-testid="tasks-add-machine"
              size="sm"
              className="h-7 max-w-28 flex-none gap-1 rounded-md border-transparent bg-transparent px-1.5 py-0 text-meta text-content-secondary shadow-none hover:bg-(--hover-1) dark:bg-transparent dark:hover:bg-(--hover-1)"
            >
              <SelectValue>
                {picked === null ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <Monitor aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
                    <span className="truncate">{t('自动')}</span>
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-1">
                    <MachineIcon machine={picked} className="size-4 flex-none" />
                    <MachineStateDot online={picked.online === true} />
                    <span className="max-w-14 truncate">{machineDisplayName(picked)}</span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              align="end"
              alignItemWithTrigger={false}
              className="w-max min-w-44 max-w-72"
            >
              <SelectItem value={null}>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Monitor aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">{t('自动')}</span>
                  <span className="ms-auto flex-none text-content-tertiary">{t('默认')}</span>
                </span>
              </SelectItem>
              {choices.map((machine) => {
                const secondary = machineSecondary(machine, choices);
                return (
                  <SelectItem
                    key={machine.id}
                    value={machine.id}
                    className="h-auto min-h-8 py-1 [&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:whitespace-normal [&>:first-child]:wrap-anywhere"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <MachineIcon machine={machine} className="size-4 flex-none" />
                      <MachineStateDot online={machine.online === true} />
                      <span className="min-w-0 flex-1 wrap-anywhere">
                        {machineDisplayName(machine)}
                        {secondary !== null && (
                          <span className="text-content-tertiary">{` · ${secondary}`}</span>
                        )}
                      </span>
                      {machine.online !== true && (
                        <span className="ms-auto flex-none text-content-tertiary">{t('离线')}</span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
        <IconTooltip
          label={t('添加')}
          side="bottom"
          trigger={
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              data-testid="tasks-add-submit"
              disabled={trimmed === '' || sending}
              className="size-7 flex-none text-foreground disabled:text-content-tertiary disabled:opacity-100"
            />
          }
        >
          <ArrowUp aria-hidden className="size-5" strokeWidth={1.75} />
        </IconTooltip>
      </div>
    </form>
  );
}
