import { cn } from 'cn';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useArtifactOf, useTodo } from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { FileGlyph } from '../../components/file-glyph.js';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { attachmentIdFromKey } from '../../detail/attachment-chip.js';
import { useI18n } from '../../i18n/provider.js';
import type { FileTarget } from '../file-pane.js';
import { usePanelDocked } from '../use-narrow.js';
import { type ArtifactPanelState, useArtifactPanel } from './artifact-route.js';
import { FileArtifact } from './file-artifact.js';
import { PageArtifact, type SendDesignComments } from './page-artifact.js';

type Focus = 'chat' | 'artifact';

const CHAT_BESIDE_ARTIFACT = 'flex-none w-[clamp(440px,46%,760px)]';
const HEAD_ICON = 'text-content-secondary hover:text-foreground';

export interface ArtifactRef {
  todoId: string;
  fileName: string;
}

export function useActiveArtifact(): ArtifactRef | null {
  const { live } = useLiveData();
  const { target } = useArtifactPanel();
  const artifactQ = useArtifactOf(attachmentIdFromKey(target?.key ?? ''), live && target !== null);
  const artifact = target === null ? null : (artifactQ.data ?? null);
  return artifact === null ? null : { todoId: artifact.todoId, fileName: artifact.fileName };
}

export interface ArtifactSplit {
  sectionClass: string;
  chatBar: ReactNode;
  pane: ReactNode;
}

function FocusSwitch({ value, onChange }: { value: Focus; onChange: (next: Focus) => void }) {
  const { t } = useI18n();
  return (
    <SegmentedTabs
      value={value}
      label={t('对话或文件')}
      onChange={onChange}
      options={[
        { value: 'chat', label: t('对话'), testId: 'artifact-focus-chat' },
        { value: 'artifact', label: t('文件'), testId: 'artifact-focus-artifact' },
      ]}
    />
  );
}

export function useArtifactSplit(
  sendComments: SendDesignComments | undefined,
): ArtifactSplit | null {
  const wide = usePanelDocked();
  const panel = useArtifactPanel();
  const [focus, setFocus] = useState<Focus>('artifact');
  const [full, setFull] = useState(false);
  if (panel.target === null) return null;
  const switcher = wide ? null : <FocusSwitch value={focus} onChange={setFocus} />;
  return {
    sectionClass: wide
      ? full
        ? 'hidden'
        : CHAT_BESIDE_ARTIFACT
      : focus === 'artifact'
        ? 'hidden'
        : '',
    chatBar: !wide && focus === 'chat' && (
      <div
        data-testid="artifact-chat-bar"
        className="flex h-12 flex-none items-center border-b border-border px-3"
      >
        {switcher}
      </div>
    ),
    pane: (
      <ArtifactPanel
        panel={panel}
        target={panel.target}
        switcher={focus === 'artifact' ? switcher : null}
        hidden={!wide && focus === 'chat'}
        full={wide ? { on: full, toggle: () => setFull((on) => !on) } : null}
        sendComments={sendComments}
      />
    ),
  };
}

function ArtifactPanel({
  panel,
  target,
  switcher,
  hidden,
  full,
  sendComments,
}: {
  panel: ArtifactPanelState;
  target: FileTarget;
  switcher: ReactNode;
  hidden: boolean;
  full: { on: boolean; toggle: () => void } | null;
  sendComments: SendDesignComments | undefined;
}) {
  const { t } = useI18n();
  return (
    <aside
      data-testid="artifact-panel"
      aria-label={t('文件')}
      hidden={hidden}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-border bg-background max-[1100px]:border-l-0"
    >
      <div className="flex h-12 flex-none items-center gap-1 pr-2 pl-3">
        {switcher}
        <nav aria-label={t('打开的文件')} className="flex min-w-0 flex-1 gap-0.5 overflow-hidden">
          {panel.tabs.map((tab) => (
            <ArtifactTabButton
              key={tab.key}
              tab={tab}
              active={tab.key === target.key}
              onSelect={() => panel.select(tab)}
              onClose={() => panel.closeTab(tab.key)}
            />
          ))}
        </nav>
        {full !== null && (
          <IconTooltip
            label={full.on ? t('退出全屏') : t('全屏')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="artifact-full"
                aria-pressed={full.on}
                onClick={full.toggle}
                className={HEAD_ICON}
              />
            }
          >
            {full.on ? (
              <Minimize2 aria-hidden className="size-4" />
            ) : (
              <Maximize2 aria-hidden className="size-4" />
            )}
          </IconTooltip>
        )}
        <IconTooltip
          label={t('关闭文件面板')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="artifact-close"
              onClick={panel.closePanel}
              className={`${HEAD_ICON} pointer-coarse:size-11`}
            />
          }
        >
          <X aria-hidden className="size-5" />
        </IconTooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <ArtifactTab key={target.key} target={target} sendComments={sendComments} />
      </div>
    </aside>
  );
}

function ArtifactTabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: FileTarget;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="artifact-tab"
      data-active={active || undefined}
      className={cn(
        'group/tab relative flex h-7.5 max-w-44 min-w-14 items-center rounded-(--radius-control) text-ui text-content-tertiary hover:bg-(--hover-1) hover:text-content-secondary',
        active
          ? 'flex-none bg-popover text-foreground shadow-(--e1) max-[760px]:max-w-none max-[760px]:flex-1'
          : 'flex-[0_1_auto] max-[760px]:hidden',
      )}
    >
      <Button
        variant="ghost"
        aria-current={active ? 'true' : undefined}
        title={tab.name}
        onClick={onSelect}
        className="h-full min-w-0 flex-1 justify-start gap-1.5 rounded-(--radius-control) pr-1 pl-2 text-ui font-normal text-inherit hover:bg-transparent hover:text-inherit dark:hover:bg-transparent"
      >
        <FileGlyph name={tab.key} />
        <span className="truncate">{tab.name}</span>
      </Button>
      <IconTooltip
        label={t('关闭 {name}', { name: tab.name })}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid="artifact-tab-close"
            onClick={onClose}
            className={cn(
              'mr-1 size-4.5 flex-none rounded-(--cds-radius-md) text-content-tertiary hover:text-foreground',
              !active && 'invisible group-hover/tab:visible group-focus-within/tab:visible',
            )}
          />
        }
      >
        <X aria-hidden className="size-4" />
      </IconTooltip>
    </div>
  );
}

function ArtifactTab({
  target,
  sendComments,
}: {
  target: FileTarget;
  sendComments: SendDesignComments | undefined;
}) {
  const { live } = useLiveData();
  const artifactQ = useArtifactOf(attachmentIdFromKey(target.key), live);
  const artifact = artifactQ.data ?? null;
  const todoQ = useTodo(artifact?.todoId ?? '', live && artifact !== null);
  const readOnly = todoQ.data?.archivedAt != null;
  if (live && artifactQ.isPending) {
    return (
      <div data-testid="artifact-loading" aria-busy="true" className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 flex-none items-center border-b border-border px-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="m-6 min-h-0 flex-1 rounded-(--radius-tile)" />
      </div>
    );
  }
  if (artifact?.kind === 'page') {
    return (
      <PageArtifact
        todoId={artifact.todoId}
        fileName={artifact.fileName}
        openedVersionId={artifact.versionId}
        readOnly={readOnly}
        sendComments={sendComments}
      />
    );
  }
  return (
    <FileArtifact
      target={target}
      artifact={artifact}
      readOnly={readOnly}
      sendComments={sendComments}
    />
  );
}
