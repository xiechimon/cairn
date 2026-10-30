import { useId, useState } from 'react';
import { ClaudeMark, GeminiMark, PiMark } from '../components/brand-marks.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { LiveRow } from '../components/chat/live-row.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { ProfileHeader } from '../components/profile-card.js';
import {
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
} from '../components/ui/message-scroller.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Separator } from '../components/ui/separator.js';
import type { ModelOption } from '../fixtures/records.js';
import { ArrowDown, Copy, Download, Settings, Trash2 } from '../icons/index.js';
import { AgentModelSelect, AgentRuntimeSelect } from '../routes/agent-model-select.js';
import { Cell, Section, Specimen } from './specimen.js';

const MODEL_OPTIONS: ModelOption[] = [
  {
    provider: 'claude-code',
    providerLabel: 'Claude Code',
    modelId: 'claude-opus-5-5',
    modelName: 'Claude Opus 5.5',
  },
  {
    provider: 'claude-code',
    providerLabel: 'Claude Code',
    modelId: 'claude-sonnet-5-5',
    modelName: 'Claude Sonnet 5.5',
  },
  { provider: 'codex', providerLabel: 'Codex', modelId: 'gpt-6.1-sol', modelName: 'GPT-6.1 Sol' },
];

const SEED_MESSAGES = [
  'Read the failing CI log for the lockfile check.',
  'The last commit bumped a version in package.json without the lockfile.',
  'Running pnpm install locally to regenerate pnpm-lock.yaml.',
  'Lockfile regenerated; 1 file changed.',
  'Committing the lockfile and pushing the branch.',
  'CI is green on the new head.',
];

export function StructureSection() {
  const nameId = useId();
  const [name, setName] = useState('ian');
  return (
    <Section
      id="structure"
      title="Structure primitives"
      lede="The small pieces the larger ones are built from: labels, dividers, the layout card shell, and the editable profile header."
    >
      <Specimen
        title="Label and separator"
        note="Label pairs with a control through htmlFor; Separator replaces hr and border-t divs"
        code={`<Label htmlFor="name">Display name</Label>\n<Input id="name" />\n<Separator />\n<Separator orientation="vertical" />`}
      >
        <div className="flex w-72 flex-col gap-2">
          <Label htmlFor={nameId} className="text-ui font-medium text-foreground">
            Display name
          </Label>
          <Input id={nameId} className={FORM_CONTROL_CLS} defaultValue="ian" />
        </div>
        <div className="flex w-72 flex-col gap-3 text-meta text-content-tertiary">
          <span>Above the line</span>
          <Separator />
          <span>Below the line</span>
        </div>
        <div className="flex h-8 items-center gap-3 text-ui text-content-secondary">
          Files
          <Separator orientation="vertical" />
          History
          <Separator orientation="vertical" />
          Plan
        </div>
      </Specimen>
      <Specimen
        title="Card (layout shell)"
        note="The registry Card; real cards are per-face (task card, settings card) and use --radius-card"
        stage="canvas"
      >
        <Card className="w-96 rounded-(--radius-card) ring-border">
          <CardHeader>
            <CardTitle className="text-card-title font-medium">Weekly eval report</CardTitle>
            <CardDescription className="text-meta text-content-tertiary">
              Runs every Monday at 09:00
            </CardDescription>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="Settings">
                <Settings />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="text-ui text-content-secondary">
            Collects the review packs from the last seven days and posts a summary to the team
            thread.
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost">Pause</Button>
            <Button>Run now</Button>
          </CardFooter>
        </Card>
      </Specimen>
      <Specimen
        title="Profile header"
        note="Click Edit name, type, press Enter to save or Escape to cancel"
        code={`<ProfileHeader avatar={…} name={name} sub="Avatar and name" onRename={setName} />`}
      >
        <div className="w-full max-w-140">
          <ProfileHeader
            avatar={<SeededAvatar name={name} fallback="/avatar-user.png" className="size-14" />}
            name={name}
            sub="Avatar and name"
            onRename={setName}
          />
        </div>
      </Specimen>
    </Section>
  );
}

export function IdentitySection() {
  const [runtime, setRuntime] = useState<string | null>('claude-code');
  const [model, setModel] = useState<string | null>('claude-sonnet-5-5');
  return (
    <Section
      id="identity"
      title="Agents and models"
      lede="How agents, runtimes and models show up: brand marks for the runtimes, the runtime and model pickers from the agent settings, and icon-only actions with a tooltip."
    >
      <Specimen title="Brand marks" note="Runtime logos, drawn in currentColor">
        {[
          { label: 'Claude', Mark: ClaudeMark },
          { label: 'Gemini', Mark: GeminiMark },
          { label: 'Pi', Mark: PiMark },
        ].map(({ label, Mark }) => (
          <Cell key={label} label={label}>
            <span className="grid size-10 place-items-center rounded-(--radius-control) bg-secondary text-foreground">
              <Mark width={20} height={20} />
            </span>
            <Mark width={16} height={16} className="text-content-secondary" />
          </Cell>
        ))}
      </Specimen>
      <Specimen
        title="Runtime and model pickers"
        note="The same pickers the agent settings page uses; the model list follows the runtime"
        stage="canvas"
        className="block"
      >
        <div className="mx-auto max-w-160">
          <SettingsCard>
            <SettingsRow label="Runtime">
              <AgentRuntimeSelect
                value={runtime}
                options={MODEL_OPTIONS}
                onPick={(next) => {
                  setRuntime(next);
                  setModel(null);
                }}
                prefix="gallery-runtime"
                triggerClassName={SETTINGS_SELECT_TRIGGER_CLS}
              />
            </SettingsRow>
            <SettingsRow label="Model">
              <AgentModelSelect
                provider={runtime}
                modelId={model}
                options={MODEL_OPTIONS}
                onPick={setModel}
                prefix="gallery-model"
                triggerClassName={SETTINGS_SELECT_TRIGGER_CLS}
              />
            </SettingsRow>
          </SettingsCard>
        </div>
      </Specimen>
      <Specimen
        title="Icon tooltip"
        note="IconTooltip names an icon-only button for sight and for screen readers"
        code={`<IconTooltip label="Copy" trigger={<Button variant="ghost" size="icon" />}>\n  <Copy />\n</IconTooltip>`}
      >
        {[
          { label: 'Copy', icon: <Copy /> },
          { label: 'Download', icon: <Download /> },
          { label: 'Delete', icon: <Trash2 /> },
        ].map((item) => (
          <IconTooltip
            key={item.label}
            label={item.label}
            trigger={<Button variant="ghost" size="icon" />}
          >
            {item.icon}
          </IconTooltip>
        ))}
        <IconTooltip
          label="Settings"
          side="bottom"
          trigger={<Button variant="outline" size="icon" />}
        >
          <Settings />
        </IconTooltip>
      </Specimen>
    </Section>
  );
}

export function StreamSection() {
  const [messages, setMessages] = useState(() =>
    Array.from({ length: 18 }, (_, i) => ({
      id: i + 1,
      text: SEED_MESSAGES[i % SEED_MESSAGES.length] ?? '',
    })),
  );
  const [started] = useState(() => Date.now() - 12_000);
  return (
    <Section
      id="stream"
      title="Live stream"
      lede="What a running agent looks like: a live row with a ticking timer, and the conversation scroller that follows new messages and offers a jump back to the latest."
    >
      <Specimen title="Live row" note="detail and chief variants; the second one expands">
        <div className="flex w-full flex-col gap-4">
          <LiveRow variant="detail" label="Running tests" startedAt={started} />
          <LiveRow
            variant="chief"
            label="Planning the next step"
            startedAt={started}
            disclosure={{ expand: 'Show details', collapse: 'Hide details' }}
          >
            <p className="m-0 mt-2 max-w-140 text-meta text-content-tertiary">
              Reading the failing log, then deciding between regenerating the lockfile and pinning
              the dependency.
            </p>
          </LiveRow>
        </div>
      </Specimen>
      <Specimen
        title="Message scroller"
        note="Scroll up to reveal the jump button; Add message follows the bottom"
        className="block"
      >
        <div className="mb-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setMessages((all) => [
                ...all,
                {
                  id: all.length + 1,
                  text: SEED_MESSAGES[all.length % SEED_MESSAGES.length] ?? '',
                },
              ])
            }
          >
            Add message
          </Button>
        </div>
        <div className="relative flex h-72 flex-col overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border">
          <MessageScrollerProvider autoScroll scrollEdgeThreshold={40} defaultScrollPosition="end">
            <MessageScroller className="h-auto min-h-0 flex-1">
              <FadeScrollerViewport>
                <MessageScrollerContent className="block gap-0 px-4 pt-3.5 pb-4">
                  {messages.map((m) => (
                    <p key={m.id} className="m-0 py-1.5 text-ui text-foreground">
                      <span className="mr-2 text-meta text-content-tertiary tabular-nums">
                        {String(m.id).padStart(2, '0')}
                      </span>
                      {m.text}
                    </p>
                  ))}
                </MessageScrollerContent>
              </FadeScrollerViewport>
              <JumpToLatestButton aria-label="Jump to latest">
                <ArrowDown width={16} height={16} />
              </JumpToLatestButton>
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
      </Specimen>
    </Section>
  );
}
