import { type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { Check, Search } from '../icons/index.js';
import { SEARCH_INPUT_CLASS } from './model-select-core.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { SeededAvatar } from './ui/seeded-avatar.js';

export interface AgentPickerOption {
  id: string;
  name: string;
  detail: string | null;
  summary: string | null;
  avatarUrl?: string | null;
}

export function agentLines(
  agent: { provider?: string | null; model?: string | null; thinkingLevel?: string | null },
  t: TFunc,
): { detail: string | null; summary: string | null } {
  if (agent.model == null || agent.model === '') return { detail: null, summary: null };
  const summary = `${agent.model} · ${agent.thinkingLevel ?? t('默认')}`;
  const detail =
    agent.provider != null && agent.provider !== '' ? `${agent.provider} · ${summary}` : summary;
  return { detail, summary };
}

const ROW_CLS =
  'h-auto w-full cursor-pointer items-start justify-start gap-2.5 rounded-(--radius-menu-item) border-none px-2 py-1.5 text-left font-normal whitespace-normal text-foreground hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-selected:bg-(--menu-hover)';

interface AgentPickerPanelProps {
  agents: AgentPickerOption[];
  selectedId: string | null;
  onSelect?: (agentId: string) => void;
  onDone: () => void;
  footnote?: string;
  rebindCopy?: string;
  startConfirming?: string;
}

export function AgentPickerPanel({
  agents,
  selectedId,
  onSelect,
  onDone,
  footnote,
  rebindCopy,
  startConfirming,
}: AgentPickerPanelProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<AgentPickerOption | null>(
    agents.find((row) => row.id === startConfirming) ?? null,
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? agents : agents.filter((row) => row.name.toLowerCase().includes(q));
  }, [agents, query]);

  const commit = (row: AgentPickerOption) => {
    onSelect?.(row.id);
    onDone();
  };
  const pick = (row: AgentPickerOption) => {
    if (row.id === selectedId) {
      onDone();
      return;
    }
    if (onSelect == null) {
      blockDemoWrite();
      onDone();
      return;
    }
    if (selectedId != null && rebindCopy != null) {
      setConfirming(row);
      return;
    }
    commit(row);
  };

  if (confirming != null) {
    return (
      <div className="flex flex-col gap-3 p-2" data-testid="agent-picker-confirm">
        <p className="m-0 text-ui text-foreground">
          {t(rebindCopy ?? '').replaceAll('<agent>', confirming.name)}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
            {t('取消')}
          </Button>
          <Button size="sm" onClick={() => commit(confirming)}>
            {t('更换')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="-mx-(--menu-pad) -mt-(--menu-pad) mb-1 flex h-9 items-center gap-2 border-b border-border px-3 text-content-tertiary">
        <Search width={14} height={14} className="flex-none" />
        <Input
          className={SEARCH_INPUT_CLASS}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('分配给…')}
          aria-label={t('分配给…')}
        />
      </div>
      <div
        className="flex max-h-72 flex-col gap-px overflow-y-auto"
        role="listbox"
        aria-label={t('选择执行 Agent')}
      >
        {rows.length === 0 ? (
          <div className="px-2 py-4 text-center text-ui text-content-tertiary">
            {t('没有匹配的 Agent')}
          </div>
        ) : (
          rows.map((row) => {
            const selected = row.id === selectedId;
            return (
              <Button
                key={row.id}
                variant="ghost"
                className={ROW_CLS}
                role="option"
                aria-selected={selected}
                onClick={() => pick(row)}
              >
                <SeededAvatar
                  className="mt-0.5 size-4.5 flex-none"
                  name={row.name}
                  src={row.avatarUrl ?? null}
                  fallback="/avatar-robot-1.svg"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ui font-medium text-foreground">{row.name}</span>
                  {row.detail != null && (
                    <span className="text-meta text-content-tertiary [overflow-wrap:anywhere]">
                      {row.detail}
                    </span>
                  )}
                </span>
                {selected && <Check aria-hidden="true" className="mt-0.5 size-4 flex-none" />}
              </Button>
            );
          })
        )}
      </div>
      {footnote != null && (
        <>
          <div aria-hidden="true" className="mx-2 my-1 h-px bg-border" />
          <p className="m-0 px-2 pt-1 pb-1.5 text-meta text-content-tertiary">{footnote}</p>
        </>
      )}
    </>
  );
}

interface AgentPickerProps extends Omit<AgentPickerPanelProps, 'onDone' | 'startConfirming'> {
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'end';
  testId?: string;
}

export function AgentPicker({
  trigger,
  children,
  align = 'end',
  testId = 'agent-picker',
  ...panel
}: AgentPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align={align}
        sideOffset={8}
        initialFocus={false}
        aria-label={t('选择执行 Agent')}
        className="w-72 gap-0 p-(--menu-pad)"
        data-testid={testId}
      >
        <AgentPickerPanel {...panel} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
