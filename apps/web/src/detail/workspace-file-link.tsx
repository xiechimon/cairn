import { cn } from 'cn';
import { createContext, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  readWorkspaceFile,
  type WorkspaceFileOutcome,
  type WorkspaceFileSource,
} from '../api/workspace-file.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

export const WorkspaceFileConversationContext = createContext<string | null>(null);
export const WorkspaceFileSourceContext = createContext<
  (WorkspaceFileSource & { mentions: ReadonlySet<string> }) | null
>(null);

const INLINE_LINK_CLS =
  'inline h-auto min-w-0 shrink cursor-pointer rounded-sm border-0 p-0 text-start whitespace-normal [font:inherit] [overflow-wrap:anywhere]';

const NOTICE = {
  gone: '这个文件已不在该步骤的工作区中',
  offline: '这台执行机已离线',
  unsupported: '这个文件无法预览',
  unavailable: '暂时无法打开这个文件',
} as const;

interface Opened {
  open: boolean;
  outcome: WorkspaceFileOutcome | null;
}

export function WorkspaceFileLink({
  source,
  path,
  skin,
  children,
}: {
  source: WorkspaceFileSource;
  path: string;
  skin: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [opened, setOpened] = useState<Opened>({ open: false, outcome: null });
  const latest = useRef<AbortController | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => () => latest.current?.abort(), []);
  const show = () => {
    latest.current?.abort();
    const request = new AbortController();
    latest.current = request;
    setOpened({ open: true, outcome: null });
    void readWorkspaceFile(source, path, request.signal).then((outcome) => {
      if (latest.current === request) setOpened({ open: true, outcome });
    });
  };
  const close = () => {
    latest.current?.abort();
    latest.current = null;
    setOpened((current) => ({ ...current, open: false }));
  };
  const { outcome } = opened;
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="link"
        size={null}
        data-testid="message-file-link"
        data-workspace-file={path}
        className={cn(INLINE_LINK_CLS, skin)}
        onClick={show}
      >
        {children}
      </Button>
      <DialogShell
        open={opened.open}
        onClose={(details) => {
          if (details?.reason === 'escape-key') details.event?.preventDefault();
          close();
        }}
        title={path}
        size="l"
        initialFocus={content}
        {...(button.current === null ? {} : { returnFocusTo: button.current })}
      >
        <div
          ref={content}
          tabIndex={-1}
          className="min-h-32 outline-none"
          data-testid="workspace-file-body"
        >
          {outcome === null ? (
            <p role="status" className="m-0 text-meta text-(--text-tertiary)">
              {t('正在打开文件…')}
            </p>
          ) : outcome.status === 'ok' ? (
            <pre
              translate="no"
              className="m-0 font-prose-mono text-code whitespace-pre-wrap text-(--foreground) [overflow-wrap:anywhere]"
              data-testid="workspace-file-text"
            >
              {outcome.text}
            </pre>
          ) : (
            <p className="m-0 text-ui text-(--text-secondary)" data-testid="workspace-file-notice">
              {t(NOTICE[outcome.status])}
            </p>
          )}
        </div>
      </DialogShell>
    </>
  );
}
