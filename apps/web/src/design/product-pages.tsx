import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverTrigger } from '../components/ui/popover.js';
import { Folder } from '../icons/index.js';
import { DirBrowser } from '../pages/dir-browser.js';
import { GithubIssuesDialog } from '../pages/github-issues-dialog.js';
import { ProjectAutonomyCard } from '../pages/project-autonomy-card.js';
import { ProjectBaseBranchSelect } from '../pages/project-base-branch-select.js';
import type { GalleryTheme } from './design-doc.js';
import { GALLERY_PROJECT, PROJECT, TEAM } from './product-fixtures.js';
import { applyFrameTheme } from './screens.js';
import { Cell, Section, Specimen } from './specimen.js';

const FRAME_W = 1200;
const FRAME_H = 560;
const FRAME_SCALE = 0.7;

function ScenarioFrame({ title, url, theme }: { title: string; url: string; theme: GalleryTheme }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    applyFrameTheme(frame.current, theme);
  }, [theme]);
  return (
    <div
      className="relative w-full overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border"
      style={{ height: FRAME_H * FRAME_SCALE }}
    >
      <iframe
        ref={frame}
        title={title}
        src={url}
        loading="lazy"
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${FRAME_SCALE})` }}
        onLoad={() => applyFrameTheme(frame.current, theme)}
      />
    </div>
  );
}

export function ProductPagesSection({ theme }: { theme: GalleryTheme }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [dirOpen, setDirOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  return (
    <Section
      id="product-pages"
      title="Page parts"
      lede="Pieces of the project and schedules pages that are more than a settings row."
    >
      <Specimen
        title="Background tasks"
        note="ProjectAutonomyCard; saving needs the server and reports an error here"
        stage="canvas"
      >
        <div className="w-160">
          <ProjectAutonomyCard projectId={PROJECT} teamId={TEAM} />
        </div>
      </Specimen>
      <Specimen
        title="Folder and branch pickers"
        note={picked ?? 'DirBrowser in its popover; ProjectBaseBranchSelect'}
        stage="canvas"
      >
        <Cell label="DirBrowser">
          <Popover open={dirOpen} onOpenChange={setDirOpen}>
            <PopoverTrigger render={<Button variant="outline" />}>
              <Folder data-icon="inline-start" />
              Browse folders
            </PopoverTrigger>
            {dirOpen && (
              <DirBrowser
                onPick={(path) => {
                  setPicked(`Picked ${path}`);
                  setDirOpen(false);
                }}
              />
            )}
          </Popover>
        </Cell>
        <Cell label="ProjectBaseBranchSelect">
          <ProjectBaseBranchSelect project={GALLERY_PROJECT} />
        </Cell>
      </Specimen>
      <Specimen
        title="Import from GitHub"
        note={picked ?? 'GithubIssuesDialog: filter by state, page, click an issue to import'}
        stage="canvas"
      >
        <Button variant="outline" onClick={() => setIssuesOpen(true)}>
          Import a GitHub issue
        </Button>
        <GithubIssuesDialog
          open={issuesOpen}
          onClose={() => setIssuesOpen(false)}
          projectId={PROJECT}
          teamId={TEAM}
          onImported={(record) => {
            setPicked(`Imported #${record.seqNum}`);
            setIssuesOpen(false);
          }}
        />
      </Specimen>
      <Specimen
        title="Schedule rows"
        note="Iframe of scenario r3-93; ScheduleCard is private to the schedules page"
        stage="canvas"
        className="block"
      >
        <ScenarioFrame title="Schedule rows" url="/app/schedules?scenario=r3-93" theme={theme} />
      </Specimen>
    </Section>
  );
}
