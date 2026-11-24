import { EllipsisVertical, Play, Search, Settings } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Kbd } from '../components/ui/kbd.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { MentionInline } from '../overlay/mention-inline.js';
import { MoreMenu } from '../overlay/more-menu.js';
import { type SearchContext, SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { BOARD_FIXTURE, CARD_FACES, MENTION_GROUPS } from './product-fixtures.js';
import { Cell, Section, Specimen } from './specimen.js';

const INLINE_ROWS = [
  ...MENTION_GROUPS.agent.map((e) => ({ kind: 'agent' as const, ...e })),
  ...MENTION_GROUPS.todo.map((e) => ({ kind: 'todo' as const, ...e })),
  {
    kind: 'file' as const,
    id: 'apps/web/src/board',
    label: 'apps/web/src/board',
    fileType: 'tree' as const,
  },
];

const SEARCH_FIXTURE = { ...BOARD_FIXTURE, todos: CARD_FACES.map((face) => face.todo) };

const SEARCH_CONTEXT: SearchContext = {
  seqNum: 71,
  title: 'Cache the project file tree',
  commands: [
    { id: 'primary', label: 'Confirm', icon: <Play width={18} height={18} />, run: () => {} },
    {
      id: 'assign',
      label: 'Edit assignment…',
      icon: <Settings width={18} height={18} />,
      run: () => {},
    },
    {
      id: 'more',
      label: 'More actions…',
      icon: <EllipsisVertical width={18} height={18} />,
      run: () => {},
    },
  ],
};

function SearchSpecimen() {
  const { open, setOpen, query, setQuery } = useSearchState(false, '');
  const [withContext, setWithContext] = useState(false);
  return (
    <Specimen
      id="search"
      title="Search"
      note="SearchPanel: on a task page the task rides along as a chip and its commands come first"
      stage="canvas"
    >
      <Button
        variant="outline"
        onClick={() => {
          setWithContext(true);
          setOpen(true);
        }}
      >
        On a task page
      </Button>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Search data-icon="inline-start" />
        Search
        <Kbd>⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setQuery('the');
          setOpen(true);
        }}
      >
        Open with a query
      </Button>
      <SearchPanel
        fixture={SEARCH_FIXTURE}
        context={withContext ? SEARCH_CONTEXT : undefined}
        query={query}
        onQuery={setQuery}
        open={open}
        onClose={() => {
          setOpen(false);
          setWithContext(false);
        }}
      />
    </Specimen>
  );
}

function PickersSpecimen() {
  const [inlineHi, setInlineHi] = useState<number | null>(0);
  const [picked, setPicked] = useState<string | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const inlineId = useId();
  return (
    <Specimen
      id="mentions"
      title="Mentions"
      note={picked ?? 'MentionInline as it floats over the composer'}
      stage="canvas"
    >
      <Cell label="MentionInline">
        <div className="relative mt-80 h-10 w-80 rounded-(--radius-composer) bg-card px-3 py-2.5 text-ui shadow-(--shadow-composer)">
          @
          <MentionInline
            open
            rows={INLINE_ROWS}
            caret={0}
            query=""
            highlight={inlineHi}
            onHover={setInlineHi}
            onPick={(row) => setPicked(`Mention: ${row.label}`)}
            listboxRef={inlineRef}
            listboxId={inlineId}
          />
        </div>
      </Cell>
    </Specimen>
  );
}

function MenusSpecimen() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  return (
    <Specimen
      id="menus-and-popovers"
      title="Menus and popovers"
      note={last ?? 'MoreMenu, the status menu and the agent picker'}
      stage="canvas"
    >
      <Cell label="MoreMenu">
        <MoreMenu
          open={moreOpen}
          onOpenChange={setMoreOpen}
          trigger={
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" aria-label="More" />}
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
          }
          onDelete={() => setLast('Delete')}
          onComplete={() => setLast('Complete')}
          canComplete
          onArchive={() => setLast('Archive')}
          onDiscard={() => setLast('Discard changes')}
        />
      </Cell>
    </Specimen>
  );
}

function ConfirmsSpecimen() {
  const [open, setOpen] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const close = () => setOpen(null);
  const done = (what: string) => {
    setLast(what);
    setOpen(null);
  };
  const triggers = [['delete', 'Delete task']] as const;
  return (
    <Specimen
      id="confirmations"
      title="Confirmations"
      note={last ?? 'Each button opens the real confirmation'}
      stage="canvas"
    >
      {triggers.map(([id, label]) => (
        <Button key={id} variant="outline" onClick={() => setOpen(id)}>
          {label}
        </Button>
      ))}
      <DeleteConfirm
        title="删除任务"
        ariaLabel="删除任务"
        open={open === 'delete'}
        onClose={close}
        onConfirm={() => done('deleted')}
        summary={<span className="truncate">#44 Fix the stale branch badge on cards</span>}
      />
    </Specimen>
  );
}

export function ProductOverlaysSection() {
  return (
    <Section
      id="product-overlays"
      title="Overlays and pickers"
      lede="Dialogs, the command palette, pickers and menus the app opens over a page. Each opens from a trigger, as in the app."
    >
      <SearchSpecimen />
      <PickersSpecimen />
      <MenusSpecimen />
      <ConfirmsSpecimen />
    </Section>
  );
}
