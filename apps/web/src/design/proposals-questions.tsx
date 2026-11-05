import type { AskUserAnswer } from '@cairn/shared';
import { CircleHelp, FolderGit2, ListChecks, PackageCheck, Search } from 'lucide-react';
import { useState } from 'react';
import { SpiralMark } from '../chief/chief-fab-icon.js';
import { ChiefQuestionCard, type ChiefQuestionItem } from '../chief/chief-question-card.js';
import { PhoneTabBar } from '../components/shell/phone-tab-bar.js';
import { SidebarNavRow } from '../components/shell/sidebar-nav-row.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Greeting } from '../components/stream/greeting.js';
import { Button } from '../components/ui/button.js';
import { Composer } from '../detail/composer.js';
import { Section, Specimen } from './specimen.js';

type DraftRequest = {
  teamId: string;
  conversationId: string;
  origin: string;
  item: ChiefQuestionItem;
};

const REQUESTS: DraftRequest[] = [
  {
    teamId: 'sample-team',
    conversationId: 'export-thread',
    origin: 'cairn / Export task history',
    item: {
      kind: 'question',
      requestId: 'export-scope',
      status: 'pending',
      questions: [
        {
          header: 'Scope',
          question: 'Should the export include archived tasks?',
          options: [
            { label: 'Active tasks only', recommended: true },
            { label: 'Include archived tasks' },
          ],
        },
        {
          header: 'Formats',
          question: 'Which formats do you need?',
          multiSelect: true,
          options: [{ label: 'CSV' }, { label: 'JSON' }, { label: 'Markdown' }],
        },
        { header: 'Details', question: 'Anything else to include?', options: [] },
      ],
      answers: null,
    },
  },
  {
    teamId: 'sample-team',
    conversationId: 'docs-thread',
    origin: 'docs-site / Publish documentation',
    item: {
      kind: 'question',
      requestId: 'docs-publish',
      status: 'pending',
      questions: [
        {
          header: 'Publishing',
          question:
            'The new documentation includes the migration guide, examples for existing installations, and the archived API reference. Should I publish all three together, or keep the archived reference out of the first release so readers see only the current API?',
          options: [
            { label: 'Publish the current guide and examples first', recommended: true },
            { label: 'Publish everything together, including the archived API reference' },
          ],
        },
      ],
      answers: null,
    },
  },
];

function QuestionEntry({
  count,
  compact = false,
  onOpen,
}: {
  count: number;
  compact?: boolean;
  onOpen: () => void;
}) {
  if (count === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-content-secondary"
      aria-label={`${count} pending ${count === 1 ? 'question' : 'questions'}`}
      onClick={onOpen}
    >
      <CircleHelp aria-hidden className="size-4" />
      <span className={compact ? 'sr-only' : undefined}>Questions</span>
      <span className="text-caption tabular-nums text-content-tertiary">{count}</span>
    </Button>
  );
}

function QuestionDraftFrame({
  anchor,
  phone = false,
  initiallyOpen = false,
  remaining = false,
  failAnswer = false,
}: {
  anchor: 'header' | 'sidebar';
  phone?: boolean;
  initiallyOpen?: boolean;
  remaining?: boolean;
  failAnswer?: boolean;
}) {
  const [requests, setRequests] = useState(() =>
    REQUESTS.map((request, index) =>
      remaining && index === 0
        ? { ...request, item: { ...request.item, status: 'answered' as const } }
        : request,
    ),
  );
  const [selected, setSelected] = useState(remaining ? 'docs-publish' : 'export-scope');
  const [open, setOpen] = useState(initiallyOpen);
  const [page, setPage] = useState('Coordinator');
  const [composerDraft, setComposerDraft] = useState('Also check the release notes');
  const [messages, setMessages] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failNext, setFailNext] = useState(failAnswer);
  const pending = requests.filter((request) => request.item.status === 'pending');
  const active = pending.find((request) => request.item.requestId === selected) ?? pending[0];

  const finish = (
    requestId: string,
    status: 'answered' | 'cancelled',
    answers?: AskUserAnswer[],
  ) => {
    if (status === 'answered' && failNext) {
      setErrors((previous) => ({
        ...previous,
        [requestId]: 'Could not send your answer. Your draft is still here. Try Submit again.',
      }));
      setFailNext(false);
      return;
    }
    const next = requests.map((request) =>
      request.item.requestId === requestId
        ? { ...request, item: { ...request.item, status, answers: answers ?? null } }
        : request,
    );
    setRequests(next);
    const nextPending = next.find((request) => request.item.status === 'pending');
    if (nextPending === undefined) setOpen(false);
    else setSelected(nextPending.item.requestId);
  };

  const entry = <QuestionEntry count={pending.length} onOpen={() => setOpen(true)} />;

  return (
    <div
      data-question-draft={`${anchor}-${phone ? 'mobile' : 'desktop'}`}
      className="relative isolate flex flex-none overflow-hidden rounded-(--radius-card) border border-border bg-background text-foreground"
      style={{ width: phone ? 390 : 1120, height: phone ? 844 : 700 }}
    >
      {!phone && (
        <nav
          aria-label="Draft navigation"
          className="flex w-62 flex-none flex-col gap-1 bg-canvas p-3"
        >
          <span className="mb-5 px-2 text-heading font-semibold">Cairn</span>
          <div className="flex items-center">
            <div className="min-w-0 flex-1">
              <SidebarNavRow
                label="Coordinator"
                icon={<SpiralMark busy={false} className="size-4" />}
                active={page === 'Coordinator'}
                onClick={() => setPage('Coordinator')}
              />
            </div>
            {anchor === 'sidebar' && (
              <QuestionEntry count={pending.length} compact onOpen={() => setOpen(true)} />
            )}
          </div>
          <SidebarNavRow label="Search" icon={<Search className="size-4" />} />
          <SidebarNavRow
            label="Projects"
            icon={<FolderGit2 className="size-4" />}
            active={page === 'Projects'}
            onClick={() => setPage('Projects')}
          />
        </nav>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 flex-none items-center gap-0.5 border-b border-border px-3">
          <h3 className="m-0 mr-auto min-w-0 truncate text-ui font-semibold">{page}</h3>
          {(anchor === 'header' || phone) && entry}
          <Button variant="ghost" size="icon-sm" aria-label="Tasks">
            <ListChecks aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Made">
            <PackageCheck aria-hidden />
          </Button>
        </header>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            <Greeting as="h2" wrap>
              {page === 'Projects' ? 'Your projects' : 'The release notes are ready.'}
            </Greeting>
            <p className="text-ui leading-relaxed text-content-secondary">
              The export and documentation questions can wait. Other work can continue.
            </p>
            {messages.map((message, index) => (
              <p key={index} className="rounded-(--radius-card) bg-secondary p-3 text-ui">
                {message}
              </p>
            ))}
            <Button variant="outline" size="sm" onClick={() => setPage('Projects')}>
              Open projects
            </Button>
          </div>
          <div className={open && pending.length > 0 ? 'contents' : 'hidden'}>
            <SidePanel label="Pending questions" onDismiss={() => setOpen(false)}>
              <SidePanelHead closeLabel="Defer questions" onClose={() => setOpen(false)}>
                <SidePanelTitle>Questions · {pending.length}</SidePanelTitle>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Later
                </Button>
              </SidePanelHead>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="mb-3 flex flex-col gap-1">
                  {pending.map((request) => (
                    <Button
                      key={request.item.requestId}
                      variant="ghost"
                      size="sm"
                      className="h-auto justify-start whitespace-normal py-2 text-left font-normal"
                      aria-pressed={active?.item.requestId === request.item.requestId}
                      onClick={() => setSelected(request.item.requestId)}
                    >
                      <CircleHelp
                        aria-hidden
                        className="size-3.5 flex-none text-content-tertiary"
                      />
                      {request.origin}
                    </Button>
                  ))}
                </div>
                {requests.map((request) => (
                  <div
                    key={`${request.teamId}:${request.conversationId}:${request.item.requestId}`}
                    hidden={active?.item.requestId !== request.item.requestId}
                  >
                    <Button
                      variant="link"
                      size="sm"
                      className="mb-2 h-auto whitespace-normal p-0 text-left text-caption"
                      onClick={() => setPage(request.origin)}
                    >
                      Open origin thread: {request.origin}
                    </Button>
                    {errors[request.item.requestId] !== undefined && (
                      <p role="status" className="mb-3 text-ui text-destructive">
                        {errors[request.item.requestId]}
                      </p>
                    )}
                    <ChiefQuestionCard
                      item={request.item}
                      numberKeys={false}
                      onAnswer={({ requestId, answers }) => finish(requestId, 'answered', answers)}
                      onCancel={(requestId) => finish(requestId, 'cancelled')}
                    />
                  </div>
                ))}
              </div>
            </SidePanel>
          </div>
        </div>
        <Composer
          placeholder="Message Coordinator"
          aiReview={false}
          streaming={false}
          editable
          draft={composerDraft}
          onDraftChange={setComposerDraft}
          onSend={(text) => setMessages((previous) => [...previous, text])}
        />
        {phone && (
          <PhoneTabBar
            active={page === 'Projects' ? 'projects' : 'coordinator'}
            onChange={(id) => setPage(id === 'projects' ? 'Projects' : 'Coordinator')}
            tabs={[
              {
                id: 'coordinator',
                label: 'Coordinator',
                icon: <SpiralMark busy={false} className="size-5" />,
              },
              { id: 'projects', label: 'Projects', icon: <FolderGit2 className="size-5" /> },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function QuestionDraftsSection() {
  return (
    <Section
      id="question-drafts"
      title="Pending questions · draft direction"
      lede="#2853 / D85. Choose an entry point before product implementation. These are gallery-only compositions of the real question card, panel, composer and shell controls."
    >
      <div className="rounded-(--radius-card) border border-border p-4 text-ui leading-relaxed text-content-secondary">
        <p className="mt-0 font-medium text-foreground">Proposed state flow</p>
        <p>
          Server pending → answered or cancelled stays independent of presentation compact ↔ open.
          Arrival only updates the quiet count. Open and Later change presentation; Later sends no
          answer or cancellation. The request remains pending while other work continues.
        </p>
        <p>
          A future draft store must use team + origin conversation + request ID, retain selected
          choices, free text and wizard step across routes, and clear only on a confirmed terminal
          status. A failed submission retains the draft. Answer actions must carry the origin
          conversation rather than use whichever thread is currently active.
        </p>
        <p>
          Failure cases to verify before shipping: background arrival stealing focus or scroll;
          partial drafts lost on navigation; another team or request receiving a draft; duplicate
          submission; one answer removing a different question; a failed answer erasing input;
          hidden number shortcuts consuming typing. None of these may block ordinary composing or
          navigation.
        </p>
        <p className="mb-0">
          Prototype limit: these real cards stay mounted while hidden, so Later preserves their
          local state here. Reload and real route persistence are not implemented or proven.
          Navigation and answers below are local simulations. Number shortcuts are disabled for all
          gallery cards.
        </p>
      </div>
      <Specimen
        title="A · Header entry · recommended"
        note="Quiet question count stays available outside the sidebar. Open voluntarily."
        className="overflow-x-auto"
      >
        <QuestionDraftFrame anchor="header" />
      </Specimen>
      <Specimen
        title="B · Beside Coordinator"
        note="A quiet question icon and count sit beside the Coordinator row; mobile uses the header fallback."
        className="overflow-x-auto"
      >
        <QuestionDraftFrame anchor="sidebar" />
      </Specimen>
      <Specimen
        title="Answer now, return later"
        note="Choose Scope, advance and select formats, click Later, navigate, then reopen. The step and picks stay."
        className="overflow-x-auto"
      >
        <QuestionDraftFrame anchor="header" initiallyOpen />
      </Specimen>
      <Specimen
        title="Answer one · one remains"
        note="Long question, origin link and remaining count. Answering never submits the other request."
        className="overflow-x-auto"
      >
        <QuestionDraftFrame anchor="header" initiallyOpen remaining />
      </Specimen>
      <Specimen
        title="Submission failure"
        note="Complete the three steps and submit. The first submission fails locally; the second succeeds."
        className="overflow-x-auto"
      >
        <QuestionDraftFrame anchor="header" initiallyOpen failAnswer />
      </Specimen>
      <Specimen
        title="390px · quiet and expanded"
        note="Use the gallery Light / Dark control. The opened panel stays above the real composer and phone navigation."
        className="overflow-x-auto"
      >
        <QuestionDraftFrame anchor="header" phone />
        <QuestionDraftFrame anchor="header" phone initiallyOpen />
        <QuestionDraftFrame anchor="sidebar" phone initiallyOpen remaining />
      </Specimen>
      <p className="text-ui text-content-secondary">
        Open choice: A header entry (recommended for visibility across pages and on phones), or B
        Coordinator sidebar entry with the same header fallback on phones. The recommendation is a
        design inference; screenshot review and a browser walkthrough are still pending.
      </p>
    </Section>
  );
}
