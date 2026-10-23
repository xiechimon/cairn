// machines 本地化（spec 11 A8/A9，#357）：本机行 = server 启动 seed +
// hostname 匹配的 enroll 同律；PATCH /api/machines/{id} 写 enabledRuntimes。
// 失败方式先于实现枚举（仓测试规则 3）：
// 1. 二次 seed 建 duplicate 行（幂等破）
// 2. 已 enroll 的 hostname 行 seed 时不补 kind='local'
// 3. daemon loopback enroll（name=hostname）落 remote / 与 seed 行重复
// 4. PATCH 走不通 / GET 回显不一致 / 未知 id 非 404 / 词表外 runtime 非 400
// 5. GET 记录缺 kind / enabledRuntimes 字段（schema 投影漏位）

import { hostname } from 'node:os';
import { machineRecordSchema } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bootServer, issueApiKey, req } from './helpers.js';

const HOST = hostname();

/** enroll 要 Bearer apiKey——req helper 无 header 位，machine-wire 同款 call。 */
function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

function localRows(db: ReturnType<typeof bootServer>['db'], teamId: string) {
  return db
    .select()
    .from(machineTable)
    .where(eq(machineTable.teamId, teamId))
    .all()
    .filter((r) => r.name === HOST);
}

describe('本机行 seed（spec 11 A8：server 启动 seed，idempotent）', () => {
  test('seed 建 kind=local 行（name=os.hostname()，enabledRuntimes 缺省 [pi]）', () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('local');
      // #682：开关是 claim 真闸后缺省 []（全关）= 新装机一步领不到——
      // seed/enroll 缺省改 ['pi']（bootstrap 不空转），claude-code opt-in。
      expect(rows[0]?.enabledRuntimes).toEqual(['pi']);
    } finally {
      s.dispose();
    }
  });

  test('二次 seed 不建 duplicate 行（验收：二次启动 server）', () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      seedLocalMachine(s.db, s.team.id);
      expect(localRows(s.db, s.team.id)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('本机行已改名（name 漂移离 hostname）：再 seed 按 kind 唯一性定位，不建 duplicate', () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const row = localRows(s.db, s.team.id)[0];
      expect(row).toBeDefined();
      // 改名漂移：daemon 显式 --name 重注册后行 name 离开 hostname
      // （feature map machines-local-row.md gotcha：不重复建行）。
      s.db
        .update(machineTable)
        .set({ name: 'renamed-box' })
        .where(eq(machineTable.id, row?.id ?? ''))
        .run();
      seedLocalMachine(s.db, s.team.id);
      const locals = s.db
        .select()
        .from(machineTable)
        .where(and(eq(machineTable.teamId, s.team.id), eq(machineTable.kind, 'local')))
        .all();
      expect(locals).toHaveLength(1);
      expect(locals[0]?.id).toBe(row?.id); // 复用同一行，不另建 placeholder
    } finally {
      s.dispose();
    }
  });

  test('已 enroll 的 hostname 行：seed 补 kind=local，不另建行', async () => {
    const s = bootServer();
    try {
      const key = await issueApiKey(s);
      const res = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(res.status).toBe(200);
      // enroll 同律：name=hostname 即落 kind='local'（无需等 seed）
      expect(localRows(s.db, s.team.id)[0]?.kind).toBe('local');
      seedLocalMachine(s.db, s.team.id);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('local');
      expect(rows[0]?.tokenHash).not.toBeNull(); // enroll 凭证保留
    } finally {
      s.dispose();
    }
  });
});

describe('enroll hostname 同律（spec 11 A9：loopback enroll 落 kind=local）', () => {
  test('enroll name=hostname → kind=local；seed 行被复用（无 duplicate）', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const key = await issueApiKey(s);
      const res = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: HOST, cliVersion: '0.1.0' },
      });
      expect(res.status).toBe(200);
      const rows = localRows(s.db, s.team.id);
      expect(rows).toHaveLength(1); // seed 行被 enroll 复用，不另建
      expect(rows[0]?.kind).toBe('local');
      expect(rows[0]?.tokenHash).not.toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('enroll 异名机器 → kind=remote（默认律不破）', async () => {
    const s = bootServer();
    try {
      const key = await issueApiKey(s);
      await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: 'lan-box', cliVersion: '0.1.0' },
      });
      const row = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.teamId, s.team.id))
        .all()
        .find((r) => r.name === 'lan-box');
      expect(row?.kind).toBe('remote');
      // #682：enroll 缺省 ['pi']（claim 真闸下的 bootstrap 不空转，同 seed）。
      expect(row?.enabledRuntimes).toEqual(['pi']);
    } finally {
      s.dispose();
    }
  });
});

describe('PATCH /api/machines/{id}（spec 11 A8/A9：enabledRuntimes 写回）', () => {
  test('PATCH 走通、GET 回显一致（验收）', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const id = localRows(s.db, s.team.id)[0]?.id;
      const res = await req(s.app, 'PATCH', `/api/machines/${id}`, {
        enabledRuntimes: ['pi', 'claude-code'],
      });
      expect(res.status).toBe(200);
      const patched = machineRecordSchema.parse(await res.json());
      expect(patched.enabledRuntimes).toEqual(['pi', 'claude-code']);
      expect(patched.kind).toBe('local');
      const list = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`)
      ).json()) as unknown[];
      const record = machineRecordSchema.parse(list.find((m) => (m as { id: string }).id === id));
      expect(record.enabledRuntimes).toEqual(['pi', 'claude-code']);
      // 覆写 = 全量替换语义（词表内二次 PATCH 收敛）
      const off = await req(s.app, 'PATCH', `/api/machines/${id}`, { enabledRuntimes: [] });
      expect(off.status).toBe(200);
      expect(localRows(s.db, s.team.id)[0]?.enabledRuntimes).toEqual([]);
    } finally {
      s.dispose();
    }
  });

  test('未知 id → 404 {error}', async () => {
    const s = bootServer();
    try {
      const res = await req(s.app, 'PATCH', '/api/machines/nope', {
        enabledRuntimes: ['pi'],
      });
      expect(res.status).toBe(404);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
    } finally {
      s.dispose();
    }
  });

  test('词表外 runtime / 形状错 body → 400', async () => {
    const s = bootServer();
    try {
      seedLocalMachine(s.db, s.team.id);
      const id = localRows(s.db, s.team.id)[0]?.id;
      const bad = await req(s.app, 'PATCH', `/api/machines/${id}`, {
        enabledRuntimes: ['pi', 'codex'],
      });
      expect(bad.status).toBe(400);
      const shape = await req(s.app, 'PATCH', `/api/machines/${id}`, {
        enabledRuntimes: 'pi',
      });
      expect(shape.status).toBe(400);
      // 拒写不动存量值（#682 起 seed 缺省 ['pi']，同字段拒绝位零改动）。
      expect(localRows(s.db, s.team.id)[0]?.enabledRuntimes).toEqual(['pi']);
    } finally {
      s.dispose();
    }
  });
});
