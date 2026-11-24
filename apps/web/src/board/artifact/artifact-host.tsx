import type { ArtifactOfAttachment } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback } from 'react';
import { artifactOfQuery } from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { attachmentIdFromKey } from '../../detail/attachment-chip.js';
import { type FileTarget, type OpenFile, OpenFileContext } from '../file-pane.js';
import { useArtifactPanel } from './artifact-route.js';

function sameArtifact(a: ArtifactOfAttachment | null | undefined, b: ArtifactOfAttachment | null) {
  return a != null && b !== null && a.todoId === b.todoId && a.fileName === b.fileName;
}

export function ArtifactHost({ children }: { children: ReactNode }) {
  const { live } = useLiveData();
  const qc = useQueryClient();
  const { open, tabs } = useArtifactPanel();
  const openFile = useCallback<OpenFile>(
    (target: FileTarget) => {
      if (!live) {
        open(target);
        return;
      }
      void qc.fetchQuery(artifactOfQuery(attachmentIdFromKey(target.key))).then(
        (artifact) => {
          const twin = tabs.find(
            (tab) =>
              tab.key !== target.key &&
              sameArtifact(
                qc.getQueryData(artifactOfQuery(attachmentIdFromKey(tab.key)).queryKey),
                artifact,
              ),
          );
          open(target, twin?.key ?? null);
        },
        () => open(target),
      );
    },
    [live, qc, open, tabs],
  );
  return <OpenFileContext.Provider value={openFile}>{children}</OpenFileContext.Provider>;
}
