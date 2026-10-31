import { useId, useRef, useState } from 'react';
import { DoneConfirmDialog } from '../board/done-confirm-dialog.js';
import { ResetConfirmDialog } from '../board/reset-confirm-dialog.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import type { PaneView } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { EllipsisVertical, Search } from '../icons/index.js';
import { AttachmentCard } from '../overlay/attachment-card.js';
import { AttachmentPreview } from '../overlay/attachment-preview.js';
import { ChipPopover } from '../overlay/chip-popover.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { DeleteProjectConfirm } from '../overlay/delete-project-confirm.js';
import { MentionInline, MentionPicker } from '../overlay/mention-picker.js';
import type { MentionToken } from '../overlay/mention-token.js';
import { MoreMenu } from '../overlay/more-menu.js';
import { NewTaskDialog } from '../overlay/new-task-dialog.js';
import { PaneTypeSelect } from '../overlay/plan-dropdown.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { BUILTIN_SLASH_COMMANDS, type SlashRow } from '../overlay/slash-commands.js';
import { SlashMenu } from '../overlay/slash-menu.js';
import {
  BOARD_FIXTURE,
  CARD_FACES,
  MENTION_GROUPS,
  PROJECT,
  PROJECT_TITLE,
} from './product-fixtures.js';
import { Cell, Section, Specimen } from './specimen.js';

const SLASH_SECTIONS: { title: string; rows: SlashRow[] }[] = [
  {
    title: '命令',
    rows: BUILTIN_SLASH_COMMANDS.slice(0, 4).map((c) => ({
      name: c.name,
      kind: c.kind,
      builtin: c.name,
      descKey: c.descKey,
    })),
  },
  {
    title: '技能',
    rows: [
      {
        name: 'frontend-design',
        kind: 'insert',
        skillId: 'frontend-design',
        description: 'Distinctive UI direction',
      },
      { name: 'verify', kind: 'insert', skillId: 'verify', description: 'Prove a change works' },
    ],
  },
];

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

function NewTaskSpecimen() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <Specimen
      title="New task"
      note={saved ?? 'NewTaskDialog with the project picker, attachments and mentions'}
      stage="canvas"
    >
      <Button onClick={() => setOpen(true)}>New task</Button>
      <NewTaskDialog
        open={open}
        onClose={() => setOpen(false)}
        onSave={(spec) => {
          setSaved(`Saved: ${spec.slice(0, 60)}`);
          setOpen(false);
        }}
        onSaveAndStart={(spec) => {
          setSaved(`Saved and started: ${spec.slice(0, 60)}`);
          setOpen(false);
        }}
        projects={[
          { id: PROJECT, name: PROJECT_TITLE },
          { id: 'docs-site', name: 'docs-site' },
        ]}
        mentionGroups={MENTION_GROUPS}
        onAttachment={(files) => files.map((f) => f.name)}
      />
    </Specimen>
  );
}

function SearchSpecimen() {
  const { open, setOpen, query, setQuery } = useSearchState(false, '');
  return (
    <Specimen
      title="Search"
      note="SearchPanel: navigation rows when empty, task and agent results as you type"
      stage="canvas"
    >
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
        query={query}
        onQuery={setQuery}
        open={open}
        onClose={() => setOpen(false)}
      />
    </Specimen>
  );
}

function PickersSpecimen() {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inserted, setInserted] = useState<MentionToken[]>([]);
  const [slashHi, setSlashHi] = useState<number | null>(0);
  const [inlineHi, setInlineHi] = useState<number | null>(0);
  const [picked, setPicked] = useState<string | null>(null);
  const slashRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const slashId = useId();
  const inlineId = useId();
  return (
    <Specimen
      title="Slash menu and mentions"
      note={
        picked ??
        (inserted.length > 0
          ? `Inserted: ${inserted.map((t) => t.label).join(', ')}`
          : 'SlashMenu and MentionInline as they float over the composer; MentionPicker as a dialog')
      }
      stage="canvas"
    >
      <Cell label="SlashMenu">
        <div className="relative mt-80 h-10 w-80 rounded-(--radius-composer) bg-card px-3 py-2.5 text-ui shadow-(--shadow-composer)">
          /
          <SlashMenu
            open
            sections={SLASH_SECTIONS.map((section) => ({ ...section, title: t(section.title) }))}
            caret={0}
            query=""
            highlight={slashHi}
            onHover={setSlashHi}
            onPick={(row) => setPicked(`Slash: /${row.name}`)}
            listboxRef={slashRef}
            listboxId={slashId}
          />
        </div>
      </Cell>
      <Cell label="SlashMenu, no match">
        <div className="relative mt-80 h-10 w-64 rounded-(--radius-composer) bg-card px-3 py-2.5 text-ui shadow-(--shadow-composer)">
          /zzz
          <SlashMenu
            open
            sections={[]}
            caret={0}
            query="zzz"
            highlight={null}
            onHover={() => {}}
            onPick={() => {}}
            listboxRef={slashRef}
            listboxId={`${slashId}-empty`}
          />
        </div>
      </Cell>
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
      <Cell label="MentionPicker">
        <Button variant="outline" onClick={() => setPickerOpen(true)}>
          Open mention picker
        </Button>
        <MentionPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          groups={MENTION_GROUPS}
          onInsert={(tokens) => {
            setInserted(tokens);
            setPickerOpen(false);
          }}
        />
      </Cell>
    </Specimen>
  );
}

function AttachmentsSpecimen() {
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);
  const onPreview = (name: string, src: string) => setPreview({ name, src });
  return (
    <Specimen
      title="Attachments"
      note="AttachmentCard states; click a done card for AttachmentPreview"
      stage="canvas"
    >
      <Cell label="Image, done">
        <AttachmentCard
          name="avatar-user.png"
          source="/avatar-user.png"
          isImage
          state="done"
          onPreview={onPreview}
        />
      </Cell>
      <Cell label="Image, uploading">
        <AttachmentCard name="logo.svg" source="/logo.svg" isImage state="uploading" />
      </Cell>
      <Cell label="File, done">
        <AttachmentCard
          name="build-log.txt"
          source=""
          isImage={false}
          state="done"
          onPreview={onPreview}
        />
      </Cell>
      <Cell label="File, uploading">
        <AttachmentCard
          name="report-with-a-very-long-name.pdf"
          source=""
          isImage={false}
          state="uploading"
        />
      </Cell>
      <Cell label="Preview, broken image">
        <Button
          variant="outline"
          onClick={() => setPreview({ name: 'missing.png', src: '/missing.png' })}
        >
          Preview a missing image
        </Button>
      </Cell>
      {preview != null && (
        <AttachmentPreview name={preview.name} src={preview.src} onClose={() => setPreview(null)} />
      )}
    </Specimen>
  );
}

function MenusSpecimen() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [view, setView] = useState<PaneView>('doc');
  const [last, setLast] = useState<string | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const chipTodo = CARD_FACES[11]?.todo ?? CARD_FACES[0]?.todo;
  return (
    <Specimen
      title="Menus and popovers"
      note={last ?? 'MoreMenu, PaneTypeSelect and the ChipPopover body'}
      stage="canvas"
    >
      <Cell label="MoreMenu">
        <Button
          ref={moreRef}
          variant="outline"
          size="icon"
          aria-label="More"
          onClick={() => setMoreOpen(true)}
        >
          <EllipsisVertical />
        </Button>
        <MoreMenu
          open={moreOpen}
          anchor={moreRef}
          onClose={() => setMoreOpen(false)}
          onDelete={() => setLast('Delete')}
          onComplete={() => setLast('Complete')}
          canComplete
          onArchive={() => setLast('Archive')}
          onCloseTask={() => setLast('Cancel task')}
          canClose={false}
          onDiscard={() => setLast('Discard changes')}
        />
      </Cell>
      <Cell label={`PaneTypeSelect: ${view}`}>
        <PaneTypeSelect view={view} docLabel="方案" sections onView={setView} />
      </Cell>
      <Cell label="PaneTypeSelect, changes only">
        <PaneTypeSelect view="doc" docLabel="变更" onView={() => {}} />
      </Cell>
      {chipTodo != null && (
        <Cell label="ChipPopover body">
          <div className="rounded-(--radius-popover) bg-popover p-(--menu-pad) shadow-(--shadow-popover)">
            <ChipPopover
              todo={chipTodo}
              projectName={PROJECT_TITLE}
              agentModel={{ modelId: 'claude-sonnet-5-5', thinkingLevel: 'high' }}
              onEditAssign={() => setLast('Edit assignment')}
            />
          </div>
        </Cell>
      )}
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
  const triggers = [
    ['delete', 'Delete task'],
    ['delete-project', 'Delete project'],
    ['done', 'Mark done'],
    ['done-inflight', 'Mark done while running'],
    ['reset', 'Move back to To start'],
    ['reset-stale', 'Reset, stale'],
  ] as const;
  return (
    <Specimen
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
      <DeleteProjectConfirm
        projectName={PROJECT_TITLE}
        open={open === 'delete-project'}
        onClose={close}
        onConfirm={() => done('project deleted')}
      />
      <DoneConfirmDialog
        open={open === 'done'}
        onClose={close}
        onConfirmDone={() => done('done')}
        onConfirmCanceled={() => done('canceled')}
      />
      <DoneConfirmDialog
        open={open === 'done-inflight'}
        mode="inflight"
        onClose={close}
        onConfirmDone={() => done('done')}
        onConfirmStopThenDone={() => done('stopped then done')}
      />
      <ResetConfirmDialog open={open === 'reset'} onClose={close} onConfirm={() => done('reset')} />
      <ResetConfirmDialog
        open={open === 'reset-stale'}
        onClose={close}
        onConfirm={() => done('reset')}
        stale
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
      <NewTaskSpecimen />
      <SearchSpecimen />
      <PickersSpecimen />
      <AttachmentsSpecimen />
      <MenusSpecimen />
      <ConfirmsSpecimen />
    </Section>
  );
}
