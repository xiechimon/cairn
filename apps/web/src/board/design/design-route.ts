import type { DesignPageRecord } from '@cairn/shared';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { FILE_NAME_PARAM, FILE_PARAM } from '../file-pane.js';
import { THREAD_PARAM, VIEW_PARAM } from '../thread-copy.js';
import { PANE_PARAM, TASKS_TAB_PARAM } from '../work-panel.js';

export const DESIGN_VIEW = 'design';

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
  const fileName = params.get(FILE_PARAM);
  return { todoId, fileName: fileName === null || fileName === '' ? null : fileName };
}

export function withDesignTarget(prev: URLSearchParams, target: DesignTarget): URLSearchParams {
  const params = new URLSearchParams(prev);
  params.delete(PANE_PARAM);
  params.delete(TASKS_TAB_PARAM);
  params.delete(FILE_NAME_PARAM);
  params.set(VIEW_PARAM, DESIGN_VIEW);
  params.set(THREAD_PARAM, target.todoId);
  if (target.fileName === null) params.delete(FILE_PARAM);
  else params.set(FILE_PARAM, target.fileName);
  return params;
}

export function withoutDesignTarget(prev: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(prev);
  params.delete(VIEW_PARAM);
  params.delete(THREAD_PARAM);
  params.delete(FILE_PARAM);
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
