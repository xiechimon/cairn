import { Archive, Link2, Pencil, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ProjectAvatar } from '../board/project-avatar.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import { Greeting } from '../components/stream/greeting.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { TitleMenuTrigger } from '../components/title-menu-trigger.js';
import { DropdownMenu, DropdownMenuSeparator } from '../components/ui/dropdown-menu.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { Cell, Section, Specimen } from './specimen.js';

export function PanelSection() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Section
      id="side-panel"
      title="Side panel and title menus"
      lede="The right-hand panel every page opens beside its main column, and the title that opens a menu. Pages use these instead of building their own aside, header or title trigger."
    >
      <Specimen
        title="Side panel"
        note="420px, a 52px head with the close button last; below 1100px it floats over a scrim"
        stage="canvas"
        code={`<SidePanel label="Threads" onDismiss={close}>\n  <SidePanelHead closeLabel="Close panel" onClose={close}>\n    <SidePanelTitle>Threads</SidePanelTitle>\n  </SidePanelHead>\n  <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2">…</div>\n</SidePanel>`}
      >
        <div className="relative flex h-90 w-full justify-end overflow-hidden rounded-(--radius-card) ring-1 ring-border">
          <SidePanel label="Threads" onDismiss={() => toastSuccess('Panel closed')}>
            <SidePanelHead closeLabel="Close panel" onClose={() => toastSuccess('Panel closed')}>
              <SidePanelTitle>Threads</SidePanelTitle>
            </SidePanelHead>
            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-6">
              <StoneTrail>
                <StoneGroup tone="waiting" label="Waiting on you" count={1}>
                  <ThreadRow
                    title="Snooze until needed"
                    reason="Question · keep the snooze when a reply lands?"
                    tone="waiting"
                    age="12m"
                  />
                </StoneGroup>
                <StoneGroup tone="review" label="Ready for review" count={1}>
                  <ThreadRow
                    title="Fold finished turns"
                    reason="PR is ready"
                    tone="review"
                    pr={2271}
                    age="32m"
                  />
                </StoneGroup>
                <StoneGroup tone="resolved" label="Resolved" count={14} collapsed />
              </StoneTrail>
            </div>
          </SidePanel>
        </div>
      </Specimen>
      <Specimen
        title="Title menu"
        note={picked == null ? 'Open a title' : `Picked: ${picked}`}
        code={`<DropdownMenu>\n  <TitleMenuTrigger media={<ProjectAvatar name="cairn" tone={0} bare />}>cairn</TitleMenuTrigger>\n  <KeyedMenuContent align="start">…</KeyedMenuContent>\n</DropdownMenu>\n<TitleMenuTrigger size="pane">Plan</TitleMenuTrigger>`}
      >
        <Cell label="page: project header">
          <DropdownMenu>
            <TitleMenuTrigger media={<ProjectAvatar name="cairn" tone={0} bare />}>
              cairn
            </TitleMenuTrigger>
            <KeyedMenuContent align="start" className="w-52">
              <KeyedMenuItem shortcut="R" onClick={() => setPicked('Rename')}>
                <Pencil />
                Rename
              </KeyedMenuItem>
              <KeyedMenuItem shortcut="S" onClick={() => setPicked('Settings')}>
                <Settings2 />
                Settings
              </KeyedMenuItem>
              <KeyedMenuItem shortcut="L" onClick={() => setPicked('Copy link')}>
                <Link2 />
                Copy link
              </KeyedMenuItem>
              <DropdownMenuSeparator />
              <KeyedMenuItem shortcut="A" confirms onClick={() => setPicked('Archive')}>
                <Archive />
                Archive
              </KeyedMenuItem>
              <KeyedMenuItem
                shortcut="D"
                confirms
                variant="destructive"
                onClick={() => setPicked('Delete')}
              >
                <Trash2 />
                Delete
              </KeyedMenuItem>
            </KeyedMenuContent>
          </DropdownMenu>
        </Cell>
        <Cell label="pane: document title">
          <DropdownMenu>
            <TitleMenuTrigger size="pane">Plan</TitleMenuTrigger>
            <KeyedMenuContent align="start" className="w-36">
              <KeyedMenuItem shortcut="P" onClick={() => setPicked('Plan')}>
                Plan
              </KeyedMenuItem>
              <KeyedMenuItem shortcut="C" onClick={() => setPicked('Changes')}>
                Changes
              </KeyedMenuItem>
            </KeyedMenuContent>
          </DropdownMenu>
        </Cell>
      </Specimen>
      <Specimen
        title="Greeting as a headline"
        note="as h2 with wrap: a page's first question, balanced over two lines"
        code={`<Greeting as="h2" wrap>New project: cairn. Where should we start?</Greeting>`}
      >
        <div className="w-full max-w-110">
          <Greeting as="h2" wrap>
            New project: Site redesign. Where should we start?
          </Greeting>
        </div>
      </Specimen>
    </Section>
  );
}
