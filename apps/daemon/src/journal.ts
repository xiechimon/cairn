import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, MachineDoneBody, StepKind, TranscriptUpload } from '@cairn/shared';
import type { StopRequest } from './step-stops.js';

export type JournalState = 'claimed' | 'running' | 'awaiting-upload' | 'done' | 'failed';

export interface StepJournalEntry {
  stepId: string;
  buildId: string;
  kind: StepKind;
  conversationId: string;
  state: JournalState;
  sessionAction: 'new' | 'continue';
  sessionId: string | null;
  prompt: string | null;
  claimed: ClaimedStep | null;
  doneBody?: MachineDoneBody | null;
  planContent?: string | null;
  sessionFile?: string | null;
  stopRequest?: StopRequest | null;
  claimedAt: number;
  updatedAt: number;
}

export type TranscriptMessage = TranscriptUpload['messages'][number];

export class StepJournal {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(stepId: string): string {
    return join(this.dir, `step-${stepId}.json`);
  }

  claim(
    input: Omit<StepJournalEntry, 'state' | 'claimedAt' | 'updatedAt' | 'sessionId' | 'claimed'> & {
      sessionId?: string | null;
      claimed?: ClaimedStep | null;
    },
  ): StepJournalEntry {
    const now = Date.now();
    const entry: StepJournalEntry = {
      ...input,
      sessionId: input.sessionId ?? null,
      claimed: input.claimed ?? null,
      state: 'claimed',
      claimedAt: now,
      updatedAt: now,
    };
    this.write(entry);
    return entry;
  }

  update(
    stepId: string,
    patch: Partial<Omit<StepJournalEntry, 'stepId'>>,
  ): StepJournalEntry | null {
    const entry = this.get(stepId);
    if (!entry) return null;
    const next = { ...entry, ...patch, stepId, updatedAt: Date.now() };
    this.write(next);
    return next;
  }

  get(stepId: string): StepJournalEntry | null {
    if (!existsSync(this.file(stepId))) return null;
    try {
      return JSON.parse(readFileSync(this.file(stepId), 'utf8')) as StepJournalEntry;
    } catch {
      return null;
    }
  }

  pending(): StepJournalEntry[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.startsWith('step-') && f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as StepJournalEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is StepJournalEntry => e !== null)
      .filter(
        (e) => e.state === 'claimed' || e.state === 'running' || e.state === 'awaiting-upload',
      )
      .sort((a, b) => a.claimedAt - b.claimedAt);
  }

  remove(stepId: string): void {
    if (existsSync(this.file(stepId))) rmSync(this.file(stepId));
  }

  private write(entry: StepJournalEntry): void {
    writeFileSync(this.file(entry.stepId), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }
}

export class TranscriptBuffer {
  private readonly file: string;
  private readonly rows = new Map<string, TranscriptMessage>();

  constructor(dir: string, stepId: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `step-${stepId}.transcript.json`);
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as TranscriptMessage[];
        for (const m of raw) this.rows.set(m.id, m);
      } catch {}
    }
  }

  upsert(msg: TranscriptMessage): void {
    this.rows.set(msg.id, msg);
    this.flush();
  }

  messages(): TranscriptMessage[] {
    return [...this.rows.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  private flush(): void {
    writeFileSync(this.file, `${JSON.stringify(this.messages(), null, 2)}\n`, 'utf8');
  }
}
