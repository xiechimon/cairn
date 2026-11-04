import { TurnFold, TurnHeader } from '../components/chat/turn-fold.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import { Transcript } from '../detail/transcript.js';
import type { TranscriptItem } from '../fixtures/records.js';
import type { Turn } from '../lib/turn-fold.js';
import { Labeled, Section, Specimen } from './specimen.js';

type HeaderTurn = Pick<Turn<unknown>, 'id' | 'purpose' | 'status' | 'seconds'>;

const HEADERS: readonly HeaderTurn[] = [
  { id: 'a', purpose: 'Fixed the flaky login test', status: 'done', seconds: 240 },
  { id: 'b', purpose: 'Ran the auth suite on omarchy', status: 'done', seconds: 45 },
  { id: 'c', purpose: 'Migrated the routing tables', status: 'done', seconds: 7300 },
  {
    id: 'd',
    purpose: 'Tried to bump the Playwright version',
    status: 'failed',
    seconds: 120,
  },
  {
    id: 'f',
    purpose:
      'Rewrite the whole onboarding flow so that a new teammate can reach their first merged pull request in under ten minutes',
    status: 'done',
    seconds: 3,
  },
];

const OPEN_TURN: TranscriptItem[] = [
  { kind: 'user', id: 'u1', text: 'The login e2e fails on CI about one run in five. Fix it?' },
  {
    kind: 'robot',
    id: 'r1',
    paragraphs: [
      [
        {
          text: 'The test read the cookie before the redirect finished. It now waits for the inbox URL first; 20 repeated runs pass.',
        },
      ],
    ],
  },
];

const noop = () => undefined;

export function ProductTurnFoldSection() {
  return (
    <Section
      id="product-turn-fold"
      title="Turn folding"
      lede="Once a turn ends, its messages and work trace fold under one quiet header: purpose first, muted duration after. The header opens on click, Enter or Space. A turn that is still running stays open with no header; a failed turn reads in the destructive tone."
    >
      <Specimen
        title="Folded headers"
        note="minutes, seconds, hours, failed, long purpose"
        stage="canvas"
        className="flex-col"
      >
        <MessageScrollerProvider autoScroll={false} defaultScrollPosition="start">
          <div className="w-120 max-w-full">
            {HEADERS.map((turn) => (
              <Labeled key={turn.id} label={turn.status}>
                <TurnHeader {...turn} open={false} onToggle={noop} />
              </Labeled>
            ))}
          </div>
        </MessageScrollerProvider>
      </Specimen>
      <Specimen title="Expanded turn" note="TurnFold open" stage="canvas" className="flex-col">
        <MessageScrollerProvider autoScroll={false} defaultScrollPosition="start">
          <div className="chat-col w-160 max-w-full">
            <TurnFold turn={HEADERS[0] as HeaderTurn} open onToggle={noop}>
              <Transcript transcript={OPEN_TURN} fold={false} />
            </TurnFold>
          </div>
        </MessageScrollerProvider>
      </Specimen>
    </Section>
  );
}
