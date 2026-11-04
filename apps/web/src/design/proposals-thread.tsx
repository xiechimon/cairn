import {
  AUTOMATION_ACTIVE,
  AUTOMATION_FINISHED,
  AUTOMATION_PAUSED,
  AutomationFrame,
  type BadgeVariant,
} from './proposals-automation.js';
import { Option, SideChatFrame, State, StateGrid } from './proposals-frame.js';
import {
  ChangesHeaderButton,
  ChangesTabs,
  CommitsFrame,
  ExpandCentered,
  ExpandSplit,
  NextStepsFrame,
  QueuedFrame,
  UsageFooter,
  UsageUnderStatus,
} from './proposals-sidechat.js';
import {
  AUTH_TURN,
  CHIEF_TURNS,
  ChiefTurnThread,
  FAILED_TURN,
  LIVE_TURN,
  LOGIN_TURN,
  TurnThread,
  type TurnVariant,
} from './proposals-turns.js';
import { Section } from './specimen.js';

const TURN_OPTIONS: readonly {
  variant: TurnVariant;
  shot: string;
  title: string;
  note: string;
}[] = [
  {
    variant: 'row',
    shot: 'turn-folding-a',
    title: 'A · Header row',
    note: 'Chevron, purpose, muted duration; a quiet row that hovers like a menu item',
  },
  {
    variant: 'chip',
    shot: 'turn-folding-b',
    title: 'B · Timeline chip',
    note: 'A pill centred on a hairline, like the turn rule it replaces',
  },
  {
    variant: 'card',
    shot: 'turn-folding-c',
    title: 'C · Turn card',
    note: 'Status glyph, purpose and a right-aligned duration; the open turn sits inside the card',
  },
];

export function TurnFoldingDraft() {
  return (
    <Section
      id="draft-turn-folding"
      title="Draft #2235 · Turn folding"
      lede="A finished turn folds under data-testid=turn-header reading purpose and duration; expanding shows its messages and work trace. The live turn stays open and has no chevron. Click any header."
    >
      {TURN_OPTIONS.map((option) => (
        <Option key={option.shot} shot={option.shot} title={option.title} note={option.note}>
          <StateGrid>
            <State label="Folded, with the live turn open">
              <TurnThreadFrame variant={option.variant} kind="folded" />
            </State>
            <State label="First turn expanded">
              <TurnThreadFrame variant={option.variant} kind="expanded" />
            </State>
            <State label="Failed turn, folded">
              <TurnThreadFrame variant={option.variant} kind="failed-folded" />
            </State>
            <State label="Failed turn, expanded">
              <TurnThreadFrame variant={option.variant} kind="failed-expanded" />
            </State>
            <State label="Coordinator conversation" wide>
              <ChiefFrame variant={option.variant} />
            </State>
          </StateGrid>
        </Option>
      ))}
    </Section>
  );
}

function TurnThreadFrame({
  variant,
  kind,
}: {
  variant: TurnVariant;
  kind: 'folded' | 'expanded' | 'failed-folded' | 'failed-expanded';
}) {
  const failed = kind.startsWith('failed');
  const turns = failed ? [LOGIN_TURN, FAILED_TURN] : [LOGIN_TURN, AUTH_TURN, LIVE_TURN];
  const open: string[] =
    kind === 'expanded' ? ['login'] : kind === 'failed-expanded' ? ['failed'] : [];
  return (
    <SideChatFrame
      title="Fix the flaky login test"
      tone={failed ? 'failed' : 'working'}
      state={failed ? 'Failed' : 'Working'}
      streaming={!failed}
      heightClass="h-160"
    >
      <TurnThread variant={variant} turns={turns} initialOpen={open} />
    </SideChatFrame>
  );
}

function ChiefFrame({ variant }: { variant: TurnVariant }) {
  return (
    <div className="flex h-96 w-full flex-col overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border">
      <div className="flex-none border-b border-border px-4 py-2.5 text-ui font-semibold text-foreground">
        Coordinator <span className="font-normal text-content-tertiary">· cairn</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChiefTurnThread variant={variant} turns={CHIEF_TURNS} initialOpen={['chief-2']} />
      </div>
    </div>
  );
}

const AUTOMATION_OPTIONS: readonly {
  variant: BadgeVariant;
  shot: string;
  title: string;
  note: string;
}[] = [
  {
    variant: 'chip',
    shot: 'automation-a',
    title: 'A · Chip next to the title',
    note: 'Timer icon and count, a secondary pill after the title',
  },
  {
    variant: 'status',
    shot: 'automation-b',
    title: 'B · In the status line',
    note: 'The count rides the meta line after the machine and time',
  },
  {
    variant: 'button',
    shot: 'automation-c',
    title: 'C · Header icon button',
    note: 'A ghost icon button before the close button with a numeric dot; paused swaps the icon',
  },
];

export function AutomationDraft() {
  return (
    <Section
      id="draft-automation"
      title="Draft #2241 · Automation badge and popover"
      lede="A thread that has schedules shows data-testid=automation-badge with the count. The popover is drawn inline here so it can be reviewed in place; the switch and delete button work."
    >
      {AUTOMATION_OPTIONS.map((option) => (
        <Option key={option.shot} shot={option.shot} title={option.title} note={option.note}>
          <StateGrid>
            <State label="Recurring, active, popover open">
              <AutomationFrame variant={option.variant} initial={AUTOMATION_ACTIVE} initialOpen />
            </State>
            <State label="One-time schedule that has run: last run, no upcoming runs">
              <AutomationFrame variant={option.variant} initial={AUTOMATION_FINISHED} initialOpen />
            </State>
            <State label="Paused (switch off)">
              <AutomationFrame variant={option.variant} initial={AUTOMATION_PAUSED} initialOpen />
            </State>
            <State label="Closed">
              <AutomationFrame
                variant={option.variant}
                initial={AUTOMATION_ACTIVE}
                initialOpen={false}
              />
            </State>
          </StateGrid>
        </Option>
      ))}
    </Section>
  );
}

export function SideChatDraft() {
  return (
    <Section
      id="draft-side-chat"
      title="Draft #2323 · Side chat additions"
      lede="Six additions to the thread side chat, each in a 420px frame that mimics the real panel. Frames use the real UsageStrip, NextSteps, ThreadActionCard, DocPane, Composer and queued capsule styles."
    >
      <Option
        shot="sidechat-usage-a"
        title="(a) A · Usage strip under the status line"
        note="Always visible, pushes the transcript down"
      >
        <StateGrid>
          <State label="Strip in the header area">
            <UsageUnderStatus />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-usage-b"
        title="(a) B · Usage footer above the composer"
        note="One quiet line that opens into the strip"
      >
        <StateGrid>
          <State label="Collapsed">
            <UsageFooter initialOpen={false} />
          </State>
          <State label="Expanded">
            <UsageFooter initialOpen />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-expand-a"
        title="(b) A · Expand button, centred column"
        note="The panel widens; the conversation keeps its reading width"
      >
        <StateGrid>
          <State label="Collapsed">
            <ExpandCentered initialExpanded={false} />
          </State>
          <State label="Expanded" wide>
            <ExpandCentered initialExpanded />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-expand-b"
        title="(b) B · Expand button, conversation plus rail"
        note="The wider panel adds a rail with usage, changes and commits"
      >
        <StateGrid>
          <State label="Collapsed">
            <ExpandSplit initialExpanded={false} />
          </State>
          <State label="Expanded" wide>
            <ExpandSplit initialExpanded />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-changes-a"
        title="(c) A · Conversation | Changes tabs"
        note="A segmented track under the status line"
      >
        <StateGrid>
          <State label="Conversation">
            <ChangesTabs initial="chat" />
          </State>
          <State label="Changes">
            <ChangesTabs initial="changes" />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-changes-b"
        title="(c) B · Diff button in the header"
        note="A toggle with the +/- counts; pressing it again returns to the conversation"
      >
        <StateGrid>
          <State label="Conversation">
            <ChangesHeaderButton initial="chat" />
          </State>
          <State label="Changes">
            <ChangesHeaderButton initial="changes" />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-queued"
        title="(d) Editable queued messages"
        note="Click a chip to edit in place; Enter saves, Esc cancels"
      >
        <StateGrid>
          <State label="Queued while the agent works">
            <QueuedFrame initialEditing={null} />
          </State>
          <State label="Editing the first chip">
            <QueuedFrame initialEditing="q1" />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-commits"
        title="(e) Commits linked to the thread"
        note="Short sha and subject; each row links to the commit, and the trailer links back"
      >
        <StateGrid>
          <State label="Commit list after the last reply">
            <CommitsFrame />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-next-a"
        title="(f) A · Next steps above the phase card"
        note="Per-turn buttons stay pinned over the composer; the phase card sits beneath them"
      >
        <StateGrid>
          <State label="Plan ready">
            <NextStepsFrame layout="stacked" kind="approve" />
          </State>
          <State label="Awaiting review">
            <NextStepsFrame layout="stacked" kind="finish" />
          </State>
        </StateGrid>
      </Option>
      <Option
        shot="sidechat-next-b"
        title="(f) B · Next steps inside the phase card"
        note="One card: the reason and primary action on top, next steps under a rule"
      >
        <StateGrid>
          <State label="Plan ready">
            <NextStepsFrame layout="merged" kind="approve" />
          </State>
          <State label="Awaiting review">
            <NextStepsFrame layout="merged" kind="finish" />
          </State>
          <State label="No phase action: next steps alone">
            <NextStepsFrame layout="merged" kind={null} />
          </State>
        </StateGrid>
      </Option>
    </Section>
  );
}

export function ThreadDraftSections() {
  return (
    <>
      <TurnFoldingDraft />
      <AutomationDraft />
      <SideChatDraft />
    </>
  );
}
