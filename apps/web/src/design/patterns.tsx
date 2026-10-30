import { cn } from 'cn';
import { useId, useState } from 'react';
import { EmptyState } from '../components/empty-state.js';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { SettingsCard, SettingsRow } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
  PICKER_ROW_SELECTED,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { Check, Clock, Plus, Search, Server } from '../icons/index.js';
import { Section, Specimen } from './specimen.js';

type Column = 'todo' | 'running' | 'attention' | 'done';

interface Task {
  id: number;
  title: string;
  project: string;
  tile: number;
  column: Column;
  step?: number;
}

const COLUMNS: { id: Column; title: string; empty: string }[] = [
  { id: 'todo', title: 'To do', empty: 'Nothing waiting to start' },
  { id: 'running', title: 'Running', empty: 'No agent is working' },
  { id: 'attention', title: 'Needs you', empty: 'Nothing needs you' },
  { id: 'done', title: 'Done', empty: 'Nothing finished in the last 7 days' },
];

const START_TASKS: Task[] = [
  { id: 1, title: 'Map data-orientation variants', project: 'web', tile: 3, column: 'todo' },
  { id: 2, title: 'Add a weekly eval report', project: 'scripts', tile: 2, column: 'todo' },
  {
    id: 3,
    title: 'Wire weekly review packs into eval-weekly.sh',
    project: 'cairn',
    tile: 1,
    column: 'running',
    step: 3,
  },
  {
    id: 4,
    title: 'Keep brake disarming independent of evidence reruns',
    project: 'scripts',
    tile: 2,
    column: 'attention',
  },
  { id: 5, title: 'Sync DESIGN.md with shipped tokens', project: 'web', tile: 3, column: 'done' },
];

const NEXT: Record<Column, { label: string; to: Column } | null> = {
  todo: { label: 'Start', to: 'running' },
  running: { label: 'Finish step', to: 'attention' },
  attention: { label: 'Approve', to: 'done' },
  done: null,
};

const PROVIDER_GROUPS = [
  {
    group: 'Subscriptions',
    items: [
      { id: 'claude', name: 'Claude', tag: 'OAuth' },
      { id: 'codex', name: 'Codex', tag: 'OAuth' },
    ],
  },
  {
    group: 'API keys',
    items: [
      { id: 'anthropic', name: 'Anthropic API', tag: 'Key' },
      { id: 'openai', name: 'OpenAI API', tag: 'Key' },
      { id: 'deepseek', name: 'DeepSeek', tag: 'Key' },
    ],
  },
  { group: 'Other', items: [{ id: 'custom', name: 'Custom endpoint', tag: 'URL' }] },
];

export function BoardPattern() {
  const [tasks, setTasks] = useState(START_TASKS);
  const advance = (task: Task) => {
    const next = NEXT[task.column];
    if (next == null) return;
    setTasks((all) =>
      all.map((t) =>
        t.id === task.id ? { ...t, column: next.to, step: next.to === 'running' ? 1 : t.step } : t,
      ),
    );
  };
  return (
    <Section
      id="board"
      title="Board"
      lede="The workbench: four columns, one question. Use each card's action to walk it from To do to Done."
    >
      <Specimen title="Workbench" stage="canvas" className="block p-0">
        <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
          <span className="text-page font-medium">Workbench</span>
          <Button onClick={() => setTasks(START_TASKS)} variant="ghost">
            Reset
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 bg-background px-6 pt-4 pb-6 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.column === col.id);
            return (
              <div key={col.id} className="min-w-0">
                <div className="mb-2.5 flex items-center gap-2 border-b border-border pb-2">
                  <span className="text-heading font-medium">{col.title}</span>
                  <span className="text-ui text-content-tertiary">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.length === 0 && (
                    <p className="m-0 py-3 text-meta text-content-tertiary">{col.empty}</p>
                  )}
                  {items.map((task) => (
                    <TaskCard key={task.id} task={task} onAdvance={() => advance(task)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Specimen>
    </Section>
  );
}

function TaskCard({ task, onAdvance }: { task: Task; onAdvance: () => void }) {
  const next = NEXT[task.column];
  return (
    <div className="animate-in rounded-(--radius-card) bg-card px-3.5 py-3 shadow-(--e1) transition-shadow duration-200 ease-(--ease-out-expo) fade-in-0 slide-in-from-bottom-1 hover:shadow-(--panel-shadow-hover)">
      <div
        className={cn(
          'text-card-title font-medium',
          task.column === 'done' ? 'font-normal text-content-tertiary' : 'text-foreground',
        )}
      >
        {task.title}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-meta text-content-tertiary">
        <span
          className="grid size-4 place-items-center rounded-(--radius-control) text-caption font-semibold text-(--text-on-accent)"
          style={{ background: `var(--project-tile-${task.tile})` }}
        >
          {task.project.charAt(0).toUpperCase()}
        </span>
        {task.project} · 2h
      </div>
      {task.column === 'running' && (
        <div className="mt-2.5 border-t border-dashed border-border pt-2">
          <div className="flex items-center gap-1.5 text-meta text-running-text">
            <Clock width={12} height={12} />
            codex · running tests
            <span className="ml-auto text-content-tertiary tabular-nums">{task.step ?? 1}/7</span>
          </div>
          <div className="mt-2 h-0.75 overflow-hidden rounded-full bg-(--running-track)">
            <div
              className="h-full bg-running-bar"
              style={{ width: `${((task.step ?? 1) / 7) * 100}%` }}
            />
          </div>
        </div>
      )}
      {task.column === 'attention' && (
        <div className="mt-2.5 flex items-center gap-2 border-t border-dashed border-border pt-2">
          <StatusChip tone="confirm">Awaiting confirmation</StatusChip>
        </div>
      )}
      {next != null && (
        <div className="mt-2 flex justify-end">
          <Button
            size="xs"
            variant={task.column === 'attention' ? 'default' : 'ghost'}
            onClick={onAdvance}
          >
            {next.label}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProvidersPattern() {
  const [providers, setProviders] = useState<{ id: string; name: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const labelId = useId();
  const all = PROVIDER_GROUPS.flatMap((g) => g.items);
  const pickedItem = all.find((p) => p.id === picked);
  const reset = () => {
    setOpen(false);
    setStep(1);
    setQuery('');
    setPicked(null);
    setLabel('');
  };
  const groups = PROVIDER_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())),
  })).filter((g) => g.items.length > 0 || g.group === 'Other');
  return (
    <Section
      id="providers"
      title="Empty to filled"
      lede="A resource page from its first visit: an empty state, a two-step dialog with a grouped picker, a toast, then the list."
    >
      <Specimen title="Providers page" stage="canvas" className="block">
        <div className="mx-auto flex max-w-160 flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-page font-medium">Providers</span>
            {providers.length > 0 && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setProviders([])}>
                  Clear
                </Button>
                <Button onClick={() => setOpen(true)}>
                  <Plus data-icon="inline-start" />
                  Add provider
                </Button>
              </div>
            )}
          </div>
          {providers.length === 0 ? (
            <div className="rounded-(--radius-card) bg-card py-6 shadow-(--e1)">
              <EmptyState
                icon={Server}
                title="No providers yet"
                description="Add a subscription or an API key so agents can run."
                action={{ label: 'Add provider', onClick: () => setOpen(true) }}
              />
            </div>
          ) : (
            <SettingsCard>
              {providers.map((p) => (
                <SettingsRow key={p.id} label={p.label} hint={p.name}>
                  <span className="flex items-center gap-1.5 text-meta text-running-text">
                    <Check width={12} height={12} />
                    Connected
                  </span>
                </SettingsRow>
              ))}
            </SettingsCard>
          )}
        </div>
      </Specimen>
      <DialogShell
        open={open}
        onClose={reset}
        size="l"
        title={step === 1 ? 'Add provider' : `Connect ${pickedItem?.name ?? ''}`}
        subtitle={`Step ${step} of 2`}
        hint={step === 1 ? 'Subscriptions sign in with OAuth' : 'You can rename it later'}
        footer={
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={step === 1 ? reset : () => setStep(1)}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            <Button
              className={DIALOG_PRIMARY_BUTTON}
              disabled={step === 1 ? picked == null : label.trim() === ''}
              onClick={() => {
                if (step === 1) {
                  setLabel(pickedItem?.name ?? '');
                  setStep(2);
                  return;
                }
                setProviders((list) => [
                  ...list,
                  {
                    id: `${picked}-${list.length}`,
                    name: pickedItem?.name ?? '',
                    label: label.trim(),
                  },
                ]);
                toastSuccess(`${label.trim()} connected`);
                reset();
              }}
            >
              {step === 1 ? 'Continue' : 'Connect'}
            </Button>
          </>
        }
      >
        {step === 1 ? (
          <div className="flex flex-col gap-3">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                aria-label="Search providers"
                placeholder="Search providers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            {groups.map((g) => (
              <div key={g.group} className="flex flex-col gap-0.5">
                <div className="px-2 pt-1 pb-1 text-caption font-medium text-content-tertiary">
                  {g.group}
                </div>
                {(g.group === 'Other' ? (PROVIDER_GROUPS[2]?.items ?? []) : g.items).map((p) => (
                  <Button
                    key={p.id}
                    variant="ghost"
                    aria-pressed={picked === p.id}
                    className={cn(
                      'h-10 justify-start gap-3 rounded-(--radius-menu-item) px-2 text-ui font-normal text-foreground hover:bg-card hover:shadow-xs hover:ring-1 hover:ring-border dark:hover:bg-card',
                      picked === p.id && PICKER_ROW_SELECTED,
                    )}
                    onClick={() => setPicked(p.id)}
                    onDoubleClick={() => {
                      setPicked(p.id);
                      setLabel(p.name);
                      setStep(2);
                    }}
                  >
                    <span className="grid size-5.5 place-items-center rounded-(--radius-control) bg-card text-caption font-semibold text-content-secondary ring-1 ring-border">
                      {p.name.charAt(0)}
                    </span>
                    {p.name}
                    <span className="ml-auto text-meta text-content-tertiary">{p.tag}</span>
                  </Button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <FormStack>
            <FormField label="Name" htmlFor={labelId} help="Shown in the model picker.">
              <Input
                id={labelId}
                autoFocus
                className={FORM_CONTROL_CLS}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </FormField>
          </FormStack>
        )}
      </DialogShell>
    </Section>
  );
}
