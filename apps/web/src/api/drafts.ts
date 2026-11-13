import { api } from './client.js';

export interface DraftSnapshot {
  content: string;
  updatedAt: number | null;
}

export interface DraftTransport {
  load(): Promise<DraftSnapshot>;
  save(content: string, options?: { keepalive?: boolean }): Promise<DraftSnapshot>;
}

function checked(value: unknown): DraftSnapshot {
  const snapshot = value as Partial<DraftSnapshot> | null;
  if (
    typeof snapshot?.content !== 'string' ||
    (snapshot.updatedAt !== null && typeof snapshot.updatedAt !== 'number')
  ) {
    throw new Error('malformed draft response');
  }
  return { content: snapshot.content, updatedAt: snapshot.updatedAt };
}

export function draftPath(teamId: string, scope: string): string {
  return `/api/teams/${teamId}/drafts/${scope}`;
}

export function createDraftTransport(teamId: string, scope: string): DraftTransport {
  const path = draftPath(teamId, scope);
  return {
    load: async () => checked(await api.get<unknown>(path)),
    async save(content, options) {
      if (options?.keepalive !== true) return checked(await api.put<unknown>(path, { content }));
      const res = await fetch(path, {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`draft save failed: ${res.status}`);
      return checked(await res.json());
    },
  };
}
