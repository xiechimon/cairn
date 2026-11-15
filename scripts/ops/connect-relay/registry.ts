import { RelayLedger } from './ledger';

type Grant = { digest: string; epoch: string; expiresAt: number };
type Session = { digest: string; deviceId: string; expiresAt: number; position: number };
const digestPattern = /^[a-f0-9]{64}$/;
const epochPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const grantLifetime = 5 * 60_000;
const sessionLifetime = 30 * 86_400_000;

export class RelayRegistry {
  private ledger: RelayLedger;

  constructor(
    private storage: Pick<DurableObjectStorage, 'sql' | 'transactionSync'>,
    installation: string,
  ) {
    this.ledger = new RelayLedger(storage, installation);
  }

  private access<T>(now: number, change: (grants: Grant[], sessions: Session[]) => T): T {
    this.ledger.reserve(now, {});
    return this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      const grants = sql.exec<Grant>('SELECT * FROM relay_grant LIMIT 21').toArray();
      const sessions = sql
        .exec<Session>('SELECT * FROM relay_session ORDER BY position LIMIT 51')
        .toArray();
      if (
        grants.length > 20 ||
        sessions.length > 50 ||
        grants.some(
          (row) =>
            !digestPattern.test(row.digest) ||
            !epochPattern.test(row.epoch) ||
            !Number.isSafeInteger(row.expiresAt) ||
            row.expiresAt <= 0 ||
            row.expiresAt > now + grantLifetime,
        ) ||
        sessions.some(
          (row) =>
            !digestPattern.test(row.digest) ||
            typeof row.deviceId !== 'string' ||
            row.deviceId.length < 1 ||
            row.deviceId.length > 128 ||
            !Number.isSafeInteger(row.position) ||
            row.position < 1 ||
            !Number.isSafeInteger(row.expiresAt) ||
            row.expiresAt <= 0 ||
            row.expiresAt > now + sessionLifetime,
        )
      ) {
        throw new Error('registry unavailable');
      }
      sql.exec('DELETE FROM relay_grant WHERE expiresAt <= ?', now);
      sql.exec('DELETE FROM relay_session WHERE expiresAt <= ?', now);
      return change(
        grants.filter((row) => row.expiresAt > now),
        sessions.filter((row) => row.expiresAt > now),
      );
    });
  }

  putGrant(now: number, grant: Grant): boolean {
    if (
      !digestPattern.test(grant.digest) ||
      !epochPattern.test(grant.epoch) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= now ||
      grant.expiresAt > now + grantLifetime
    ) {
      throw new Error('invalid grant');
    }
    return this.access(now, (grants) => {
      const existing = grants.find((row) => row.digest === grant.digest);
      if (existing) {
        return existing.epoch === grant.epoch && existing.expiresAt === grant.expiresAt;
      }
      if (grants.length === 20) return false;
      this.storage.sql.exec(
        'INSERT INTO relay_grant VALUES (?, ?, ?)',
        grant.digest,
        grant.epoch,
        grant.expiresAt,
      );
      return true;
    });
  }

  consumeGrant(now: number, digest: string, epoch: string): boolean {
    return this.access(now, (grants) => {
      if (!grants.some((row) => row.digest === digest && row.epoch === epoch)) return false;
      this.storage.sql.exec(
        'DELETE FROM relay_grant WHERE digest = ? AND epoch = ?',
        digest,
        epoch,
      );
      return true;
    });
  }

  retireEpoch(now: number, epoch: string): void {
    this.access(now, () => {
      this.storage.sql.exec('DELETE FROM relay_grant WHERE epoch = ?', epoch);
    });
  }

  rememberSession(now: number, session: Omit<Session, 'position'>): void {
    if (
      !digestPattern.test(session.digest) ||
      typeof session.deviceId !== 'string' ||
      session.deviceId.length < 1 ||
      session.deviceId.length > 128 ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= now ||
      session.expiresAt > now + sessionLifetime
    ) {
      throw new Error('invalid session');
    }
    this.access(now, (_grants, sessions) => {
      const existing = sessions.find((row) => row.digest === session.digest);
      if (existing) {
        if (existing.deviceId !== session.deviceId || existing.expiresAt !== session.expiresAt) {
          throw new Error('session mismatch');
        }
        return;
      }
      if (sessions.length === 50) {
        this.storage.sql.exec('DELETE FROM relay_session WHERE position = ?', sessions[0].position);
      }
      this.storage.sql.exec(
        'INSERT INTO relay_session (digest, deviceId, expiresAt) VALUES (?, ?, ?)',
        session.digest,
        session.deviceId,
        session.expiresAt,
      );
    });
  }

  findSession(now: number, digest: string): Omit<Session, 'position'> | null {
    return this.access(now, (_grants, sessions) => {
      const row = sessions.find((session) => session.digest === digest);
      return row ? { digest: row.digest, deviceId: row.deviceId, expiresAt: row.expiresAt } : null;
    });
  }

  forgetSession(now: number, digest: string): void {
    this.access(now, () => {
      this.storage.sql.exec('DELETE FROM relay_session WHERE digest = ?', digest);
    });
  }
}
