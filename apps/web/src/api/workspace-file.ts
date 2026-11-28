import { type WorkspaceFileResult, workspaceFileResultSchema } from '@cairn/shared';
import { ApiError, api } from './client.js';

export interface WorkspaceFileSource {
  conversationId: string;
  messageId: string;
}

export type WorkspaceFileOutcome = WorkspaceFileResult | { status: 'offline' };

const UNAVAILABLE: WorkspaceFileOutcome = { status: 'unavailable' };

function classify(body: unknown): WorkspaceFileOutcome {
  const result = workspaceFileResultSchema.safeParse(body);
  if (result.success) return result.data;
  const status = (body as { status?: unknown } | null)?.status;
  return status === 'offline' ? { status } : UNAVAILABLE;
}

export async function readWorkspaceFile(
  source: WorkspaceFileSource,
  path: string,
  signal: AbortSignal,
): Promise<WorkspaceFileOutcome> {
  const url = `/api/conversations/${encodeURIComponent(source.conversationId)}/messages/${encodeURIComponent(source.messageId)}/file`;
  try {
    return classify(await api.post<unknown>(url, { path }, signal));
  } catch (error) {
    return error instanceof ApiError ? classify(error.data) : UNAVAILABLE;
  }
}
