import { isDesignPageName } from '@cairn/shared';
import { createContext } from 'react';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';

export const FILE_PARAM = 'file';
export const FILE_NAME_PARAM = 'fileName';

export interface FileTarget {
  name: string;
  key: string;
}

export type OpenFile = (target: FileTarget, set?: readonly FileTarget[]) => void;

export const OpenFileContext = createContext<OpenFile | undefined>(undefined);

export const FileSetContext = createContext<readonly FileTarget[]>([]);

const ATTACHMENT_REF =
  /!?\[([^\]]*)\]\(attachment:([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]{1,8})\)/g;

export function fileSetOf(text: string): FileTarget[] {
  const seen = new Set<string>();
  const out: FileTarget[] = [];
  for (const match of text.matchAll(ATTACHMENT_REF)) {
    const key = match[2] ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: match[1] || key.slice(key.lastIndexOf('/') + 1) });
  }
  return out;
}

export const OpenDesignPageContext = createContext<((fileName: string) => void) | undefined>(
  undefined,
);

export function attachmentUrl(key: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentIdFromKey(key))}`;
}

export function fileTargetOf(params: URLSearchParams): FileTarget | null {
  const key = params.get(FILE_PARAM);
  if (key === null || key === '') return null;
  return { key, name: params.get(FILE_NAME_PARAM) ?? attachmentIdFromKey(key) };
}

export function withoutFileTarget(params: URLSearchParams): URLSearchParams {
  params.delete(FILE_PARAM);
  params.delete(FILE_NAME_PARAM);
  return params;
}

export function attachmentOpener(
  openers: {
    file: OpenFile | undefined;
    designPage: ((fileName: string) => void) | undefined;
  },
  set: readonly FileTarget[],
  name: string,
  key: string,
): { onOpen?: () => void } {
  const { file, designPage } = openers;
  if (designPage !== undefined && isDesignPageName(name)) return { onOpen: () => designPage(name) };
  return file === undefined ? {} : { onOpen: () => file({ name, key }, set) };
}
