import { type DesignPageRecord, type DesignVersionRecord, isDesignPageName } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { designPagesQuery, designVersionsQuery } from '../../api/hooks.js';
import { type DesignPageTarget, FILE_NAME_PARAM, FILE_PARAM } from '../file-pane.js';
import { THREAD_PARAM, VIEW_PARAM } from '../thread-copy.js';
import { PANE_PARAM, TASKS_TAB_PARAM } from '../work-panel.js';

export const DESIGN_VIEW = 'design';
export const DESIGN_PAGE_PARAM = 'page';

export interface DesignTarget {
  todoId: string;
  fileName: string | null;
}

export function pickPage(
  pages: readonly DesignPageRecord[],
  fileName: string | null,
): DesignPageRecord | undefined {
  return pages.find((page) => page.fileName === fileName) ?? pages[0];
}

export function designTargetOf(params: URLSearchParams): DesignTarget | null {
  const todoId = params.get(THREAD_PARAM);
  if (params.get(VIEW_PARAM) !== DESIGN_VIEW || todoId === null || todoId === '') return null;
  const fileName = params.get(DESIGN_PAGE_PARAM);
  return { todoId, fileName: fileName === null || fileName === '' ? null : fileName };
}

export function withDesignTarget(prev: URLSearchParams, target: DesignTarget): URLSearchParams {
  const params = new URLSearchParams(prev);
  params.delete(PANE_PARAM);
  params.delete(TASKS_TAB_PARAM);
  params.delete(FILE_PARAM);
  params.delete(FILE_NAME_PARAM);
  params.set(VIEW_PARAM, DESIGN_VIEW);
  params.set(THREAD_PARAM, target.todoId);
  if (target.fileName === null) params.delete(DESIGN_PAGE_PARAM);
  else params.set(DESIGN_PAGE_PARAM, target.fileName);
  return params;
}

export function withoutDesignTarget(prev: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(prev);
  params.delete(VIEW_PARAM);
  params.delete(THREAD_PARAM);
  params.delete(DESIGN_PAGE_PARAM);
  return params;
}

export function useOpenDesign(): (todoId: string, fileName?: string | null) => void {
  const [, setSearchParams] = useSearchParams();
  return useCallback(
    (todoId: string, fileName: string | null = null) =>
      setSearchParams((prev) => withDesignTarget(prev, { todoId, fileName })),
    [setSearchParams],
  );
}

export async function designPageOfAttachment(
  target: DesignPageTarget,
  pages: readonly DesignPageRecord[],
  versionsOf: (fileName: string) => Promise<readonly DesignVersionRecord[]>,
): Promise<string | null> {
  const current = pages.find((page) => page.current.attachmentId === target.attachmentId);
  if (current !== undefined) return current.fileName;
  for (const page of pages) {
    const versions = await versionsOf(page.fileName);
    if (versions.some((version) => version.attachmentId === target.attachmentId))
      return page.fileName;
  }
  return isDesignPageName(target.name) ? target.name : null;
}

export function useOpenDesignAttachment(todoId: string): (target: DesignPageTarget) => void {
  const openDesign = useOpenDesign();
  const qc = useQueryClient();
  return useCallback(
    (target: DesignPageTarget) => {
      const resolve = async () => {
        const { pages } = await qc.fetchQuery(designPagesQuery(todoId));
        return designPageOfAttachment(target, pages, (fileName) =>
          qc.fetchQuery(designVersionsQuery(todoId, fileName)),
        );
      };
      void resolve().then(
        (fileName) => openDesign(todoId, fileName),
        () => openDesign(todoId, isDesignPageName(target.name) ? target.name : null),
      );
    },
    [qc, openDesign, todoId],
  );
}
