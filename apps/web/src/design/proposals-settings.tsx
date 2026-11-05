import { cn } from 'cn';
import { Brain, ChevronLeft, Cpu, Gauge, Route, Settings2, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProjectAvatar } from '../board/project-avatar.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { ListCard, ListRow } from '../components/list-card.js';
import { SettingsCard, SettingsDangerZone, SettingsRow } from '../components/settings-list.js';
import { StatStrip } from '../components/stat-strip.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_FACE, DIALOG_TITLE_CLS, DialogFootRow } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { Textarea } from '../components/ui/textarea.js';
import { ProjectBaseBranchSelect } from '../pages/project-base-branch-select.js';
import { SHEET_PANEL } from '../pages/shell.js';
import { GALLERY_PROJECT } from './product-fixtures.js';
import { DraftNote, NotBuilt, OptionTitle, PhoneFrame, Shot } from './proposals-parts.js';
import { Section, Specimen } from './specimen.js';

type TabId = 'general' | 'memory' | 'environment' | 'usage' | 'routing';

const TABS: { id: TabId; label: string; icon: ReactNode; soon?: string }[] = [
  { id: 'general', label: 'General', icon: <Settings2 /> },
  { id: 'memory', label: 'Memory', icon: <Brain />, soon: 'Not built yet' },
  { id: 'environment', label: 'Environment', icon: <Cpu /> },
  { id: 'usage', label: 'Usage', icon: <Gauge />, soon: 'Not built yet' },
  { id: 'routing', label: 'Routing', icon: <Route />, soon: 'After D60 PR 8' },
];

const MEMORIES = [
  {
    text: 'Run pnpm lint and pnpm typecheck before every push; the pre-push hook only runs fast checks.',
    from: 'Learned in #431 · 2d ago',
  },
  {
    text: 'The gallery snapshots are only accepted from CI renders, never from a Mac.',
    from: 'Learned in #402 · 6d ago',
  },
  { text: 'Owner-routed PRs are never auto-merged.', from: 'Learned in #377 · 3w ago' },
];

const THREAD_COSTS = [
  ['Move routing rules behind the work policy', '$4.10', '1.1M tokens'],
  ['Fold finished turns in the transcript', '$1.84', '480k tokens'],
  ['Weekly flaky-test sweep', '$2.47', '690k tokens'],
  ['Flip detector', '$0.62', '150k tokens'],
];

function PlainSelect({ value, items }: { value: string; items: string[] }) {
  return (
    <Select value={value} onValueChange={() => undefined}>
      <SelectTrigger aria-label={value} className={cn(FORM_CONTROL_CLS, 'w-56')}>
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PaneTitle({
  title,
  tag,
  children,
}: {
  title: string;
  tag?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <h3 className="m-0 font-heading text-heading font-title text-foreground">{title}</h3>
        {tag}
      </div>
      {children != null && <p className="m-0 text-meta text-content-tertiary">{children}</p>}
    </div>
  );
}

function General({ compact }: { compact: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <PaneTitle title="General" />
      <SettingsCard>
        <SettingsRow label="Name and icon">
          <ProjectAvatar
            name="cairn"
            tone={0}
            icon="folder"
            color="moss"
            className="size-8 rounded-lg"
          />
          <Input
            aria-label="Name"
            defaultValue="cairn"
            className={cn(FORM_CONTROL_CLS, compact ? 'w-32' : 'w-56')}
          />
        </SettingsRow>
        <SettingsRow label="Description" hint="Shown on the project home">
          <Textarea
            aria-label="Description"
            defaultValue="The agent team workbench."
            className="min-h-16 w-72 max-w-full"
          />
        </SettingsRow>
        <SettingsRow
          label="Instructions"
          hint="Read by the Coordinator and every thread in this project"
        >
          <Textarea
            aria-label="Instructions"
            defaultValue="Keep pull requests small. Run the related tests before pushing."
            className="min-h-24 w-72 max-w-full"
          />
        </SettingsRow>
        <SettingsRow label="Concurrency" hint="Threads running at once">
          <PlainSelect
            value="Follow machine limit"
            items={['Follow machine limit', '1', '2', '4']}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard>
        <SettingsRow
          label="Pause project"
          hint="Stops new threads from starting; running ones finish"
        >
          <NotBuilt />
          {!compact && (
            <Button variant="outline" disabled>
              Pause
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label="Archive project" hint="Hides it from the sidebar and keeps its threads">
          <NotBuilt />
          {!compact && (
            <Button variant="outline" disabled>
              Archive
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>
      <SettingsDangerZone
        label="Delete project"
        description="Removes the project and its threads. This cannot be undone."
        actionLabel="Delete"
      />
    </div>
  );
}

function Memory() {
  return (
    <div className="flex flex-col gap-5">
      <PaneTitle title="Memory" tag={<NotBuilt />}>
        What the Coordinator learned in this project. Memories stay here until you promote them to
        the team.
      </PaneTitle>
      <ListCard>
        {MEMORIES.map((memory) => (
          <ListRow
            key={memory.text}
            title={<span className="block whitespace-normal font-normal">{memory.text}</span>}
            subtitle={memory.from}
            trailing={
              <span className="flex gap-1.5">
                <Button size="xs" variant="outline">
                  Promote to team
                </Button>
                <Button size="xs" variant="ghost" className="text-content-secondary">
                  Forget
                </Button>
              </span>
            }
            className="items-start"
          />
        ))}
      </ListCard>
    </div>
  );
}

function Environment() {
  return (
    <div className="flex flex-col gap-5">
      <PaneTitle title="Environment" />
      <SettingsCard>
        <SettingsRow label="Repository">xiechimon/cairn</SettingsRow>
        <SettingsRow label="Base branch">
          <ProjectBaseBranchSelect project={GALLERY_PROJECT} />
        </SettingsRow>
        <SettingsRow label="Machines" hint="Where this project's threads may run">
          <span className="flex flex-col items-end gap-0.5 text-meta">
            <span className="text-foreground">omarchy · online</span>
            <span className="text-content-tertiary">This Mac · online</span>
          </span>
        </SettingsRow>
      </SettingsCard>
      <PaneTitle title="Project secrets" tag={<NotBuilt />}>
        Today every thread reads the team's secrets. Project secrets will override them by name.
      </PaneTitle>
      <SettingsCard>
        <SettingsRow label="NPM_TOKEN" hint="Overrides the team value">
          <span className="font-mono text-code text-content-tertiary">••••••••</span>
          <Button variant="outline" size="sm" disabled>
            Edit
          </Button>
        </SettingsRow>
        <SettingsRow label="Add a project secret">
          <Button variant="outline" size="sm" disabled>
            Add
          </Button>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}

function Usage() {
  return (
    <div className="flex flex-col gap-5">
      <PaneTitle title="Usage" tag={<NotBuilt>Not built yet · placeholder data</NotBuilt>}>
        Last 30 days
      </PaneTitle>
      <StatStrip
        items={[
          { value: '4.2M', label: 'Tokens' },
          { value: '86%', label: 'Cache hit' },
          { value: '$38.20', label: 'Cost' },
        ]}
      />
      <ListCard>
        {THREAD_COSTS.map(([title, cost, tokens]) => (
          <ListRow
            key={title}
            title={title}
            subtitle={tokens}
            trailing={<span className="font-mono text-code">{cost}</span>}
          />
        ))}
      </ListCard>
    </div>
  );
}

function Routing() {
  return (
    <div className="flex flex-col gap-5">
      <PaneTitle title="Routing" tag={<NotBuilt>After D60 PR 8</NotBuilt>}>
        Pick which model and account each kind of work uses in this project. Until then the team
        routing applies.
      </PaneTitle>
      <SettingsCard>
        <SettingsRow label="Planning" hint="Team default: claude-opus-5-5">
          <Button variant="outline" size="sm" disabled>
            Override
          </Button>
        </SettingsRow>
        <SettingsRow label="Implementation" hint="Team default: gpt-6.1-sol">
          <Button variant="outline" size="sm" disabled>
            Override
          </Button>
        </SettingsRow>
        <SettingsRow label="Review" hint="Always the other vendor">
          <Button variant="outline" size="sm" disabled>
            Override
          </Button>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}

function Pane({ id, compact }: { id: TabId; compact: boolean }) {
  switch (id) {
    case 'general':
      return <General compact={compact} />;
    case 'memory':
      return <Memory />;
    case 'environment':
      return <Environment />;
    case 'usage':
      return <Usage />;
    case 'routing':
      return <Routing />;
  }
}

function SettingsTabs({
  variant,
  initial,
  compact = false,
}: {
  variant: 'modal' | 'page';
  initial: TabId;
  compact?: boolean;
}) {
  const [tab, setTab] = useState<TabId>(initial);
  const rail = (
    <TabsList
      variant="line"
      aria-label="Project settings"
      className={cn(
        'h-auto flex-none justify-start gap-0.5 p-0',
        compact
          ? 'w-full overflow-x-auto border-b border-border px-3 py-2'
          : 'w-52 flex-col items-stretch border-r border-border p-2.5',
      )}
    >
      {TABS.map((item) => (
        <TabsTrigger
          key={item.id}
          value={item.id}
          className={cn(
            'h-8 flex-none justify-start gap-2.5 rounded-(--radius-menu-item) px-2.5 text-ui font-normal text-content-secondary data-active:bg-(--menu-hover) data-active:font-medium data-active:text-foreground after:hidden',
            compact && 'w-auto flex-none',
          )}
        >
          {item.icon}
          {item.label}
          {item.soon != null && !compact && (
            <span
              className="ml-auto size-1.5 rounded-full bg-content-tertiary/50"
              title={item.soon}
            />
          )}
        </TabsTrigger>
      ))}
      {!compact && (
        <span className="mt-2 flex items-center gap-1.5 px-2.5 text-caption text-content-tertiary">
          <span className="size-1.5 rounded-full bg-content-tertiary/50" />
          Backend not built yet
        </span>
      )}
    </TabsList>
  );
  return (
    <Tabs
      value={tab}
      onValueChange={(next) => setTab(next as TabId)}
      orientation={compact ? 'horizontal' : 'vertical'}
      className={cn(
        'min-h-0 flex-1 gap-0',
        compact ? 'flex-col' : 'flex-row',
        variant === 'page' && !compact && 'max-w-240',
      )}
    >
      {rail}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5 max-[640px]:px-4">
        {TABS.map((item) => (
          <TabsContent key={item.id} value={item.id}>
            <Pane id={item.id} compact={compact} />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}

function ModalSurface({
  initial,
  compact = false,
  className,
}: {
  initial: TabId;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative flex flex-col overflow-hidden', DIALOG_FACE, className)}>
      <div className="flex flex-none items-center gap-3 border-b border-border py-3.5 pr-13 pl-5">
        <ProjectAvatar
          name="cairn"
          tone={0}
          icon="folder"
          color="moss"
          className="size-6 rounded-md"
        />
        <h2 className={cn('m-0', DIALOG_TITLE_CLS)}>cairn settings</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close"
          className="absolute top-4 right-4 text-content-tertiary"
        >
          <X />
        </Button>
      </div>
      <SettingsTabs variant="modal" initial={initial} compact={compact} />
      <DialogFootRow hint="Changes apply when you save">
        <Button variant="ghost" className="text-content-secondary">
          Cancel
        </Button>
        <Button>Save</Button>
      </DialogFootRow>
    </div>
  );
}

function PageSurface({
  initial,
  compact = false,
  className,
}: {
  initial: TabId;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(SHEET_PANEL, 'm-0 flex-col', className)}>
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border px-5 max-[640px]:pl-14">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to cairn"
          className="text-content-secondary"
        >
          <ChevronLeft />
        </Button>
        <h1 className="m-0 mr-auto font-serif text-page font-semibold text-foreground">
          Project settings
        </h1>
        <Button variant="ghost" className="text-content-secondary">
          Cancel
        </Button>
        <Button>Save</Button>
      </header>
      <SettingsTabs variant="page" initial={initial} compact={compact} />
    </div>
  );
}

const OTHER_TABS: TabId[] = ['memory', 'environment', 'usage', 'routing'];

export function ProposalSettingsSection() {
  return (
    <Section
      id="draft-settings"
      title="#2325 Project settings"
      lede="Today a full page of stacked cards. The draft groups it into five tabs. A small dashed tag marks sections whose backend does not exist yet, so the scope is visible."
    >
      <Specimen
        title="A. Tabbed modal with a left rail"
        note="Opened from the project home's settings button, so the home stays behind it"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="settings-a-general">
          <OptionTitle option="A" title="General" />
          <ModalSurface initial="general" className="h-170 w-full max-w-250" />
        </Shot>
        <Shot id="settings-a-tabs" className="flex flex-col gap-6">
          {OTHER_TABS.map((tab) => (
            <div key={tab} className="flex flex-col gap-2">
              <span className="text-caption text-content-tertiary">
                {TABS.find((item) => item.id === tab)?.label}
              </span>
              <ModalSurface initial={tab} className="h-150 w-full" />
            </div>
          ))}
        </Shot>
        <Shot id="settings-a-phone" className="items-start">
          <OptionTitle option="A" title="Phone: full-screen sheet, rail becomes a tab strip" />
          <PhoneFrame>
            <ModalSurface initial="general" compact className="h-full rounded-none" />
          </PhoneFrame>
        </Shot>
      </Specimen>
      <Specimen
        title="B. Keep a page, add a left rail"
        note="Route stays /app/project/:id/settings; tabs become sub-routes"
        stage="canvas"
        className="flex-col flex-nowrap"
      >
        <Shot id="settings-b-general">
          <OptionTitle option="B" title="General" />
          <PageSurface initial="general" className="h-170 w-full" />
        </Shot>
        <Shot id="settings-b-tabs" className="flex flex-col gap-6">
          {OTHER_TABS.map((tab) => (
            <div key={tab} className="flex flex-col gap-2">
              <span className="text-caption text-content-tertiary">
                {TABS.find((item) => item.id === tab)?.label}
              </span>
              <PageSurface initial={tab} className="h-150 w-full" />
            </div>
          ))}
        </Shot>
        <Shot id="settings-b-phone" className="items-start">
          <OptionTitle option="B" title="Phone" />
          <PhoneFrame>
            <PageSurface initial="general" compact className="h-full rounded-none shadow-none" />
          </PhoneFrame>
        </Shot>
      </Specimen>
      <DraftNote>
        Tags: Memory and Usage have no backend; Pause, Archive and project secrets are placeholders;
        Routing waits for D60 PR 8. Concurrency, base branch and Delete are the shipped controls.
      </DraftNote>
    </Section>
  );
}
