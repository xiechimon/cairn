import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundGitCredentials } from '@cairn/shared';
import { gitCredentialEnv } from './git.js';

export const HOOK_OUTPUT_CHAR_LIMIT = 100_000;

export interface WorkspaceHookNote {
  name: 'setup' | 'resume';
  status: 'ok' | 'failed' | 'timeout';
  exitCode: number | null;
  output: string;
  totalChars: number;
  ms: number;
}

export class WorkspaceHookError extends Error {
  readonly note: WorkspaceHookNote;
  constructor(note: WorkspaceHookNote, message: string) {
    super(message);
    this.name = 'WorkspaceHookError';
    this.note = note;
  }
}

export interface RunWorkspaceHookInput {
  cwd: string;
  name: 'setup' | 'resume';
  credentials: BoundGitCredentials | null;
  timeoutMs: number;
  log: (line: string) => void;
}

export async function runWorkspaceHook(
  input: RunWorkspaceHookInput,
): Promise<WorkspaceHookNote | null> {
  const { cwd, name, credentials, timeoutMs, log } = input;
  const path = join(cwd, '.agents', name);
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (!st.isFile()) {
    throw new WorkspaceHookError(
      hookNote(name, 'failed', null, '', 0, 0),
      `workspace hook .agents/${name} is not a regular file — fix or remove it`,
    );
  }
  if (!(st.mode & 0o111)) {
    throw new WorkspaceHookError(
      hookNote(name, 'failed', null, '', 0, 0),
      `workspace hook .agents/${name} is not executable — run chmod +x .agents/${name}`,
    );
  }
  log(`${name} hook: running`);
  const env: NodeJS.ProcessEnv =
    credentials !== null
      ? { ...process.env, ...gitCredentialEnv(credentials) }
      : { ...process.env };
  const startedAt = Date.now();
  let kept = '';
  let total = 0;
  const collect = (buf: Buffer): void => {
    const s = buf.toString('utf8');
    total += s.length;
    if (kept.length < HOOK_OUTPUT_CHAR_LIMIT) {
      kept += s.slice(0, HOOK_OUTPUT_CHAR_LIMIT - kept.length);
    }
  };
  let timedOut = false;
  let spawnError: Error | null = null;
  let settled = false;
  const child = spawn(path, [], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }, timeoutMs);
  const note = await new Promise<WorkspaceHookNote>((resolve) => {
    child.on('error', (err: Error) => {
      spawnError = err;
      finish(null);
    });
    child.on('close', (code: number | null) => finish(code));
    function finish(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ms = Date.now() - startedAt;
      if (spawnError !== null) {
        log(`${name} hook: spawn failed (${spawnError.message})`);
        resolve(hookNote(name, 'failed', null, kept, total, ms));
        return;
      }
      if (timedOut && code === null) {
        resolve(hookNote(name, 'timeout', null, kept, total, ms));
        return;
      }
      resolve(hookNote(name, code === 0 ? 'ok' : 'failed', code, kept, total, ms));
    }
  });
  if (note.status === 'ok') {
    log(`${name} hook: ok (${note.ms}ms)`);
    return note;
  }
  throw new WorkspaceHookError(note, workspaceHookErrorMessage(note));
}

function hookNote(
  name: 'setup' | 'resume',
  status: WorkspaceHookNote['status'],
  exitCode: number | null,
  output: string,
  totalChars: number,
  ms: number,
): WorkspaceHookNote {
  return { name, status, exitCode, output, totalChars, ms };
}

export function workspaceHookErrorMessage(note: WorkspaceHookNote): string {
  const tail = tailOf(note.output);
  if (note.status === 'timeout') {
    return `workspace hook .agents/${note.name} timed out after ${Math.round(note.ms / 1000)}s and its process group was killed${tail !== '' ? ` — last output: ${tail}` : ''}`;
  }
  return `workspace hook .agents/${note.name} exited ${note.exitCode}${tail !== '' ? ` — ${tail}` : ''}`;
}

function tailOf(output: string): string {
  const trimmed = output.trim();
  if (trimmed === '') return '';
  const lines = trimmed.split('\n');
  return lines.slice(-5).join('\n').slice(-500);
}
