export function installConversationStreams(registryName: string): void {
  type Frame = { data: string };
  type Entry = {
    url: string;
    readyState: number;
    onmessage: ((event: Frame) => void) | null;
    emit?: (ev: unknown) => void;
    virtual?: boolean;
  };
  type Attachment = { source: Entry; revision: number; followed: Map<string, Entry> };
  const w = window as unknown as Record<string, Entry[]>;
  const registry = (): Entry[] => w[registryName] as Entry[];
  const isTeamStream = (entry: Entry) =>
    entry.virtual !== true && /\/api\/teams\/[^/]+\/stream/.test(entry.url);
  const greeted = new WeakSet<Entry>();
  const attachments = new Map<string, Attachment>();
  let connections = 0;

  setInterval(() => {
    for (const [id, attachment] of attachments) {
      if (attachment.source.readyState !== 2) continue;
      for (const entry of attachment.followed.values()) entry.readyState = 2;
      attachments.delete(id);
    }
    for (const entry of registry()) {
      if (!isTeamStream(entry) || entry.readyState !== 1 || greeted.has(entry)) continue;
      if (entry.onmessage === null) continue;
      greeted.add(entry);
      const connectionId = `e2e-${++connections}`;
      attachments.set(connectionId, { source: entry, revision: -1, followed: new Map() });
      entry.onmessage({ data: JSON.stringify({ type: 'hello', connectionId, followRevision: true }) });
      entry.onmessage({ data: JSON.stringify({ type: 'ping' }) });
    }
  }, 10);

  setInterval(() => {
    for (const { source } of attachments.values()) {
      if (source.readyState === 1) source.onmessage?.({ data: JSON.stringify({ type: 'ping' }) });
    }
  }, 15_000);

  const sync = (attachment: Attachment, ids: string[]) => {
    const { source, followed } = attachment;
    for (const [id, entry] of followed) {
      if (ids.includes(id)) continue;
      entry.readyState = 2;
      followed.delete(id);
    }
    for (const id of ids) {
      if (followed.has(id)) continue;
      const forward = (ev: unknown) => {
        if (entry.readyState === 2) return;
        const frame = (ev as { type?: string }).type === 'ping' ? ev : { type: 'conversation', conversationId: id, event: ev };
        source.onmessage?.({ data: JSON.stringify(frame) });
      };
      const entry: Entry = {
        url: `/api/conversations/${id}/stream`,
        readyState: 1,
        virtual: true,
        onmessage: (event) => forward(JSON.parse(event.data)),
        emit: forward,
      };
      followed.set(id, entry);
      registry().push(entry);
      forward({ type: 'preview_reset' });
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const path = new URL(raw, location.href).pathname;
    const match = /^\/api\/streams\/([^/]+)\/conversations$/.exec(path);
    if (match && init?.method === 'PUT') {
      const attachment = attachments.get(match[1]!);
      if (attachment === undefined || attachment.source.readyState !== 1) return new Response(null, { status: 404 });
      const { conversationIds, revision } = JSON.parse(String(init.body)) as { conversationIds: string[]; revision: number };
      if (revision > attachment.revision) {
        sync(attachment, conversationIds);
        attachment.revision = revision;
      }
      return Response.json({ revision: attachment.revision });
    }
    return originalFetch(input, init);
  };
}
