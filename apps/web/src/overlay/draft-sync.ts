import type { DraftTransport } from '../api/drafts.js';

export const DRAFT_SAVE_DEBOUNCE_MS = 500;

interface SyncMeta {
  at: number | null;
  dirty: boolean;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftSyncOptions {
  transport: DraftTransport;
  storage: DraftStorage;
  localKey: string;
  onRemote: (text: string) => void;
  debounceMs?: number;
}

function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export class DraftSync {
  private text: string;
  private meta: SyncMeta;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private disposed = false;
  private version = 0;
  private readSeq = 0;
  private drain = false;
  private keepalive = false;
  private readonly metaKey: string;
  private readonly debounceMs: number;

  constructor(private readonly options: DraftSyncOptions) {
    this.metaKey = `${options.localKey}.sync`;
    this.debounceMs = options.debounceMs ?? DRAFT_SAVE_DEBOUNCE_MS;
    this.text = safely(() => options.storage.getItem(options.localKey) ?? '', '');
    this.meta = this.readMeta();
  }

  current(): string {
    return this.text;
  }

  edit(text: string): void {
    if (this.disposed || text === this.text) return;
    this.version += 1;
    this.text = text;
    this.writeLocal();
    this.setMeta({ at: this.meta.at, dirty: true });
    if (text === '') void this.flush();
    else this.schedule();
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.meta.dirty) {
      await this.flush();
      return;
    }
    const startedAt = this.version;
    this.readSeq += 1;
    const seq = this.readSeq;
    let remote: Awaited<ReturnType<DraftTransport['load']>>;
    try {
      remote = await this.options.transport.load();
    } catch {
      return;
    }
    if (this.disposed || seq !== this.readSeq || startedAt !== this.version || this.meta.dirty) {
      return;
    }
    if (remote.updatedAt === this.meta.at) return;
    this.text = remote.content;
    this.writeLocal();
    this.setMeta({ at: remote.updatedAt, dirty: false });
    this.options.onRemote(remote.content);
  }

  flush(options: { keepalive?: boolean } = {}): Promise<void> {
    this.cancelTimer();
    if (this.saving !== null) {
      this.drain = true;
      this.keepalive ||= options.keepalive === true;
      return this.saving;
    }
    if (!this.meta.dirty) return Promise.resolve();
    this.drain = false;
    this.keepalive = options.keepalive === true;
    const saving = this.saveLoop().finally(() => {
      this.saving = null;
    });
    this.saving = saving;
    return saving;
  }

  dispose(): void {
    if (this.disposed) return;
    void this.flush({ keepalive: true });
    this.disposed = true;
    this.cancelTimer();
  }

  private async saveLoop(): Promise<void> {
    while (this.meta.dirty) {
      const sent = this.text;
      this.version += 1;
      let saved: Awaited<ReturnType<DraftTransport['save']>>;
      try {
        saved = await this.options.transport.save(sent, { keepalive: this.keepalive });
      } catch {
        return;
      }
      this.version += 1;
      const changedMeanwhile = this.text !== sent;
      this.setMeta({ at: saved.updatedAt, dirty: changedMeanwhile });
      if (!changedMeanwhile) return;
      if (!this.drain && this.text !== '') {
        if (!this.disposed) this.schedule();
        return;
      }
    }
  }

  private schedule(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private readMeta(): SyncMeta {
    const raw = safely(() => this.options.storage.getItem(this.metaKey), null);
    if (raw !== null) {
      const parsed = safely<Partial<SyncMeta> | null>(() => JSON.parse(raw), null);
      if (parsed !== null && typeof parsed.dirty === 'boolean') {
        return { at: typeof parsed.at === 'number' ? parsed.at : null, dirty: parsed.dirty };
      }
    }
    return { at: null, dirty: this.text !== '' };
  }

  private setMeta(meta: SyncMeta): void {
    this.meta = meta;
    safely(() => this.options.storage.setItem(this.metaKey, JSON.stringify(meta)), undefined);
  }

  private writeLocal(): void {
    safely(() => {
      if (this.text === '') this.options.storage.removeItem(this.options.localKey);
      else this.options.storage.setItem(this.options.localKey, this.text);
    }, undefined);
  }
}
