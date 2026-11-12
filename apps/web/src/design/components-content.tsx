import { GitBranch, Terminal } from 'lucide-react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { ProjectNotFound, ProjectsFailed } from '../board/project-not-found.js';
import { ChiefIdentity } from '../chief/chief-identity.js';
import { MessageToolbar } from '../chief/message-toolbar.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { StatusLine } from '../components/chat/status-line.js';
import { TraceGroup, type TraceStep, TraceSteps } from '../components/chat/trace-steps.js';
import { UserMessageBubble } from '../components/chat/user-message-bubble.js';
import { EmptyState } from '../components/empty-state.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import {
  SettingsCard,
  SettingsDangerZone,
  SettingsHeader,
  SettingsRow,
  SettingsSelectTrigger,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '../components/ui/attachment.js';
import { Bubble, BubbleContent } from '../components/ui/bubble.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent } from '../components/ui/marker.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Select, SelectContent, SelectItem, SelectValue } from '../components/ui/select.js';
import { Skeleton } from '../components/ui/skeleton.js';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '../components/ui/trace.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { FileText, Key, Lock, Paperclip, Server, SquarePen, X } from '../icons/index.js';
import { ChipProblems, QueryChip, SyntaxHelp } from '../search/query-chip.js';
import { splitQuery } from '../search/search-query.js';
import { SEED_TRANSCRIPT } from './agent-transcript.js';
import { Cell, Labeled, Section, Specimen } from './specimen.js';

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Simplified Chinese' },
];

export function EmptySection() {
  const [loading, setLoading] = useState(false);
  return (
    <Section
      id="empty"
      title="Empty and loading"
      lede="An empty list says what is missing in one sentence and offers one way forward. While data loads, skeletons hold the shape so nothing jumps."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Specimen
          id="empty-state"
          title="Empty state"
          code={`<EmptyState icon={Key} title="No API keys yet" description="…" action={{ label: 'Create key' }} />`}
        >
          <EmptyState
            className="w-full"
            icon={Key}
            title="No API keys yet"
            description="Create a key to let scripts and other tools start tasks for you."
            action={{ label: 'Create key' }}
          />
        </Specimen>
        <Specimen
          id="read-only-empty-state"
          title="Read-only empty state"
          note="A hint explains why there is no action"
        >
          <EmptyState
            className="w-full"
            icon={Server}
            title="No machines"
            description="Machines appear here after they register with this server."
            hint={{ icon: Lock, text: 'Only the owner can add machines' }}
          />
        </Specimen>
      </div>
      <Specimen id="skeleton" title="Skeleton" note="Card-shaped, two per column">
        <div className="flex w-full flex-col gap-3">
          <div className="mb-1">
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true);
                window.setTimeout(() => setLoading(false), 1600);
              }}
            >
              Reload column
            </Button>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {loading
              ? [0, 1].map((i) => (
                  <div
                    key={i}
                    className="flex h-21 flex-col gap-2.5 rounded-(--radius-card) bg-card px-3.5 py-3 shadow-(--e1)"
                  >
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                ))
              : ['Wire weekly review packs', 'Keep brake disarming independent'].map((t) => (
                  <div
                    key={t}
                    className="flex h-21 flex-col gap-1 rounded-(--radius-card) bg-card px-3.5 py-3 shadow-(--e1)"
                  >
                    <span className="text-card-title font-medium text-foreground">{t}</span>
                    <span className="text-meta text-content-tertiary">cairn · 2h</span>
                  </div>
                ))}
          </div>
        </div>
      </Specimen>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Specimen
          id="project-not-found"
          title="Project not found"
          note="An unknown project link, with close names"
        >
          <MemoryRouter>
            <ProjectNotFound
              unknownId="cairn-old"
              suggestions={{
                kind: 'close',
                projects: [{ id: 'p1', name: 'cairn', lastActiveAt: 2 }],
              }}
              projectHref={() => '#'}
            />
          </MemoryRouter>
        </Specimen>
        <Specimen
          id="project-not-found-recent"
          title="Project not found, recent"
          note="Nothing is close, so the latest projects"
        >
          <MemoryRouter>
            <ProjectNotFound
              unknownId="zzzzzzzz"
              suggestions={{
                kind: 'recent',
                projects: [
                  { id: 'p1', name: 'relay', lastActiveAt: 3 },
                  { id: 'p2', name: 'docs-site', lastActiveAt: 2 },
                  { id: 'p3', name: 'orb', lastActiveAt: 1 },
                ],
              }}
              projectHref={() => '#'}
            />
          </MemoryRouter>
        </Specimen>
        <Specimen
          id="projects-failed-to-load"
          title="Projects failed to load"
          note="Retry, or leave for the Coordinator"
        >
          <MemoryRouter>
            <ProjectsFailed onRetry={() => undefined} />
          </MemoryRouter>
        </Specimen>
      </div>
    </Section>
  );
}

export function SettingsSection() {
  const [lang, setLang] = useState('en');
  const [sound, setSound] = useState(false);
  return (
    <Section
      id="settings"
      title="Settings list"
      lede="A header above one card of equal-height rows. Label left, control right, danger zone in its own card at the end."
    >
      <Specimen id="account-settings" title="Account settings" stage="canvas" className="block">
        <div className="mx-auto flex max-w-160 flex-col gap-4">
          <SettingsHeader
            avatar={<SeededAvatar name="ian" fallback="/avatar-user.png" className="size-14" />}
            title="ian"
            sub="Owner · signed in with GitHub"
            action={
              <Button variant="outline" className="h-8 gap-1.5 px-3 text-ui">
                <SquarePen className="size-5" />
                Edit name
              </Button>
            }
          />
          <SettingsCard>
            <SettingsRow label="Language">
              <Select
                value={lang}
                onValueChange={(next) => {
                  if (next !== null) setLang(next);
                }}
              >
                <SettingsSelectTrigger className={`${FORM_CONTROL_CLS} w-48`}>
                  <SelectValue>{LANGS.find((l) => l.value === lang)?.label}</SelectValue>
                </SettingsSelectTrigger>
                <SelectContent>
                  {LANGS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow label="Sound" hint="Play a chime when a task needs you.">
              <ToggleSwitch checked={sound} onCheckedChange={setSound} aria-label="Sound" />
            </SettingsRow>
          </SettingsCard>
          <SettingsDangerZone
            label="Delete account"
            description="Removes your tasks, keys and machines from this server."
            actionLabel="Delete account"
          />
        </div>
      </Specimen>
    </Section>
  );
}

export function AvatarSection() {
  return (
    <Section
      id="avatar"
      title="Avatar"
      lede="A person or an agent with no picture shows the first letter of the name on a pale tint. The tint is picked from the name, so the same person always looks the same. At 12px it is a plain colour dot."
    >
      <Specimen id="seeded-avatar" title="Seeded avatar">
        {[
          { size: 'size-3', label: '12' },
          { size: 'size-4', label: '16' },
          { size: 'size-6', label: '24' },
          { size: 'size-8', label: '32' },
          { size: 'size-10', label: '40' },
          { size: 'size-14', label: '56' },
        ].map((a) => (
          <Cell key={a.label} label={a.label}>
            <SeededAvatar name="cairn-agent" fallback="/avatar-robot-1.svg" className={a.size} />
          </Cell>
        ))}
        <Cell label="different seeds">
          {['ada', 'grace', 'linus', 'margaret'].map((n) => (
            <SeededAvatar key={n} name={n} fallback="/avatar-user.png" className="size-8" />
          ))}
        </Cell>
      </Specimen>
    </Section>
  );
}

export function ConversationSection() {
  const [files, setFiles] = useState([
    { name: 'error.log', meta: '12 KB', state: 'done' as const },
    { name: 'screenshot.png', meta: 'Uploading…', state: 'uploading' as const },
    { name: 'build.zip', meta: 'Too large, 50 MB max', state: 'error' as const },
  ]);
  return (
    <Section
      id="conversation"
      title="Conversation"
      lede="Message is the row, Bubble is the surface, Marker is a note between turns. Attachments ride in the composer and the stream."
    >
      <Specimen
        id="turns"
        title="Turns"
        code={`<Message className="justify-end">\n  <MessageContent className="max-w-[min(85%,42rem)] items-end">\n    <UserMessageBubble>…</UserMessageBubble>\n  </MessageContent>\n</Message>\n<Message><MessageContent>{agent && <ChiefIdentity … />}<TraceGroup … /><ChatMarkdown bubbles bubbleTools={…} /></MessageContent></Message>\n<StatusLine>Plan approved</StatusLine>`}
      >
        <div className="mx-auto flex w-full max-w-170 flex-col gap-4">
          <Message className="justify-end">
            <MessageContent
              className="max-w-[min(85%,42rem)] flex-none items-end gap-0"
              data-testid="turn-user"
            >
              <UserMessageBubble className="w-fit max-w-full">
                Why does pnpm install fail in CI?
              </UserMessageBubble>
            </MessageContent>
          </Message>
          <Message>
            <MessageContent className="gap-0">
              <div className="text-ui leading-5">
                <ChatMarkdown
                  bubbles
                  text={
                    'The last commit bumped a version in package.json without updating the lockfile.\n\n- the frozen install fails\n- I will commit the lockfile\n\n> Hover a bubble for Reply and More.'
                  }
                  bubbleTools={() => (
                    <MessageToolbar
                      placement="right"
                      testId="turn-reply-tools"
                      stamp="10:43"
                      onReply={() => {}}
                      onCopy={() => {}}
                    />
                  )}
                />
              </div>
            </MessageContent>
          </Message>
          <Message>
            <MessageContent className="gap-1.5">
              <MemoryRouter>
                <ChiefIdentity agent={{ displayName: 'r3-builder', avatarUrl: null }} />
              </MemoryRouter>
              <TraceGroup
                density="compact"
                steps={[
                  {
                    id: 'a',
                    step: { kind: 'tool', name: 'list_machines', status: 'done', secs: 1 },
                  },
                  { id: 'b', step: { kind: 'tool', name: 'open_pr', status: 'done', secs: 3 } },
                ]}
              />
              <Bubble variant="ghost">
                <BubbleContent className="text-card-title">
                  A reply from a bound agent keeps a small identity line above it instead of an
                  avatar column; tool activity folds into the grey line.
                </BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <StatusLine>Plan approved · 3 steps</StatusLine>
          <Marker
            className="rounded-(--radius-card) bg-danger-soft px-3 py-2.5 text-meta text-destructive"
            role="alert"
          >
            <MarkerContent>
              The machine went offline. The task will resume when it is back.
            </MarkerContent>
          </Marker>
        </div>
      </Specimen>
      <Specimen id="attachments" title="Attachments" note="done, uploading and error states">
        {files.map((f) => (
          <Attachment key={f.name} state={f.state}>
            <AttachmentMedia>
              {f.name.endsWith('.log') ? <FileText /> : <Paperclip />}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{f.name}</AttachmentTitle>
              <AttachmentDescription>{f.meta}</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((all) => all.filter((x) => x.name !== f.name))}
              >
                <X />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
        {files.length === 0 && (
          <span className="text-meta text-content-tertiary">All removed.</span>
        )}
      </Specimen>
    </Section>
  );
}

const TRACE_DONE: { id: string; step: TraceStep }[] = [
  { id: 'a', step: { kind: 'search', query: 'open tasks', hits: 4, secs: 2 } },
  { id: 'b', step: { kind: 'read', path: 'apps/web/src/main.tsx', lines: 64, secs: 1 } },
];

const TRACE_RUNNING: { id: string; step: TraceStep }[] = [
  {
    id: 'a',
    step: {
      kind: 'run',
      command: `git diff -- ${'long-command'.repeat(30)}`,
      exit: null,
      output: [],
      secs: 0,
    },
  },
];

const TRACE_FAILED: { id: string; step: TraceStep }[] = [
  {
    id: 'a',
    step: {
      kind: 'run',
      command: 'pnpm install --frozen-lockfile',
      exit: 1,
      output: ['ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"'],
      secs: 4,
    },
  },
  {
    id: 'b',
    step: { kind: 'tool', verb: 'Called', name: 'list_machines', status: 'failed', secs: 4 },
  },
];

const TRACE_PENDING: { id: string; step: TraceStep }[] = [
  { id: 'a', step: { kind: 'wait', text: 'Waiting for the agent…' } },
];

const TRACE_TOOLS: { id: string; step: TraceStep }[] = [
  { id: 'a', step: { kind: 'tool', verb: 'Calling', name: 'create_todo', status: 'running' } },
  { id: 'b', step: { kind: 'tool', name: 'list_machines', status: 'done', secs: 1 } },
  { id: 'c', step: { kind: 'tool', name: 'open_pr', status: 'failed', secs: 3 } },
];

const THINKING_SHORT = 'The lockfile and package.json disagree, so the frozen install fails.';

const THINKING_LONG =
  'The frozen install fails because the last commit bumped vitest in package.json while pnpm-lock.yaml kept the old specifier, so the resolution step cannot be skipped and CI stops before any test runs.\nCheck the commit first.';

const THINKING_MULTILINE = `The frozen install fails at the lockfile check.

1. The last commit touched package.json only.
2. Running pnpm install locally rewrites pnpm-lock.yaml.
3. Push the lockfile on the same branch and wait for CI.`;

export function TraceSection() {
  return (
    <Section
      id="trace"
      title="Trace"
      lede="The agent's narration stays body text. Tool activity folds into one quiet summary row: a 16px state glyph, the work in the secondary ink and a 16px chevron that turns when open; open it for a hairline card with one 36px row per action: a quiet verb, the target in medium weight, and the result at the end. A row opens to its command and output. Never hand-write tool rows."
    >
      <Specimen
        id="trace-states"
        title="Trace states"
        note="done, running (present tense, shimmer on the verb), failed (red count and exit code), pending"
        code={`<TraceSteps defaultOpen steps={[{ id, step: { kind: 'run', command: 'pnpm install', exit: null, output: [], secs: 0 } }]} />`}
      >
        <div className="grid w-full grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          <Cell label="Done">
            <TraceSteps steps={TRACE_DONE} defaultOpen className="w-full" />
          </Cell>
          <Cell label="Running">
            <TraceSteps steps={TRACE_RUNNING} defaultOpen className="w-full" />
          </Cell>
          <Cell label="Failed: the exit code opens by default">
            <TraceSteps steps={TRACE_FAILED} defaultOpen className="w-full" />
          </Cell>
          <Cell label="Pending">
            <TraceSteps steps={TRACE_PENDING} className="w-full" />
          </Cell>
        </div>
      </Specimen>
      <Specimen
        id="step-kinds"
        title="Step kinds"
        note="think, search, read, say, run (opens to command and output), edit, push, check"
      >
        <TraceSteps
          steps={SEED_TRANSCRIPT.map((step, i) => ({ id: i, step }))}
          defaultOpen
          className="max-w-160"
        />
      </Specimen>
      <Specimen
        id="coordinator-turn-tools"
        title="Coordinator turn tools"
        note="compact rows respond immediately without shadows; summary has no copy action"
      >
        <TraceGroup
          steps={TRACE_TOOLS}
          density="compact"
          defaultOpen
          className="w-120 max-w-full"
        />
      </Specimen>
      <Specimen
        id="thinking-rows"
        title="Thinking rows"
        note="collapsed to a one-line preview, a long first line cut at 150 characters, then opened to the full reasoning"
      >
        <div className="flex w-full max-w-160 flex-col gap-5">
          <Labeled label="Collapsed: first line as the preview">
            <ThinkingRow text={THINKING_SHORT} />
          </Labeled>
          <Labeled label="Collapsed: a long first line is cut with an ellipsis">
            <ThinkingRow text={THINKING_LONG} />
          </Labeled>
          <Labeled label="Collapsed at 320px, a narrow panel">
            <div className="w-80 max-w-full">
              <ThinkingRow text={THINKING_LONG} />
            </div>
          </Labeled>
          <Labeled label="Open: the title becomes Thinking, the full text follows">
            <ThinkingRow text={THINKING_MULTILINE} defaultOpen />
          </Labeled>
        </div>
      </Specimen>
      <Specimen
        id="trace-lines"
        title="Trace lines"
        note="the primitives behind every trace row: default, running with shimmer, error, pending, and a collapsible with a detail panel"
      >
        <div className="flex w-full max-w-160 flex-col gap-5">
          <Cell label="Default, with icon and trailing description">
            <Trace>
              <TraceLine>
                <TraceIcon>
                  <FileText />
                </TraceIcon>
                <TraceTitle>Read apps/server/src/routes-machine.ts</TraceTitle>
                <TraceDescription>214 lines</TraceDescription>
              </TraceLine>
            </Trace>
          </Cell>
          <Cell label="Running: shimmer on the title">
            <Trace>
              <TraceLine status="running">
                <TraceIcon>
                  <Terminal />
                </TraceIcon>
                <TraceTitle>Running pnpm exec vitest run --changed</TraceTitle>
                <TraceDescription>8s</TraceDescription>
              </TraceLine>
            </Trace>
          </Cell>
          <Cell label="Error">
            <Trace>
              <TraceLine status="error">
                <TraceIcon>
                  <Terminal />
                </TraceIcon>
                <TraceTitle>pnpm install --frozen-lockfile</TraceTitle>
                <TraceDescription>exit 1</TraceDescription>
              </TraceLine>
            </Trace>
          </Cell>
          <Cell label="Pending">
            <Trace>
              <TraceLine status="pending">
                <TraceIcon>
                  <GitBranch />
                </TraceIcon>
                <TraceTitle>Push fix/lockfile</TraceTitle>
              </TraceLine>
            </Trace>
          </Cell>
          <Cell label="Collapsed at 320px: a long title truncates, the description stays">
            <div className="w-80 max-w-full">
              <Trace>
                <TraceLine>
                  <TraceIcon>
                    <FileText />
                  </TraceIcon>
                  <TraceTitle>
                    Read apps/server/src/services/merge-gate/model-identity.ts
                  </TraceTitle>
                  <TraceDescription>1,204 lines</TraceDescription>
                </TraceLine>
              </Trace>
            </div>
          </Cell>
          <Cell label="Collapsible: open, with the detail panel">
            <Trace>
              <TraceCollapsible defaultOpen>
                <TraceCollapsibleTrigger>
                  <TraceLine>
                    <TraceIcon>
                      <Terminal />
                    </TraceIcon>
                    <TraceTitle>pnpm install</TraceTitle>
                    <TraceDescription>12s</TraceDescription>
                  </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent>
                  <pre className="m-0 font-mono text-code whitespace-pre-wrap">
                    {'Lockfile is up to date, resolution step is skipped\nDone in 11.2s'}
                  </pre>
                </TraceCollapsibleContent>
              </TraceCollapsible>
            </Trace>
          </Cell>
        </div>
      </Specimen>
    </Section>
  );
}

const GALLERY_CHIPS = splitQuery('is:failed project:cairn cost:lots ', 0).chips;

export function SearchSyntaxSection() {
  return (
    <Section
      id="search-syntax"
      title="Search filters"
      lede="Typed filters become chips in the field. A value that cannot match is flagged on its chip with a reason, and the footer opens the syntax list."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Specimen id="chips" title="Chips" note="Valid, then flagged with its reason">
          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {GALLERY_CHIPS.map((chip, index) => (
                <QueryChip
                  key={chip.raw}
                  chip={chip}
                  problem={index === 2 ? 'bad_cost' : null}
                  onRemove={() => undefined}
                />
              ))}
            </div>
            <ChipProblems chips={GALLERY_CHIPS} problems={[null, null, 'bad_cost']} />
          </div>
        </Specimen>
        <Specimen
          id="syntax-help"
          title="Syntax help"
          note="Opened from the palette footer or the Activity field"
        >
          <SyntaxHelp className="w-full" />
        </Specimen>
      </div>
    </Section>
  );
}
