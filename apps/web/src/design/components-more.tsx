import { useId, useState } from 'react';
import { ClaudeMark, GeminiMark, PiMark } from '../components/brand-marks.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { LivePulse, LiveRow } from '../components/chat/live-row.js';
import { TraceGroup, type TraceStep, TraceSteps } from '../components/chat/trace-steps.js';
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
import { SEED_TRANSCRIPT } from './agent-transcript.js';
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
        <div className="w-full">
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

const LIVE_STEPS: { id: string; step: TraceStep }[] = [
  {
    id: 'a',
    step: { kind: 'run', command: 'git push origin fix/lockfile', exit: null, output: [], secs: 0 },
  },
];

const FINISHED_STEPS: { id: string; step: TraceStep }[] = [
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
  { id: 'b', step: { kind: 'run', command: 'pnpm install', exit: 0, output: [], secs: 12 } },
];

export function StreamSection() {
  const [steps, setSteps] = useState(() => SEED_TRANSCRIPT.map((step, i) => ({ id: i + 1, step })));
  return (
    <Section
      id="stream"
      title="Live stream"
      lede="What a running agent looks like: the open group is the live row, spoken in the present tense with a shimmer; a small pulse sits under the last line; the elapsed time lives in the composer next to stop. When the turn ends the pulse goes, the group turns past tense, and a long turn closes with a Worked for rule."
    >
      <Specimen title="Live row" note="shimmering label, a pulse under it, no timer in the row">
        <Cell label="detail: in the task transcript">
          <LiveRow variant="detail" label="Running tests" />
        </Cell>
        <Cell label="chief: under a reply, click to expand">
          <LiveRow
            variant="chief"
            label="Planning the next step"
            disclosure={{ expand: 'Show details', collapse: 'Hide details' }}
          >
            <p className="m-0 mt-2 max-w-100 text-meta text-content-tertiary">
              Reading the failing log, then deciding between regenerating the lockfile and pinning
              the dependency.
            </p>
          </LiveRow>
        </Cell>
        <Cell label="the open group is the live row">
          <div className="w-100">
            <TraceGroup steps={LIVE_STEPS} />
            <LivePulse className="mt-1 ml-0.5" />
          </div>
        </Cell>
        <Cell label="the turn ended: past tense, no pulse, Worked for rule">
          <div className="w-100">
            <TraceGroup steps={FINISHED_STEPS} />
            <div className="mt-3 flex items-center gap-3 text-center text-meta text-content-tertiary before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
              Worked for 4 minutes
            </div>
          </div>
        </Cell>
      </Specimen>
      <Specimen
        title="Agent transcript"
        note="Thoughts fold, runs show the exit code, edits show the diff size"
        className="block"
      >
        <div className="mb-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setSteps((all) => {
                const step = SEED_TRANSCRIPT[all.length % SEED_TRANSCRIPT.length];
                return step == null ? all : [...all, { id: all.length + 1, step }];
              })
            }
          >
            Add step
          </Button>
        </div>
        <div className="relative flex h-80 flex-col overflow-hidden rounded-(--radius-card) bg-card ring-1 ring-border">
          <MessageScrollerProvider autoScroll scrollEdgeThreshold={40} defaultScrollPosition="end">
            <MessageScroller className="h-auto min-h-0 flex-1">
              <FadeScrollerViewport>
                <MessageScrollerContent className="block gap-0 px-5 pt-4 pb-5">
                  <TraceSteps steps={steps} />
                  <div className="mt-2">
                    <LiveRow variant="chief" label="Opening the pull request" />
                  </div>
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
