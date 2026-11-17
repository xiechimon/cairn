export function installConversationStreams(registryName: string): void {
  type Frame = { data: string };
  type Entry = {
    url: string;
    readyState: number;
    onmessage: ((event: Frame) => void) | null;
    emit?: (ev: unknown) => void;
    virtual?: boolean;
  };
  const w = window as unknown as Record<string, Entry[]>;
  const registry = (): Entry[] => w[registryName] as Entry[];
  const isTeamStream = (entry: Entry) =>
    entry.virtual !== true && /\/api\/teams\/[^/]+\/stream/.test(entry.url);
  const currentTeamStream = () =>
    registry().find((entry) => isTeamStream(entry) && entry.readyState !== 2);
  const greeted = new Set<Entry>();
  let connections = 0;

  setInterval(() => {
    for (const entry of registry()) {
      if (!isTeamStream(entry) || entry.readyState === 2 || greeted.has(entry)) continue;
      if (entry.onmessage === null) continue;
      greeted.add(entry);
      connections += 1;
      entry.onmessage({
        data: JSON.stringify({ type: 'hello', connectionId: `e2e-${connections}` }),
      });
    }
  }, 10);

  const followed = new Map<string, Entry>();
  const forward = (conversationId: string, ev: unknown) => {
    const frame =
      (ev as { type?: string }).type === 'ping'
        ? ev
        : { type: 'conversation', conversationId, event: ev };
    currentTeamStream()?.onmessage?.({ data: JSON.stringify(frame) });
  };
  const sync = (ids: string[]) => {
    for (const [id, entry] of followed) {
      if (ids.includes(id)) continue;
      entry.readyState = 2;
      followed.delete(id);
    }
    for (const id of ids) {
      if (followed.has(id)) continue;
      const entry: Entry = {
        url: `/api/conversations/${id}/stream`,
        readyState: 1,
        virtual: true,
        onmessage: (event) => forward(id, JSON.parse(event.data)),
        emit: (ev) => forward(id, ev),
      };
      followed.set(id, entry);
      registry().push(entry);
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const path = new URL(raw, location.href).pathname;
    if (/^\/api\/streams\/[^/]+\/conversations$/.test(path) && init?.method === 'PUT') {
      sync((JSON.parse(String(init.body)) as { conversationIds: string[] }).conversationIds);
      return new Response(null, { status: 204 });
    }
    return originalFetch(input, init);
  };
}
