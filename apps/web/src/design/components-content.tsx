import { useState } from 'react';
import { EmptyState } from '../components/empty-state.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import {
  SettingsCard,
  SettingsDangerZone,
  SettingsHeader,
  SettingsRow,
  SettingsSegmented,
  SettingsSelectTrigger,
} from '../components/settings-list.js';
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
import { Message, MessageAvatar, MessageContent } from '../components/ui/message.js';
import { Panel, PanelLabel, PanelRow, PanelValue } from '../components/ui/panel.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Select, SelectContent, SelectItem, SelectValue } from '../components/ui/select.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Switch } from '../components/ui/switch.js';
import { FileText, Key, Lock, Paperclip, X } from '../icons/index.js';
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
            icon={Lock}
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
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
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
            action={<Button variant="ghost">Edit name</Button>}
          />
          <SettingsCard>
            <SettingsRow label="Density" hint="Compact fits more cards on the board.">
              <SettingsSegmented
                label="Density"
                value={density}
                onChange={setDensity}
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
              />
            </SettingsRow>
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
              <Switch checked={sound} onCheckedChange={setSound} aria-label="Sound" />
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

export function PanelSection() {
  return (
    <Section
      id="panel"
      title="Panel and avatar"
      lede="Panels hold resting key-value content. Avatars are seeded from the name, so the same person always looks the same."
    >
      <Specimen title="Panel" note="quiet and outlined tiers">
        {(['quiet', 'outlined'] as const).map((variant) => (
          <Cell key={variant} label={variant}>
            <Panel variant={variant} className="w-64 px-4 py-2">
              {[
                ['Branch', 'fix/frozen-lockfile'],
                ['Machine', 'omarchy'],
                ['Started', '12 min ago'],
              ].map(([k, v]) => (
                <PanelRow key={k} className="flex justify-between py-1.5">
                  <PanelLabel className="text-meta text-content-tertiary">{k}</PanelLabel>
                  <PanelValue className="text-meta text-foreground">{v}</PanelValue>
                </PanelRow>
              ))}
            </Panel>
          </Cell>
        ))}
      </Specimen>
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
        code={`<Message>\n  <MessageAvatar><SeededAvatar … /></MessageAvatar>\n  <MessageContent>\n    <Bubble variant="secondary"><BubbleContent>…</BubbleContent></Bubble>\n  </MessageContent>\n</Message>\n<Marker variant="separator"><MarkerContent>Plan approved</MarkerContent></Marker>`}
      >
        <div className="mx-auto flex w-full max-w-170 flex-col gap-4">
          <Message className="justify-end gap-2.5">
            <MessageContent className="items-end">
              <Bubble variant="secondary" className="max-w-md">
                <BubbleContent className="rounded-(--radius-bubble) border-0 px-3 py-2.5 text-card-title leading-6">
                  Why does pnpm install fail in CI?
                </BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <Message className="gap-2.5">
            <MessageAvatar>
              <SeededAvatar name="chief" fallback="/avatar-robot-1.svg" className="size-6" />
            </MessageAvatar>
            <MessageContent>
              <Bubble variant="ghost">
                <BubbleContent className="text-card-title leading-6">
                  The last commit bumped a version in package.json without updating the lockfile, so
                  the frozen install fails. I will run the install locally and commit the lockfile.
                </BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <Marker variant="separator" className="text-meta text-content-tertiary">
            <MarkerContent>Plan approved · 3 steps</MarkerContent>
          </Marker>
          <Marker className="justify-center text-meta text-destructive" role="alert">
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
