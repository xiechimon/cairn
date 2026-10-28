import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import Database from 'better-sqlite3';

const failures = new Set(['worker-failed', 'worker-unavailable', 'budget-refused']);

export interface EvaluationRequest {
  repo: string;
  pr: number;
  ticket: number;
  expectedHead: string;
  patchDigest: string;
}

export interface EvaluationAttempt extends EvaluationRequest {
  id: string;
  workerId: string;
  createdAt: number;
  deadline: number;
  state: 'uncertain' | 'running' | 'publishing' | 'terminal';
  outcome: string | null;
  requiresHuman: boolean;
  finishedAt?: number;
  publication?: { commit: string } | null;
}

export interface EvaluationStatus {
  state: string;
  result?: unknown;
}

export interface EvaluationWorker {
  dispatch(attempt: EvaluationAttempt): Promise<EvaluationStatus>;
  poll(attempt: EvaluationAttempt): Promise<EvaluationStatus>;
  publication: { command: string; args: string[]; timeoutMs: number };
}

export class EvaluationCoordinator {
  private database: string;
  private worker: EvaluationWorker;
  private timeoutMs: number;
  private now: () => number;
  constructor({
    database,
    worker,
    timeoutMs,
    now = Date.now,
  }: {
    database: string;
    worker: EvaluationWorker;
    timeoutMs: number;
    now?: () => number;
  }) {
    if (typeof database !== 'string' || !isAbsolute(database))
      throw new Error('A persistent absolute database path is required');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new Error('A positive deadline duration is required');
    if (
      'publish' in worker ||
      !worker.publication ||
      typeof worker.publication.command !== 'string' ||
      !isAbsolute(worker.publication.command) ||
      !Array.isArray(worker.publication.args) ||
      !worker.publication.args.every((arg) => typeof arg === 'string') ||
      !Number.isSafeInteger(worker.publication.timeoutMs) ||
      worker.publication.timeoutMs <= 0
    )
      throw new Error('A bounded synchronous publication command is required');
    this.database = database;
    this.worker = worker;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.transaction((db) => {
      db.prepare('SELECT worker_id FROM harness_eval_attempts LIMIT 1').get();
      db.prepare('SELECT worker_id FROM harness_eval_current LIMIT 1').get();
    });
  }

  transaction<T>(action: (db: Database.Database) => T): T {
    const db = new Database(this.database);
    try {
      db.exec('PRAGMA busy_timeout = 10000; PRAGMA synchronous = FULL; BEGIN IMMEDIATE');
      const result = action(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      db.close();
    }
  }

  read(db: Database.Database, workerId: string): EvaluationAttempt {
    const row = db
      .prepare('SELECT record FROM harness_eval_attempts WHERE worker_id = ?')
      .get(workerId) as { record: string } | undefined;
    if (!row) throw new Error('Worker identity is unknown');
    return JSON.parse(row.record);
  }

  save(db: Database.Database, attempt: EvaluationAttempt): EvaluationAttempt {
    db.prepare('UPDATE harness_eval_attempts SET record = ? WHERE worker_id = ?').run(
      JSON.stringify(attempt),
      attempt.workerId,
    );
    return attempt;
  }

  finish(
    db: Database.Database,
    attempt: EvaluationAttempt,
    outcome: string,
    publication: { commit: string } | null = null,
  ): EvaluationAttempt {
    return this.save(db, {
      ...attempt,
      state: 'terminal',
      outcome,
      requiresHuman: outcome !== 'completed' && outcome !== 'superseded',
      finishedAt: this.now(),
      publication,
    });
  }

  authorized(db: Database.Database, attempt: EvaluationAttempt): EvaluationAttempt {
    if (attempt.state === 'terminal') return attempt;
    const current = db
      .prepare('SELECT worker_id FROM harness_eval_current WHERE repo = ? AND pr = ?')
      .get(attempt.repo, attempt.pr) as { worker_id: string } | undefined;
    if (current?.worker_id !== attempt.workerId) return this.finish(db, attempt, 'superseded');
    if (this.now() >= attempt.deadline) return this.finish(db, attempt, 'timed-out');
    return attempt;
  }

  async request(input: EvaluationRequest): Promise<EvaluationAttempt> {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(input.repo) ||
      !Number.isSafeInteger(input.pr) ||
      input.pr <= 0 ||
      !Number.isSafeInteger(input.ticket) ||
      input.ticket <= 0 ||
      !/^[a-f0-9]{40}$/.test(input.expectedHead) ||
      !/^pd2:[a-f0-9]{64}$/.test(input.patchDigest)
    )
      throw new Error('Invalid evaluation request');
    const repo = input.repo.toLowerCase();
    const claimed = this.transaction((db) => {
      const existing = db
        .prepare(
          'SELECT worker_id FROM harness_eval_attempts WHERE repo = ? AND pr = ? AND digest = ?',
        )
        .get(repo, input.pr, input.patchDigest) as { worker_id: string } | undefined;
      if (existing)
        return { created: false, attempt: this.authorized(db, this.read(db, existing.worker_id)) };
      const createdAt = this.now();
      const deadline = createdAt + this.timeoutMs;
      if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !Number.isSafeInteger(deadline))
        throw new Error('Invalid evaluation deadline');
      const current = db
        .prepare('SELECT worker_id FROM harness_eval_current WHERE repo = ? AND pr = ?')
        .get(repo, input.pr) as { worker_id: string } | undefined;
      if (current) {
        const previous = this.read(db, current.worker_id);
        if (previous.state !== 'terminal') this.finish(db, previous, 'superseded');
      }
      const attempt: EvaluationAttempt = {
        ...input,
        repo,
        id: randomUUID(),
        workerId: randomUUID(),
        createdAt,
        deadline,
        state: 'uncertain',
        outcome: null,
        requiresHuman: false,
      };
      db.prepare('INSERT INTO harness_eval_attempts VALUES (?, ?, ?, ?, ?)').run(
        attempt.workerId,
        repo,
        input.pr,
        input.patchDigest,
        JSON.stringify(attempt),
      );
      db.prepare(
        'INSERT INTO harness_eval_current VALUES (?, ?, ?) ON CONFLICT(repo, pr) DO UPDATE SET worker_id = excluded.worker_id',
      ).run(repo, input.pr, attempt.workerId);
      return { created: true, attempt };
    });
    if (!claimed.created) return claimed.attempt;
    let acknowledgment: EvaluationStatus;
    try {
      acknowledgment = await this.worker.dispatch(claimed.attempt);
    } catch {
      acknowledgment = { state: 'unknown' };
    }
    return this.transaction((db) => {
      const attempt = this.read(db, claimed.attempt.workerId);
      if (attempt.state === 'terminal') return attempt;
      const current = db
        .prepare('SELECT worker_id FROM harness_eval_current WHERE repo = ? AND pr = ?')
        .get(attempt.repo, attempt.pr) as { worker_id: string } | undefined;
      if (current?.worker_id !== attempt.workerId) return this.finish(db, attempt, 'superseded');
      if (failures.has(acknowledgment?.state))
        return this.finish(db, attempt, acknowledgment.state);
      if (acknowledgment?.state !== 'accepted') return attempt;
      const deadline = this.now() + this.timeoutMs;
      if (!Number.isSafeInteger(deadline)) throw new Error('Invalid evaluation deadline');
      return this.save(db, { ...attempt, state: 'running', deadline });
    });
  }

  async reconcile(workerId: string): Promise<EvaluationAttempt> {
    const attempt = this.transaction((db) => {
      const record = this.authorized(db, this.read(db, workerId));
      if (record.state === 'publishing') return this.finish(db, record, 'publication-uncertain');
      return record;
    });
    if (attempt.state === 'terminal') return attempt;
    let status: EvaluationStatus;
    try {
      status = await this.worker.poll(attempt);
    } catch {
      status = { state: 'unknown' };
    }
    return this.complete(attempt.id, workerId, status);
  }

  async complete(
    attemptId: string,
    workerId: string,
    status: EvaluationStatus,
  ): Promise<EvaluationAttempt> {
    const ready = this.transaction((db) => {
      const attempt = this.read(db, workerId);
      if (attempt.id !== attemptId) throw new Error('Worker identity mismatch');
      const record = this.authorized(db, attempt);
      if (record.state === 'terminal' || record.state === 'publishing')
        return { publish: false, record };
      if (failures.has(status?.state))
        return { publish: false, record: this.finish(db, record, status.state) };
      if (status?.state !== 'complete') return { publish: false, record };
      return { publish: true, record: this.save(db, { ...record, state: 'publishing' }) };
    });
    if (!ready.publish) return ready.record;
    return this.transaction((db) => {
      const record = this.authorized(db, this.read(db, workerId));
      if (record.state !== 'publishing') return record;
      try {
        const publication: unknown = JSON.parse(
          execFileSync(this.worker.publication.command, this.worker.publication.args, {
            input: JSON.stringify({ attempt: record, result: status.result }),
            encoding: 'utf8',
            timeout: Math.min(this.worker.publication.timeoutMs, record.deadline - this.now()),
            killSignal: 'SIGKILL',
            maxBuffer: 1024 * 1024,
          }),
        );
        if (
          !publication ||
          typeof publication !== 'object' ||
          !('commit' in publication) ||
          typeof publication.commit !== 'string' ||
          !/^[a-f0-9]{40}$/.test(publication.commit)
        )
          throw new Error('Invalid publication acknowledgment');
        return this.finish(db, record, 'completed', { commit: publication.commit });
      } catch {
        return this.finish(db, record, 'publication-rejected');
      }
    });
  }

  async reconcileAll() {
    const ids = this.transaction((db) =>
      db
        .prepare('SELECT worker_id FROM harness_eval_attempts')
        .all()
        .map((row) => (row as { worker_id: string }).worker_id),
    );
    const records = [];
    for (const id of ids) records.push(await this.reconcile(id));
    return records;
  }
}
