import { cn } from 'cn';
import { type ReactNode, useId, useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { SegmentedRadio, SegmentedTabs } from '../components/segmented.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Field, FieldError, FieldLabel } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../components/ui/input-group.js';
import { Kbd, KbdGroup } from '../components/ui/kbd.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { StatusChip, type StatusTone } from '../components/ui/status-chip.js';
import { Switch } from '../components/ui/switch.js';
import { TagChip } from '../components/ui/tag-chip.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import {
  ArrowUpDown,
  ChevronDown,
  Grid2x2,
  Kanban,
  ListLines,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
} from '../icons/index.js';
import { Cell, Section, Specimen } from './specimen.js';

const VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const;
const SIZES = ['xs', 'sm', 'default', 'lg'] as const;
const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const;

const TONES: { tone: StatusTone; label: string }[] = [
  { tone: 'idle', label: 'Idle' },
  { tone: 'plan', label: 'Planning' },
  { tone: 'confirm', label: 'Awaiting confirmation' },
  { tone: 'done', label: 'Done' },
  { tone: 'failed', label: 'Failed' },
];

const TAGS = [
  { id: 't1', name: 'frontend', color: 'var(--project-tile-1)' },
  { id: 't2', name: 'infra', color: 'var(--project-tile-3)' },
  { id: 't3', name: 'research', color: 'var(--project-tile-5)' },
  { id: 't4', name: 'a very long tag name that truncates', color: 'var(--project-tile-6)' },
];

const MODELS = [
  { value: 'opus', label: 'Claude Opus 5.5' },
  { value: 'sonnet', label: 'Claude Sonnet 5.5' },
  { value: 'haiku', label: 'Claude Haiku 5.5' },
];

function ChoiceRow({
  label,
  control,
  disabled = false,
}: {
  label: string;
  control: (id: string) => ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5">
      {control(id)}
      <label
        htmlFor={id}
        className={cn('text-ui', disabled ? 'text-content-tertiary' : 'cursor-pointer')}
      >
        {label}
      </label>
    </div>
  );
}

export function ButtonSection() {
  const [busy, setBusy] = useState(false);
  return (
    <Section
      id="button"
      title="Button"
      lede="One primary action per screen. The default tier is the primary button; everything else is a quieter tier or a text button."
    >
      <Specimen
        title="Variants"
        code={`<Button>New task</Button>\n<Button variant="secondary">Filter</Button>\n<Button variant="ghost">Cancel</Button>\n<Button variant="destructive">Delete</Button>`}
      >
        {VARIANTS.map((variant) => (
          <Cell key={variant} label={variant}>
            <Button variant={variant}>{variant === 'destructive' ? 'Delete' : 'New task'}</Button>
          </Cell>
        ))}
      </Specimen>
      <Specimen title="Sizes" note="default is 32px tall">
        {SIZES.map((size) => (
          <Cell key={size} label={size}>
            <Button size={size}>
              <Plus data-icon="inline-start" />
              New task
            </Button>
          </Cell>
        ))}
        {ICON_SIZES.map((size) => (
          <Cell key={size} label={size}>
            <Button size={size} variant="outline" aria-label="Settings">
              <Settings />
            </Button>
          </Cell>
        ))}
      </Specimen>
      <Specimen
        title="States"
        note="Dialog and form buttons narrow to 8px corners"
        code={`<Button className={DIALOG_PRIMARY_BUTTON} disabled>Create</Button>`}
      >
        <Cell label="trailing icon">
          <Button variant="outline">
            <ArrowUpDown data-icon="inline-start" />
            Sort
            <ChevronDown data-icon="inline-end" />
          </Button>
        </Cell>
        <Cell label="disabled">
          <Button disabled>New task</Button>
        </Cell>
        <Cell label="dialog primary, disabled">
          <Button className={DIALOG_PRIMARY_BUTTON} disabled>
            Create
          </Button>
        </Cell>
        <Cell label="click to load">
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              window.setTimeout(() => setBusy(false), 1400);
            }}
          >
            {busy ? 'Starting…' : 'Start task'}
          </Button>
        </Cell>
      </Specimen>
    </Section>
  );
}

export function BadgeSection() {
  return (
    <Section
      id="badge"
      title="Badge and chips"
      lede="Badges count and label. Status chips carry the five task states; tag chips carry the user's own colors. Never mix the two color sources."
    >
      <Specimen title="Badge variants">
        {(['default', 'secondary', 'outline', 'destructive', 'ghost'] as const).map((variant) => (
          <Cell key={variant} label={variant}>
            <Badge variant={variant}>{variant === 'destructive' ? '2 failed' : '12'}</Badge>
          </Cell>
        ))}
        <Cell label="count on accent">
          <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-(--card-button) px-1.5 text-caption font-semibold text-(--text-on-accent)">
            3
          </span>
        </Cell>
      </Specimen>
      <Specimen
        title="Status chip"
        code={`<StatusChip tone="confirm">Awaiting confirmation</StatusChip>`}
      >
        {TONES.map(({ tone, label }) => (
          <Cell key={tone} label={tone}>
            <StatusChip tone={tone}>{label}</StatusChip>
          </Cell>
        ))}
      </Specimen>
      <Specimen title="Tag chip" note="Truncates past 160px">
        {TAGS.map((tag) => (
          <TagChip key={tag.id} tag={tag} />
        ))}
      </Specimen>
    </Section>
  );
}

export function TooltipSection() {
  return (
    <Section
      id="tooltip"
      title="Tooltip and key caps"
      lede="Icon-only buttons explain themselves on hover and focus. Shortcuts ride inside the tooltip as key caps."
    >
      <Specimen
        title="Hover or focus the buttons"
        code={`<Tooltip>\n  <TooltipTrigger render={<Button size="icon" variant="ghost" />}>…</TooltipTrigger>\n  <TooltipContent>Search <Kbd>⌘K</Kbd></TooltipContent>\n</Tooltip>`}
      >
        {[
          { label: 'Search', icon: <Search />, keys: ['⌘', 'K'] },
          { label: 'New task', icon: <SquarePen />, keys: ['C'] },
          { label: 'Delete', icon: <Trash2 />, keys: ['⌫'] },
        ].map((item) => (
          <Tooltip key={item.label}>
            <TooltipTrigger render={<Button size="icon" variant="ghost" aria-label={item.label} />}>
              {item.icon}
            </TooltipTrigger>
            <TooltipContent>
              {item.label}
              <KbdGroup>
                {item.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </KbdGroup>
            </TooltipContent>
          </Tooltip>
        ))}
        <Cell label="inline key caps">
          <span className="text-ui text-content-secondary">
            Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> to search
          </span>
        </Cell>
      </Specimen>
    </Section>
  );
}

export function InputSection() {
  const nameId = useId();
  const repoId = useId();
  const noteId = useId();
  const keyId = useId();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  return (
    <Section
      id="input"
      title="Inputs and forms"
      lede="Labels on top, help below, one narrow column, the primary button on the right. Errors say what is wrong and how to fix it."
    >
      <Specimen title="Fields">
        <Cell label="default">
          <Input className={`${FORM_CONTROL_CLS} w-60`} placeholder="Name this task" />
        </Cell>
        <Cell label="disabled">
          <Input className={`${FORM_CONTROL_CLS} w-60`} value="main" disabled readOnly />
        </Cell>
        <Cell label="with search addon">
          <InputGroup className="w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search tasks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query !== '' && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear" onClick={() => setQuery('')}>
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </Cell>
      </Specimen>
      <Specimen
        title="Form"
        note="FormStack, FormField, FormActions"
        code={`<FormStack>\n  <FormField label="Task name" htmlFor="name" help="…"><Input … /></FormField>\n  <FormActions primary={{ label: 'Create' }} secondary={{ label: 'Cancel', onClick }} />\n</FormStack>`}
      >
        <FormStack className="w-full">
          <FormField
            label="Task name"
            htmlFor={nameId}
            help="Shown on the card and in notifications."
          >
            <Input
              id={nameId}
              className={FORM_CONTROL_CLS}
              placeholder="Fix the flaky login test"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField label="Repository" htmlFor={repoId}>
            <Input id={repoId} className={FORM_CONTROL_CLS} defaultValue="xiechimon/cairn" />
          </FormField>
          <FormField label="Notes" htmlFor={noteId} help="Optional. The agent reads this first.">
            <Textarea
              id={noteId}
              className="text-ui md:text-ui"
              placeholder="What does done look like?"
            />
          </FormField>
          <Field data-invalid="">
            <FieldLabel htmlFor={keyId} className="text-ui font-medium text-foreground">
              API key
            </FieldLabel>
            <Input id={keyId} className={FORM_CONTROL_CLS} defaultValue="sk-" aria-invalid />
            <FieldError className="text-meta">
              This key is too short. Paste the whole key.
            </FieldError>
          </Field>
          <FormActions
            primary={{ label: 'Create task', disabled: name.trim() === '' }}
            secondary={{ label: 'Cancel', onClick: () => setName('') }}
          />
        </FormStack>
      </Specimen>
    </Section>
  );
}

export function ChoiceSection() {
  const [model, setModel] = useState('sonnet');
  const [checks, setChecks] = useState({ tests: true, lint: false });
  const [notify, setNotify] = useState(true);
  const [view, setView] = useState<'list' | 'grid' | 'board'>('board');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [tab, setTab] = useState<'overview' | 'memory' | 'permissions'>('overview');
  const all = checks.tests && checks.lint;
  const some = checks.tests || checks.lint;
  return (
    <Section
      id="choice"
      title="Selection"
      lede="Select for one value from a list, segmented controls for two to four, checkboxes and switches for on or off."
    >
      <Specimen
        title="Select"
        code={`<Select value={v} onValueChange={…}>\n  <SelectTrigger className={FORM_CONTROL_CLS}><SelectValue /></SelectTrigger>\n  <SelectContent>…</SelectContent>\n</Select>`}
      >
        <Cell label="model">
          <Select
            value={model}
            onValueChange={(next) => {
              if (next !== null) setModel(next);
            }}
          >
            <SelectTrigger className={`${FORM_CONTROL_CLS} w-60`} aria-label="Model">
              <SelectValue>{MODELS.find((m) => m.value === model)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent aria-label="Model">
              {MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Cell>
      </Specimen>
      <Specimen title="Checkbox and switch" note="The label is the hit area">
        <div className="flex flex-col gap-3">
          <ChoiceRow
            label="Run all checks"
            control={(id) => (
              <Checkbox
                id={id}
                checked={all}
                indeterminate={some && !all}
                onCheckedChange={(on) => setChecks({ tests: on, lint: on })}
              />
            )}
          />
          <div className="flex flex-col gap-3 pl-6">
            <ChoiceRow
              label="Tests"
              control={(id) => (
                <Checkbox
                  id={id}
                  checked={checks.tests}
                  onCheckedChange={(on) => setChecks((c) => ({ ...c, tests: on }))}
                />
              )}
            />
            <ChoiceRow
              label="Lint"
              control={(id) => (
                <Checkbox
                  id={id}
                  checked={checks.lint}
                  onCheckedChange={(on) => setChecks((c) => ({ ...c, lint: on }))}
                />
              )}
            />
          </div>
          <ChoiceRow
            label="Deploy (needs a machine)"
            disabled
            control={(id) => <Checkbox id={id} disabled />}
          />
        </div>
        <div className="flex flex-col gap-4">
          <ChoiceRow
            label="Notify me when a task needs me"
            control={(id) => <Switch id={id} checked={notify} onCheckedChange={setNotify} />}
          />
          <ChoiceRow
            label="Small switch"
            control={(id) => <Switch id={id} size="sm" defaultChecked />}
          />
          <ChoiceRow label="Disabled" disabled control={(id) => <Switch id={id} disabled />} />
        </div>
      </Specimen>
      <Specimen
        title="Segmented"
        note="SegmentedRadio picks a value, SegmentedTabs switches a view"
        code={`<SegmentedRadio label="Density" value={v} onChange={set} options={[…]} />\n<SegmentedTabs value={v} onChange={set} options={[…]} slide />`}
      >
        <Cell label="radio, text">
          <SegmentedRadio
            label="Density"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Cell>
        <Cell label="radio, icons">
          <SegmentedRadio
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'list', icon: <ListLines />, ariaLabel: 'List' },
              { value: 'grid', icon: <Grid2x2 />, ariaLabel: 'Grid' },
              { value: 'board', icon: <Kanban />, ariaLabel: 'Board' },
            ]}
          />
        </Cell>
        <Cell label="tabs, sliding pill">
          <SegmentedTabs
            label="Agent"
            value={tab}
            onChange={setTab}
            slide
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'memory', label: 'Memory' },
              { value: 'permissions', label: 'Permissions' },
            ]}
          />
        </Cell>
      </Specimen>
    </Section>
  );
}
