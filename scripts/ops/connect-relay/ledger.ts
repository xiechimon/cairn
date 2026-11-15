export const relayDailyLimits = {
  dynamic: 2_000,
  pairs: 400,
  upgrades: 64,
  inbound: 10_000,
  output: 32 * 1024 * 1024,
} as const;

type Usage = Record<keyof typeof relayDailyLimits, number>;
type Marker = { installation: string; version: number; day: number; lastAt: number };
type Daily = Usage & { day: number };

export class RelayBudgetExceeded extends Error {
  constructor(readonly resetAt: number) {
    super('budget');
  }
}

const dayMs = 86_400_000;
const keys = Object.keys(relayDailyLimits) as (keyof Usage)[];

export class RelayLedger {
  constructor(
    private storage: Pick<DurableObjectStorage, 'sql' | 'transactionSync'>,
    private installation: string,
  ) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(installation)) {
      throw new Error('invalid installation');
    }
  }

  reserve(now: number, cost: Partial<Usage>): { resetAt: number; usage: Usage } {
    if (!Number.isSafeInteger(now) || now <= 0 || now > 8_640_000_000_000_000) {
      throw new Error('invalid clock');
    }
    if (
      Object.keys(cost).some((key) => !keys.includes(key as keyof Usage)) ||
      keys.some((key) => {
        const amount = cost[key] ?? 0;
        return !Number.isSafeInteger(amount) || amount < 0;
      })
    ) {
      throw new Error('invalid reservation');
    }
    const day = Math.floor(now / dayMs);
    const resetAt = (day + 1) * dayMs;
    const result = this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      const tables = sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .filter((table) => !table.name.startsWith('sqlite_'));
      if (tables.length === 0) {
        sql.exec(
          'CREATE TABLE relay_installation (id INTEGER PRIMARY KEY CHECK (id = 1), installation TEXT NOT NULL, version INTEGER NOT NULL, day INTEGER NOT NULL, lastAt INTEGER NOT NULL)',
        );
        sql.exec(
          'CREATE TABLE relay_daily (day INTEGER PRIMARY KEY, dynamic INTEGER NOT NULL, pairs INTEGER NOT NULL, upgrades INTEGER NOT NULL, inbound INTEGER NOT NULL, output INTEGER NOT NULL)',
        );
        sql.exec(
          'CREATE TABLE relay_grant (digest TEXT PRIMARY KEY, epoch TEXT NOT NULL, expiresAt INTEGER NOT NULL)',
        );
        sql.exec(
          'CREATE TABLE relay_session (position INTEGER PRIMARY KEY AUTOINCREMENT, digest TEXT NOT NULL UNIQUE, deviceId TEXT NOT NULL, expiresAt INTEGER NOT NULL)',
        );
        sql.exec(
          'INSERT INTO relay_installation VALUES (1, ?, 1, ?, ?)',
          this.installation,
          day,
          now,
        );
        sql.exec('INSERT INTO relay_daily VALUES (?, 0, 0, 0, 0, 0)', day);
      }
      if (
        tables.length > 0 &&
        ['relay_installation', 'relay_daily', 'relay_grant', 'relay_session'].some(
          (name) => !tables.some((table) => table.name === name),
        )
      ) {
        throw new Error('ledger unavailable');
      }
      const markers = sql
        .exec<Marker>('SELECT installation, version, day, lastAt FROM relay_installation LIMIT 2')
        .toArray();
      const rows = sql.exec<Daily>('SELECT * FROM relay_daily ORDER BY day DESC LIMIT 3').toArray();
      const marker = markers[0];
      if (
        markers.length !== 1 ||
        !marker ||
        marker.installation !== this.installation ||
        marker.version !== 1 ||
        !Number.isSafeInteger(marker.lastAt) ||
        marker.lastAt <= 0 ||
        marker.day !== Math.floor(marker.lastAt / dayMs) ||
        now < marker.lastAt ||
        rows.length < 1 ||
        rows.length > 2 ||
        rows[0].day !== marker.day ||
        rows.some(
          (row) =>
            !Number.isSafeInteger(row.day) ||
            row.day < marker.day - 1 ||
            keys.some(
              (key) =>
                !Number.isSafeInteger(row[key]) || row[key] < 0 || row[key] > relayDailyLimits[key],
            ),
        )
      ) {
        throw new Error('ledger unavailable');
      }
      if (day > marker.day) {
        sql.exec('INSERT INTO relay_daily VALUES (?, 0, 0, 0, 0, 0)', day);
        sql.exec('DELETE FROM relay_daily WHERE day < ?', day - 1);
      }
      sql.exec('UPDATE relay_installation SET day = ?, lastAt = ? WHERE id = 1', day, now);
      const usage = sql.exec<Daily>('SELECT * FROM relay_daily WHERE day = ?', day).one();
      if (keys.some((key) => (cost[key] ?? 0) > relayDailyLimits[key] - usage[key])) {
        return null;
      }
      const next = Object.fromEntries(
        keys.map((key) => [key, usage[key] + (cost[key] ?? 0)]),
      ) as Usage;
      sql.exec(
        'UPDATE relay_daily SET dynamic = ?, pairs = ?, upgrades = ?, inbound = ?, output = ? WHERE day = ?',
        next.dynamic,
        next.pairs,
        next.upgrades,
        next.inbound,
        next.output,
        day,
      );
      return next;
    });
    if (!result) throw new RelayBudgetExceeded(resetAt);
    return { resetAt, usage: result };
  }
}
