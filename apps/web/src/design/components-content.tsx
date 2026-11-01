import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { ChiefIdentity } from '../chief/chief-identity.js';
import { TraceGroup, type TraceStep, TraceSteps } from '../components/chat/trace-steps.js';
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
  Copy,
  FileText,
  Key,
  Lock,
  Paperclip,
  Restore,
  Server,
  SquarePen,
  X,
} from '../icons/index.js';
import { SEED_TRANSCRIPT } from './agent-transcript.js';
import { Cell, Section, Specimen } from './specimen.js';

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
        <Specimen title="Read-only empty state" note="A hint explains why there is no action">
          <EmptyState
            className="w-full"
            icon={Server}
            title="No machines"
            description="Machines appear here after they register with this server."
            hint={{ icon: Lock, text: 'Only the owner can add machines' }}
          />
        </Specimen>
      </div>
      <Specimen title="Skeleton" note="Card-shaped, two per column">
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
      <Specimen title="Account settings" stage="canvas" className="block">
        <div className="mx-auto flex max-w-160 flex-col gap-4">
          <SettingsHeader
            avatar={<SeededAvatar name="ian" fallback="/avatar-user.png" className="size-14" />}
            title="ian"
            sub="Owner · signed in with GitHub"
            action={
              <Button variant="outline" className="h-8 gap-1.5 px-3 text-ui">
                <SquarePen className="size-4" />
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
      lede="Avatars are seeded from the name, so the same person always looks the same. A busy agent's avatar draws its spiral over a faint copy, so the face never changes."
    >
      <Specimen title="Seeded avatar">
        {[
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
        <Cell label="busy">
          <SeededAvatar
            name="cairn-agent"
            fallback="/avatar-robot-1.svg"
            className="size-10"
            busy
          />
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
        title="Turns"
        code={`<Message className="justify-end">\n  <MessageContent className="max-w-[min(85%,42rem)] items-end">\n    <div className="bubble-gradient rounded-(--cds-radius-xl) px-3 py-2">…</div>\n  </MessageContent>\n</Message>\n<Message><MessageContent>{agent && <ChiefIdentity … />}<TraceGroup … />…reply text</MessageContent></Message>\n<Marker variant="separator"><MarkerContent>Plan approved</MarkerContent></Marker>`}
      >
        <div className="mx-auto flex w-full max-w-170 flex-col gap-4">
          <Message className="justify-end">
            <MessageContent
              className="max-w-[min(85%,42rem)] flex-none items-end gap-0"
              data-testid="turn-user"
            >
              <div className="bubble-gradient w-fit max-w-full rounded-(--cds-radius-xl) px-3 py-2 text-card-title text-foreground">
                Why does pnpm install fail in CI?
              </div>
              <div className="mt-1 flex items-center gap-1 text-content-tertiary">
                <span className="mr-1.5 text-caption tabular-nums">10:42</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 border-none bg-transparent text-content-tertiary"
                  aria-label="Copy"
                >
                  <Copy width={13} height={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 border-none bg-transparent text-content-tertiary"
                  aria-label="Restore to here"
                >
                  <Restore width={13} height={13} />
                </Button>
              </div>
            </MessageContent>
          </Message>
          <Message>
            <MessageContent className="gap-0">
              <Bubble variant="ghost">
                <BubbleContent className="text-card-title">
                  The last commit bumped a version in package.json without updating the lockfile, so
                  the frozen install fails. I will run the install locally and commit the lockfile.
                </BubbleContent>
              </Bubble>
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
          <Marker variant="separator" className="text-meta text-content-tertiary">
            <MarkerContent>Plan approved · 3 steps</MarkerContent>
          </Marker>
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
      <Specimen title="Attachments" note="done, uploading and error states">
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
  { id: 'a', step: { kind: 'run', command: 'pnpm install', exit: null, output: [], secs: 0 } },
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

export function TraceSection() {
  return (
    <Section
      id="trace"
      title="Trace"
      lede="The agent's narration stays body text. Tool activity folds into one grey summary line ending in a triangle; open it for a hairline card with one 36px row per action: a quiet verb, the target in medium weight, and the result at the end. A row opens to its command and output. Never hand-write tool rows."
    >
      <Specimen
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
        title="Chief turn tools"
        note="the same group at compact density under a chief reply"
      >
        <TraceGroup steps={TRACE_TOOLS} density="compact" defaultOpen className="w-120" />
      </Specimen>
    </Section>
  );
}
