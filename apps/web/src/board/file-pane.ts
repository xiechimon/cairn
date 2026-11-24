import { createContext } from 'react';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';

export const ARTIFACT_PARAM = 'artifact';
export const ARTIFACT_NAME_PARAM = 'artifactName';

export interface FileTarget {
  name: string;
  key: string;
}

export type OpenFile = (target: FileTarget) => void;

export const OpenFileContext = createContext<OpenFile | undefined>(undefined);

export function attachmentUrl(key: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentIdFromKey(key))}`;
}

export function downloadFile(href: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
