#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { constants as osConstants } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { scrubDiagnostics } from '../../eval/harness/devin-env.mjs';
import { processInfo, spawnOwned } from '../owned-process.mjs';
import { PUBLIC_RESULTS_BRANCH, publishPublicResults } from './eval-public-results.mjs';

const DEFAULT_LOCK_MAX_AGE_MS = 4 * 3600 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = 7_200_000;
const RECLAIM_STALE_MS = 60_000;
const INIT_GRACE_MS = 5_000;
const HISTORY_CAP = 60;
const LANGFUSE_EXIT_CODE = 3;

export function parseEnvFile(text) {
  const result = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf('=');
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function writeAtomic(filePath, content, mode = 0o600) {
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tempPath, content, { mode });
  chmodSync(tempPath, mode);
  renameSync(tempPath, filePath);
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileAgeMs(filePath, nowMs) {
  try {
    return nowMs - statSync(filePath).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function safeUnlink(filePath) {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function writeWxFile(filePath, payload) {
  const fd = openSync(filePath, 'wx', 0o600);
  try {
    writeSync(fd, `${JSON.stringify(payload)}\n`);
  } finally {
    closeSync(fd);
  }
}

function createLockRecord(runId, pid = process.pid, getInfo = processInfo, nowMs = Date.now()) {
  const info = getInfo(pid);
  return {
    pid,
    start: info?.start ?? null,
    startedAt: new Date(nowMs).toISOString(),
    runId,
  };
}

function isLiveProcess(record, getInfo) {
  if (!record || typeof record.pid !== 'number') return false;
  const info = getInfo(record.pid);
  if (!info) return false;
  if (record.start && info.start !== record.start) return false;
  return true;
}

async function waitForProcessExit(pid, start, getInfo, timeoutMs, signalFn) {
  if (!start) return false;
  const currentInfo = getInfo(pid);
  if (!currentInfo || currentInfo.start !== start) return true;
  try {
    signalFn(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code === 'ESRCH') return true;
    if (error?.code === 'EPERM') return false;
    throw error;
  }
  const termDeadline = Date.now() + timeoutMs;
  while (Date.now() < termDeadline) {
    const info = getInfo(pid);
    if (!info || info.start !== start) return true;
    await sleep(100);
  }
  const preKillInfo = getInfo(pid);
  if (!preKillInfo || preKillInfo.start !== start) return true;
  try {
    signalFn(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code === 'ESRCH') return true;
    if (error?.code === 'EPERM') return false;
    throw error;
  }
  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline) {
    const info = getInfo(pid);
    if (!info || (start && info.start !== start)) return true;
    await sleep(100);
  }
  const finalInfo = getInfo(pid);
  return !finalInfo || (Boolean(start) && finalInfo.start !== start);
}

function acquireReclaimMutex(reclaimPath, runId, getInfo, nowMs) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeWxFile(reclaimPath, {
        pid: process.pid,
        start: getInfo(process.pid)?.start ?? null,
        createdAt: new Date(nowMs).toISOString(),
        runId,
      });
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readJsonOrNull(reclaimPath);
      const age = fileAgeMs(reclaimPath, nowMs);
      if (existing === null) {
        if (age < INIT_GRACE_MS) return false;
        safeUnlink(reclaimPath);
        continue;
      }
      const createdAtMs = Date.parse(existing.createdAt ?? '');
      const expired = Number.isFinite(createdAtMs)
        ? nowMs - createdAtMs > RECLAIM_STALE_MS
        : age > RECLAIM_STALE_MS;
      if (!isLiveProcess(existing, getInfo) || expired) {
        safeUnlink(reclaimPath);
        continue;
      }
      return false;
    }
  }
  return false;
}

export async function acquireLock(
  stateDir,
  runId,
  {
    maxAgeMs = DEFAULT_LOCK_MAX_AGE_MS,
    reclaimWaitMs = 10_000,
    getInfo = processInfo,
    signalFn = (pid, sig) => process.kill(pid, sig),
    now = () => Date.now(),
  } = {},
) {
  const lockPath = join(stateDir, 'lock');
  const reclaimPath = join(stateDir, 'lock.reclaim');
  const nowMs = now();
  try {
    writeWxFile(lockPath, createLockRecord(runId, process.pid, getInfo, nowMs));
    return { acquired: true, lockPath };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const initial = readJsonOrNull(lockPath);
  const age = fileAgeMs(lockPath, nowMs);
  if (initial === null && age < INIT_GRACE_MS) {
    return { acquired: false, code: 0, reason: 'lock_initializing', holder: null };
  }
  if (initial !== null && isLiveProcess(initial, getInfo)) {
    const startedMs = Date.parse(initial.startedAt ?? '');
    const lockAge = Number.isFinite(startedMs) ? nowMs - startedMs : age;
    if (lockAge <= maxAgeMs) {
      return { acquired: false, code: 0, reason: 'skipped_locked', holder: initial };
    }
  }

  if (!acquireReclaimMutex(reclaimPath, runId, getInfo, nowMs)) {
    return { acquired: false, code: 0, reason: 'reclaim_contended', holder: initial };
  }
  try {
    const current = readJsonOrNull(lockPath);
    const curAge = fileAgeMs(lockPath, now());
    if (current === null && curAge < INIT_GRACE_MS) {
      return { acquired: false, code: 0, reason: 'lock_initializing', holder: null };
    }
    if (current !== null && isLiveProcess(current, getInfo)) {
      const startedMs = Date.parse(current.startedAt ?? '');
      const lockAge = Number.isFinite(startedMs) ? now() - startedMs : curAge;
      if (lockAge <= maxAgeMs) {
        return { acquired: false, code: 0, reason: 'skipped_locked', holder: current };
      }
      const exited = await waitForProcessExit(
        current.pid,
        current.start,
        getInfo,
        reclaimWaitMs,
        signalFn,
      );
      if (!exited) {
        return {
          acquired: false,
          code: 1,
          reason: 'reclaim_failed_still_alive',
          holder: current,
        };
      }
    }
    if (existsSync(lockPath)) {
      const latestLock = readJsonOrNull(lockPath);
      if (current !== null) {
        if (!latestLock || latestLock.runId !== current.runId) {
          return {
            acquired: false,
            code: 0,
            reason: latestLock ? 'skipped_locked' : 'lock_initializing',
            holder: latestLock,
          };
        }
      } else if (latestLock !== null || fileAgeMs(lockPath, now()) < INIT_GRACE_MS) {
        return {
          acquired: false,
          code: 0,
          reason: latestLock ? 'skipped_locked' : 'lock_initializing',
          holder: latestLock,
        };
      }
      safeUnlink(lockPath);
    }
    try {
      writeWxFile(lockPath, createLockRecord(runId, process.pid, getInfo, now()));
      return { acquired: true, lockPath, reclaimedFrom: current?.runId ?? 'corrupt' };
    } catch (error) {
      if (error?.code === 'EEXIST') {
        return {
          acquired: false,
          code: 0,
          reason: 'skipped_locked',
          holder: readJsonOrNull(lockPath),
        };
      }
      throw error;
    }
  } finally {
    safeUnlink(reclaimPath);
  }
}

export function ownsLock(stateDir, runId) {
  const current = readJsonOrNull(join(stateDir, 'lock'));
  return current?.runId === runId;
}

export function releaseLock(stateDir, runId) {
  const lockPath = join(stateDir, 'lock');
  if (ownsLock(stateDir, runId)) safeUnlink(lockPath);
}

export function isItemPassed(item) {
  if (item?.incomplete !== undefined) return false;
  const values = Object.values(item?.scores ?? {});
  return values.length > 0 && values.every((v) => v === 1);
}

export function summarizeRun({
  runId,
  arm,
  sha = 'unknown',
  startedAt,
  finishedAt = new Date().toISOString(),
  durationMs = 0,
  evalExitCode = null,
  outJson = null,
  failureReason = '',
  forceStatus,
}) {
  const items = Array.isArray(outJson?.items) ? outJson.items : [];
  const total = items.length;
  const incomplete = items.filter((item) => item.incomplete !== undefined).length;
  const passed = items.filter((item) => isItemPassed(item)).length;
  const failed = total - incomplete - passed;
  const byKind = {};
  for (const item of items) {
    const kind = String(item.kind ?? 'unknown');
    byKind[kind] ??= { total: 0, passed: 0, failed: 0, incomplete: 0 };
    const bucket = byKind[kind];
    bucket.total += 1;
    if (item.incomplete !== undefined) bucket.incomplete += 1;
    else if (isItemPassed(item)) bucket.passed += 1;
    else bucket.failed += 1;
  }

  let status;
  let exitCode;
  if (forceStatus === 'incomplete') {
    status = 'incomplete';
    exitCode = 1;
  } else if (forceStatus === 'failed') {
    status = 'failed';
    exitCode = 1;
  } else if (evalExitCode === LANGFUSE_EXIT_CODE) {
    status = 'incomplete';
    exitCode = 1;
  } else if (outJson === null || !Array.isArray(outJson.items)) {
    status = 'failed';
    exitCode = 1;
  } else if (evalExitCode !== 0 || incomplete > 0 || total === 0) {
    status = 'incomplete';
    exitCode = 1;
  } else if (passed === total && total > 0) {
    status = 'ok';
    exitCode = 0;
  } else if (passed > 0 && failed > 0) {
    status = 'degraded';
    exitCode = 0;
  } else {
    status = 'failed';
    exitCode = 1;
  }

  return {
    runId,
    arm,
    sha,
    startedAt,
    finishedAt,
    durationMs,
    status,
    exitCode,
    evalExitCode,
    ...(failureReason ? { reason: failureReason } : {}),
    ...(outJson?.langfuse ? { langfuse: outJson.langfuse } : {}),
    summary: { total, passed, failed, incomplete, byKind },
    items,
  };
}

function summarizeCases(items) {
  const byCase = new Map();
  for (const item of items ?? []) {
    const bucket = byCase.get(item.caseId) ?? {
      caseId: item.caseId,
      kind: item.kind,
      trials: 0,
      passed: 0,
      incomplete: 0,
      durationMs: 0,
      notes: [],
      traceId: undefined,
      traceUrl: undefined,
    };
    bucket.trials += 1;
    if (item.incomplete !== undefined) {
      bucket.incomplete += 1;
      bucket.notes.push(`incomplete: ${item.incomplete}`);
    } else if (isItemPassed(item)) {
      bucket.passed += 1;
    } else {
      const bad = Object.entries(item.scores ?? {})
        .filter(([, v]) => v !== 1)
        .map(([k, v]) => `${k}=${v}${item.comments?.[k] ? ` (${item.comments[k]})` : ''}`);
      if (bad.length > 0) bucket.notes.push(bad.join('; '));
    }
    if (item.diagnostics) bucket.notes.push(item.diagnostics);
    if (typeof item.durationMs === 'number') bucket.durationMs += item.durationMs;
    if (!bucket.traceId && item.traceId) bucket.traceId = item.traceId;
    if (!bucket.traceUrl && item.traceUrl) bucket.traceUrl = item.traceUrl;
    byCase.set(item.caseId, bucket);
  }
  return byCase;
}

function safeHttpUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function renderSummaryHtml(history) {
  const runs = Array.isArray(history) ? history : [];
  const latest = runs[0];
  const prevWithItems = runs.slice(1).find((r) => Array.isArray(r.items) && r.items.length > 0);
  const prevCases = prevWithItems ? summarizeCases(prevWithItems.items) : null;
  const latestCases = latest ? [...summarizeCases(latest.items).values()] : [];
  latestCases.sort((a, b) => a.kind.localeCompare(b.kind) || a.caseId.localeCompare(b.caseId));

  let streak = 0;
  for (const r of runs) {
    if (r.summary?.byKind?.lane?.passed > 0 && r.status !== 'incomplete') streak += 1;
    else break;
  }

  const fmtKind = (byKind, kind) => {
    const k = byKind?.[kind];
    return k ? `${k.passed}/${k.total}` : '—';
  };

  const historyRows = runs
    .map((r) => {
      const safeExp = safeHttpUrl(r.langfuse?.experimentUrl);
      const expLink = safeExp
        ? `<a href="${escapeHtml(safeExp)}" target="_blank" rel="noreferrer">experiment</a>`
        : r.langfuse?.experimentUrl
          ? `<code>${escapeHtml(String(r.langfuse.experimentUrl))}</code>`
          : '—';
      const durSec = ((r.durationMs ?? 0) / 1000).toFixed(1);
      const publicResults = r.publicResults?.state
        ? `${r.publicResults.state}${r.publicResults.commit ? ` @${String(r.publicResults.commit).slice(0, 8)}` : ''}${r.publicResults.reason ? `: ${r.publicResults.reason}` : ''}`
        : '—';
      return `<tr>
        <td><code>${escapeHtml(r.startedAt)}</code></td>
        <td><code>${escapeHtml(String(r.sha ?? '').slice(0, 8))}</code></td>
        <td><span class="badge badge-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(fmtKind(r.summary?.byKind, 'lane'))}</td>
        <td>${escapeHtml(fmtKind(r.summary?.byKind, 'runtime'))}</td>
        <td>${escapeHtml(fmtKind(r.summary?.byKind, 'canary'))}</td>
        <td>${escapeHtml(durSec)}s</td>
        <td>${expLink}</td>
        <td>${escapeHtml(publicResults)}</td>
        <td>${escapeHtml(r.reason ?? '')}</td>
      </tr>`;
    })
    .join('\n');

  const caseRows = latestCases
    .map((c) => {
      const prev = prevCases?.get(c.caseId);
      const deltaText = !prevWithItems
        ? '— (first run)'
        : !prev
          ? 'new'
          : c.passed === prev.passed && c.trials === prev.trials
            ? '='
            : `${prev.passed}/${prev.trials} -> ${c.passed}/${c.trials}`;
      const safeTrace = safeHttpUrl(c.traceUrl);
      const traceCell = safeTrace
        ? `<a href="${escapeHtml(safeTrace)}" target="_blank" rel="noreferrer">${escapeHtml(c.traceId ?? 'trace')}</a>`
        : c.traceId
          ? `<code>trace: ${escapeHtml(c.traceId)}</code>`
          : c.traceUrl
            ? `<code>${escapeHtml(String(c.traceUrl))}</code>`
            : '—';
      const noteText = [...new Set(c.notes)].join(' | ');
      const stateClass = c.incomplete > 0 ? 'incomplete' : c.passed === c.trials ? 'ok' : 'failed';
      return `<tr>
        <td><code>${escapeHtml(c.caseId)}</code></td>
        <td>${escapeHtml(c.kind)}</td>
        <td><span class="badge badge-${stateClass}">${c.passed}/${c.trials}</span></td>
        <td>${escapeHtml(deltaText)}</td>
        <td>${escapeHtml(`${(c.durationMs / 1000).toFixed(1)}s`)}</td>
        <td>${traceCell}</td>
        <td class="notes">${escapeHtml(noteText)}</td>
      </tr>`;
    })
    .join('\n');

  const safeBanner = safeHttpUrl(latest?.langfuse?.experimentUrl);
  const expBanner = safeBanner
    ? ` · <a href="${escapeHtml(safeBanner)}" target="_blank" rel="noreferrer">Langfuse Experiment</a>`
    : latest?.langfuse?.experimentUrl
      ? ` · <code>${escapeHtml(String(latest.langfuse.experimentUrl))}</code>`
      : '';
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Cairn 每日评测汇总</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; background: #161715; color: #eceae4; margin: 24px auto; max-width: 1180px; padding: 0 16px; }
  h1, h2 { font-weight: 600; margin: 20px 0 10px; }
  a { color: #e8c47a; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .meta { color: #b2afa6; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
  th, td { border-bottom: 1px solid #2b2d29; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { color: #a9a69d; font-weight: 500; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge-ok { background: #1e3b28; color: #8ce0a8; }
  .badge-degraded { background: #423315; color: #f2cb72; }
  .badge-incomplete { background: #3b2d1b; color: #f0b065; }
  .badge-failed { background: #442020; color: #f28b82; }
  .notes { max-width: 420px; word-break: break-word; color: #cbc7be; }
</style>
<h1>Cairn 每日真实任务评测汇总</h1>
<p class="meta">
  最新运行：<code>${escapeHtml(latest?.runId ?? 'none')}</code> ·
  SHA <code>${escapeHtml(String(latest?.sha ?? '').slice(0, 8))}</code> ·
  状态 <span class="badge badge-${escapeHtml(latest?.status ?? 'failed')}">${escapeHtml(latest?.status ?? 'none')}</span> ·
  连续非零 Lane 达标天数：<strong>${streak}</strong>${expBanner}
</p>
<h2>最近运行记录（最多保留 60 次）</h2>
<table>
  <thead><tr><th>开始时间</th><th>SHA</th><th>状态</th><th>Lane</th><th>Runtime</th><th>Canary</th><th>耗时</th><th>Langfuse</th><th>公开结果</th><th>说明</th></tr></thead>
  <tbody>${historyRows}</tbody>
</table>
<h2>最新一轮逐题明细</h2>
<table>
  <thead><tr><th>用例</th><th>类型</th><th>通过</th><th>对比上一轮</th><th>耗时</th><th>Trace</th><th>原因 / 诊断</th></tr></thead>
  <tbody>${caseRows}</tbody>
</table>
</html>
`;
}

export function updateHistory(
  stateDir,
  runRecord,
  { cap = HISTORY_CAP, nowMs = Date.now(), prune = true } = {},
) {
  const runsDir = join(stateDir, 'runs');
  const tmpDir = join(stateDir, 'tmp');
  const historyPath = join(stateDir, 'history.json');
  mkdirSync(runsDir, { recursive: true });

  let existing = [];
  if (existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed;
      else throw new Error('history.json is not an array');
    } catch {
      const backup = join(stateDir, `history.corrupt.${nowMs}.json`);
      renameSync(historyPath, backup);
      existing = [];
    }
  }

  const nextHistory = [runRecord, ...existing.filter((r) => r?.runId !== runRecord.runId)].slice(
    0,
    cap,
  );
  const compactHistory = nextHistory.map(({ items: _items, ...meta }) => ({
    ...meta,
    items: (runRecord.runId === meta.runId ? runRecord.items : _items) ?? [],
  }));

  writeAtomic(
    join(runsDir, `${runRecord.runId}.json`),
    `${JSON.stringify(runRecord, null, 2)}\n`,
    0o600,
  );
  writeAtomic(join(stateDir, 'latest.json'), `${JSON.stringify(runRecord, null, 2)}\n`, 0o600);
  writeAtomic(historyPath, `${JSON.stringify(compactHistory, null, 2)}\n`, 0o600);
  writeAtomic(join(stateDir, 'index.html'), renderSummaryHtml(compactHistory), 0o644);

  if (prune) {
    const retained = new Set(compactHistory.map((r) => `${r.runId}.json`));
    for (const name of readdirSync(runsDir)) {
      if (name.endsWith('.json') && !retained.has(name)) safeUnlink(join(runsDir, name));
    }
    if (existsSync(tmpDir)) {
      for (const name of readdirSync(tmpDir)) {
        const p = join(tmpDir, name);
        let entryStat = null;
        try {
          entryStat = lstatSync(p);
        } catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
        if (nowMs - entryStat.mtimeMs <= 24 * 3600 * 1000) continue;
        if (entryStat.isDirectory()) {
          if (/-public(?:-[A-Za-z0-9_-]+)?$/.test(name)) {
            rmSync(p, { recursive: true, force: true });
          }
          continue;
        }
        safeUnlink(p);
      }
    }
  }
  return compactHistory;
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function runOwnedCommand(
  cmd,
  args,
  { cwd, env, timeoutMs, name = 'eval-daily-cmd', useOwned = false, onProcessStart } = {},
) {
  let child;
  let exited;
  let stopFn;
  if (useOwned) {
    const owned = spawnOwned(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      name,
      maxRuntimeSec: Math.ceil(timeoutMs / 1000) + 60,
      graceMs: 1_500,
    });
    child = owned.child;
    exited = owned.exited;
    stopFn = () => owned.stop();
  } else {
    child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = new Promise((resolveExit) => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }));
      child.once('error', (error) => resolveExit({ code: null, signal: null, error }));
    });
    stopFn = async () => {
      try {
        child.kill('SIGTERM');
      } catch {}
      const settled = await Promise.race([exited.then(() => true), sleep(1_500).then(() => false)]);
      if (!settled) {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
      return exited;
    };
  }
  let stdout = '';
  let stderr = '';
  const append = (cur, chunk) => (cur + chunk.toString('utf8')).slice(-65_536);
  const drainStream = (stream, onChunk) =>
    stream
      ? new Promise((resolveStream) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolveStream();
          };
          stream.on('data', onChunk);
          stream.once('end', finish);
          stream.once('close', finish);
          stream.once('error', finish);
        })
      : Promise.resolve();
  const stdoutDone = drainStream(child.stdout, (chunk) => {
    stdout = append(stdout, chunk);
  });
  const stderrDone = drainStream(child.stderr, (chunk) => {
    stderr = append(stderr, chunk);
  });
  let timedOut = false;
  let signalStop = null;
  const timer = setTimeout(() => {
    timedOut = true;
    stopFn();
  }, timeoutMs);
  onProcessStart?.({
    stopForSignal: (sig) => {
      signalStop = sig;
      return stopFn();
    },
  });
  const result = await exited;
  clearTimeout(timer);
  onProcessStart?.(null);
  await Promise.race([Promise.all([stdoutDone, stderrDone]), sleep(500)]);
  const sigName = signalStop ?? result.signal ?? null;
  const exitCode = result.error
    ? 127
    : timedOut
      ? 124
      : sigName
        ? 128 + (osConstants.signals[sigName] ?? 15)
        : (result.code ?? 1);
  return {
    exitCode,
    error: result.error ?? null,
    signal: result.signal ?? null,
    timedOut,
    signalStop,
    stdout,
    stderr,
  };
}

export async function runDailyEval({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  getInfo = processInfo,
  publishImpl = publishPublicResults,
} = {}) {
  if (env.CI && !['false', '0'].includes(env.CI)) {
    console.error('eval-daily: refusing to run inside CI');
    return 2;
  }
  const stateDir = env.EVAL_DAILY_STATE?.trim();
  if (!stateDir) {
    console.error('eval-daily: EVAL_DAILY_STATE is required');
    return 2;
  }
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const probe = join(stateDir, `.writable-${process.pid}`);
    writeFileSync(probe, 'ok', { mode: 0o600 });
    safeUnlink(probe);
  } catch (error) {
    console.error(
      `eval-daily: EVAL_DAILY_STATE is not writable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const runId = `daily-${stamp}-${randomUUID().slice(0, 6)}`;
  const arm = `daily-${stamp}`;
  const lockMaxAgeMs = Number(env.EVAL_DAILY_LOCK_MAX_AGE_MS || DEFAULT_LOCK_MAX_AGE_MS);
  const runTimeoutMs = Number(env.EVAL_DAILY_RUN_TIMEOUT_MS || DEFAULT_RUN_TIMEOUT_MS);

  const lockResult = await acquireLock(stateDir, runId, { maxAgeMs: lockMaxAgeMs, getInfo });
  if (!lockResult.acquired) {
    writeAtomic(
      join(stateDir, 'last-skip.json'),
      `${JSON.stringify({ at: startedAt, reason: lockResult.reason, holder: lockResult.holder }, null, 2)}\n`,
      0o600,
    );
    return lockResult.code;
  }

  let currentSignal = null;
  let activeStop = null;
  const onSignal = (sig) => {
    currentSignal ??= sig;
    activeStop?.stopForSignal(sig);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  const repoDir = env.EVAL_DAILY_REPO?.trim() ?? '';
  const devinHome = env.EVAL_DAILY_DEVIN_HOME?.trim() ?? '';
  const extraPaths = [env.HOME, devinHome, repoDir].filter(Boolean);
  let sha = 'unknown';

  const persistAndReturn = (summaryInput) => {
    if (currentSignal && !ownsLock(stateDir, runId)) return 1;
    const record = summarizeRun({
      runId,
      arm,
      sha,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      ...summaryInput,
    });
    updateHistory(stateDir, record);
    if (Array.isArray(record.items) && record.items.length > 0 && record.evalExitCode === 0) {
      try {
        record.publicResults = publishImpl(record, { repoDir, stateDir, env });
      } catch (error) {
        record.publicResults = {
          state: 'failed',
          branch: PUBLIC_RESULTS_BRANCH,
          reason: scrubDiagnostics(
            error instanceof Error ? error.message : String(error),
            extraPaths,
          ),
        };
      }
    } else {
      record.publicResults = {
        state: 'skipped',
        branch: PUBLIC_RESULTS_BRANCH,
        reason: 'no complete official eval result',
      };
    }
    updateHistory(stateDir, record, { prune: false });
    releaseLock(stateDir, runId);
    return record.exitCode;
  };

  const runStep = async (cmd, args, opts) => {
    if (currentSignal) return { interrupted: true, exitCode: 143, stdout: '', stderr: '' };
    const res = await runOwnedCommand(cmd, args, {
      ...opts,
      onProcessStart: (handle) => {
        activeStop = handle;
        if (handle && currentSignal) handle.stopForSignal(currentSignal);
      },
    });
    activeStop = null;
    if (currentSignal || res.signalStop) return { ...res, interrupted: true };
    return { ...res, interrupted: false };
  };

  try {
    if (!repoDir || !existsSync(join(repoDir, 'eval', 'run.ts'))) {
      return persistAndReturn({
        forceStatus: 'failed',
        failureReason: 'EVAL_DAILY_REPO is missing or lacks eval/run.ts',
      });
    }
    if (!devinHome || !existsSync(devinHome)) {
      return persistAndReturn({
        forceStatus: 'failed',
        failureReason: 'EVAL_DAILY_DEVIN_HOME is missing',
      });
    }

    const noFetch = argv.includes('--no-fetch') || env.EVAL_DAILY_NO_FETCH === '1';
    const skipInstall = argv.includes('--skip-install') || env.EVAL_DAILY_SKIP_INSTALL === '1';

    if (!noFetch) {
      const dirty = await runStep('git', ['status', '--porcelain'], {
        cwd: repoDir,
        env,
        timeoutMs: 15_000,
        name: 'eval-daily-git-status',
      });
      if (dirty.interrupted) {
        return persistAndReturn({
          forceStatus: 'incomplete',
          failureReason: `interrupted by signal ${currentSignal ?? dirty.signalStop}`,
        });
      }
      if (dirty.exitCode !== 0 || dirty.stdout.trim() !== '') {
        return persistAndReturn({
          forceStatus: 'failed',
          failureReason: scrubDiagnostics(
            `repo is dirty or unreadable: ${dirty.stderr || dirty.stdout}`,
            extraPaths,
          ),
        });
      }
      const fetched = await runStep('git', ['fetch', '-q', 'origin', 'main'], {
        cwd: repoDir,
        env,
        timeoutMs: 60_000,
        name: 'eval-daily-git-fetch',
      });
      if (fetched.interrupted) {
        return persistAndReturn({
          forceStatus: 'incomplete',
          failureReason: `interrupted by signal ${currentSignal ?? fetched.signalStop}`,
        });
      }
      if (fetched.exitCode !== 0 || fetched.error) {
        return persistAndReturn({
          forceStatus: 'failed',
          failureReason: scrubDiagnostics(
            `git fetch failed: ${fetched.error?.message || (fetched.timedOut ? 'timed out' : '') || fetched.stderr}`,
            extraPaths,
          ),
        });
      }
      const checkedOut = await runStep('git', ['checkout', '--detach', 'origin/main'], {
        cwd: repoDir,
        env,
        timeoutMs: 30_000,
        name: 'eval-daily-git-checkout',
      });
      if (checkedOut.interrupted) {
        return persistAndReturn({
          forceStatus: 'incomplete',
          failureReason: `interrupted by signal ${currentSignal ?? checkedOut.signalStop}`,
        });
      }
      if (checkedOut.exitCode !== 0 || checkedOut.error) {
        return persistAndReturn({
          forceStatus: 'failed',
          failureReason: scrubDiagnostics(
            `git checkout failed: ${checkedOut.error?.message || (checkedOut.timedOut ? 'timed out' : '') || checkedOut.stderr}`,
            extraPaths,
          ),
        });
      }
    }

    const headRes = await runStep('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      env,
      timeoutMs: 10_000,
      name: 'eval-daily-git-head',
    });
    if (headRes.interrupted) {
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: `interrupted by signal ${currentSignal ?? headRes.signalStop}`,
      });
    }
    if (headRes.exitCode === 0 && headRes.stdout.trim()) sha = headRes.stdout.trim();

    const lockfilePath = join(repoDir, 'pnpm-lock.yaml');
    const lockHashPath = join(stateDir, 'lockfile.sha256');
    if (!skipInstall && existsSync(lockfilePath)) {
      const currentLockHash = sha256File(lockfilePath);
      const prevLockHash = existsSync(lockHashPath)
        ? readFileSync(lockHashPath, 'utf8').trim()
        : '';
      if (currentLockHash !== prevLockHash || !existsSync(join(repoDir, 'node_modules'))) {
        const installed = await runStep(
          'pnpm',
          ['install', '--frozen-lockfile', '--ignore-scripts'],
          {
            cwd: repoDir,
            env,
            timeoutMs: 300_000,
            name: 'eval-daily-pnpm-install',
            useOwned: true,
          },
        );
        if (installed.interrupted) {
          return persistAndReturn({
            forceStatus: 'incomplete',
            failureReason: `interrupted by signal ${currentSignal ?? installed.signalStop}`,
          });
        }
        if (installed.exitCode !== 0 || installed.error) {
          return persistAndReturn({
            forceStatus: 'failed',
            failureReason: scrubDiagnostics(
              `pnpm install failed: ${installed.error?.message || (installed.timedOut ? 'timed out' : '') || installed.stderr}`,
              extraPaths,
            ),
          });
        }
        writeAtomic(lockHashPath, `${currentLockHash}\n`, 0o600);
      }
    }

    const langfuseEnvPath =
      env.EVAL_DAILY_LANGFUSE_ENV?.trim() || join(env.HOME ?? '', 'langfuse', 'eval.env');
    let mergedEnv = { ...env };
    if (langfuseEnvPath && existsSync(langfuseEnvPath)) {
      mergedEnv = { ...parseEnvFile(readFileSync(langfuseEnvPath, 'utf8')), ...mergedEnv };
    } else if (!env.LANGFUSE_BASE_URL || !env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: 'EVAL_DAILY_LANGFUSE_ENV missing and LANGFUSE_* keys not set',
      });
    }
    if (
      !mergedEnv.LANGFUSE_BASE_URL?.trim() ||
      !mergedEnv.LANGFUSE_PUBLIC_KEY?.trim() ||
      !mergedEnv.LANGFUSE_SECRET_KEY?.trim()
    ) {
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason:
          'LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY are required',
      });
    }

    const healthAc = new AbortController();
    activeStop = { stopForSignal: () => healthAc.abort() };
    try {
      if (currentSignal) {
        return persistAndReturn({
          forceStatus: 'incomplete',
          failureReason: `interrupted by signal ${currentSignal}`,
        });
      }
      const healthUrl = `${mergedEnv.LANGFUSE_BASE_URL.replace(/\/$/, '')}/api/public/health`;
      const healthRes = await fetchImpl(healthUrl, {
        signal: AbortSignal.any([AbortSignal.timeout(5_000), healthAc.signal]),
      });
      if (!healthRes.ok) {
        return persistAndReturn({
          forceStatus: 'incomplete',
          failureReason: `Langfuse health check returned HTTP ${healthRes.status}`,
        });
      }
    } catch (error) {
      if (currentSignal) {
        return persistAndReturn({
          forceStatus: 'incomplete',
          failureReason: `interrupted by signal ${currentSignal}`,
        });
      }
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: scrubDiagnostics(
          `Langfuse health check failed: ${error instanceof Error ? error.message : String(error)}`,
          extraPaths,
        ),
      });
    } finally {
      activeStop = null;
    }

    const syncedDevinEnv = join(repoDir, 'eval', 'harness', 'devin-env.mjs');
    const authRes = await runStep(process.execPath, [syncedDevinEnv, '--check-auth'], {
      cwd: repoDir,
      env: mergedEnv,
      timeoutMs: 15_000,
      name: 'eval-daily-auth-preflight',
    });
    if (authRes.interrupted) {
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: `interrupted by signal ${currentSignal ?? authRes.signalStop}`,
      });
    }
    if (authRes.exitCode !== 0 || authRes.error) {
      let detail = authRes.error?.message || authRes.stderr || authRes.stdout;
      try {
        const parsed = JSON.parse(authRes.stdout);
        if (parsed?.detail) detail = parsed.detail;
      } catch {}
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: scrubDiagnostics(`devin auth preflight failed: ${detail}`, extraPaths),
      });
    }

    const tmpOut = join(stateDir, 'tmp', `${runId}.json`);
    mkdirSync(join(stateDir, 'tmp'), { recursive: true });
    const evalArgs = ['--arm', arm, '--exam', 'eval', '--out', tmpOut, '--require-langfuse'];
    const onlyIdx = argv.indexOf('--only');
    if (onlyIdx >= 0 && argv[onlyIdx + 1]) evalArgs.push('--only', argv[onlyIdx + 1]);

    const childRes = await runStep(
      process.execPath,
      ['--import', 'tsx', join(repoDir, 'eval', 'run.ts'), ...evalArgs],
      {
        cwd: repoDir,
        env: mergedEnv,
        timeoutMs: runTimeoutMs,
        name: 'eval-daily-suite',
        useOwned: true,
      },
    );

    if (childRes.interrupted) {
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: `interrupted by signal ${currentSignal ?? childRes.signalStop}`,
        outJson: readJsonOrNull(tmpOut),
      });
    }
    if (childRes.timedOut || childRes.exitCode === 124) {
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: `eval run timed out after ${runTimeoutMs}ms`,
        outJson: readJsonOrNull(tmpOut),
      });
    }
    if (childRes.signal || childRes.exitCode > 128) {
      return persistAndReturn({
        forceStatus: 'incomplete',
        failureReason: `eval run killed by signal (${childRes.signal ?? childRes.exitCode - 128})`,
        outJson: readJsonOrNull(tmpOut),
      });
    }

    const outJson = readJsonOrNull(tmpOut);
    safeUnlink(tmpOut);

    return persistAndReturn({
      evalExitCode: childRes.exitCode,
      outJson,
      failureReason:
        childRes.exitCode !== 0
          ? scrubDiagnostics(
              childRes.stderr || childRes.stdout || `exit=${childRes.exitCode}`,
              extraPaths,
            )
          : '',
    });
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    releaseLock(stateDir, runId);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDailyEval();
}
