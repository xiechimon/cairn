import { createContext } from 'react';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';

export const FILE_PARAM = 'file';
export const FILE_NAME_PARAM = 'fileName';
export const FILE_FROM_THREAD_PARAM = 'fileFrom';

export interface FileTarget {
  name: string;
  key: string;
}

export const OpenFileContext = createContext<((target: FileTarget) => void) | undefined>(undefined);

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
  params.delete(FILE_FROM_THREAD_PARAM);
  return params;
}

export function attachmentOpener(
  openFile: ((target: FileTarget) => void) | undefined,
  name: string,
  key: string,
): { onOpen?: () => void } {
  return openFile === undefined ? {} : { onOpen: () => openFile({ name, key }) };
}
