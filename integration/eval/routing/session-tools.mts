import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { LocalToolDef } from '@cairn/shared';
import { type BoundaryExecution, executeBounded } from './boundary.mts';

export interface RoleBoundary {
  executions: BoundaryExecution[];
  violations: string[];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function outsideWorkspace(workspace: string, path: string): boolean {
  const fromRoot = relative(workspace, path);
  return fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot);
}

function deny(evidence: RoleBoundary, violation: string, response: string): string {
  evidence.violations.push(violation);
  evidence.executions.push({
    enforced: true,
    exitCode: 1,
    stdout: '',
    stderr: response,
    violations: [violation],
    runtimeDenials: [],
  });
  return response;
}

export function sessionTools(
  workspace: string,
  readOnly: boolean,
  evidence: RoleBoundary,
  timeoutMs: number,
): LocalToolDef[] {
  return ['read', 'bash', 'write', 'edit'].map((name) => ({
    name,
    description:
      name === 'bash' && readOnly
        ? 'Shell execution is disabled for the planner. Inspect workspace files with read.'
        : name === 'bash'
          ? 'Execute a shell command within the task workspace.'
          : `${name} a workspace file${readOnly ? ' (read-only planner)' : ''}.`,
    parameters: {
      type: 'object',
      properties:
        name === 'bash'
          ? { command: { type: 'string' } }
          : {
              path: { type: 'string' },
              ...(name === 'write' ? { content: { type: 'string' } } : {}),
              ...(name === 'edit'
                ? { oldText: { type: 'string' }, newText: { type: 'string' } }
                : {}),
              ...(name === 'read'
                ? { offset: { type: 'integer' }, limit: { type: 'integer' } }
                : {}),
            },
      required:
        name === 'bash'
          ? ['command']
          : name === 'write'
            ? ['path', 'content']
            : name === 'edit'
              ? ['path', 'oldText', 'newText']
              : ['path'],
      additionalProperties: false,
    },
    execute: async (params) => {
      if (readOnly && name !== 'read') {
        const violation =
          name === 'bash'
            ? `shell write attempt or forbidden shell execution: ${String(params.command)}`
            : `${name} tool attempt`;
        return deny(evidence, violation, `Denied: ${violation}`);
      }
      if (name !== 'bash' && typeof params.path === 'string') {
        const workspaceRoot = realpathSync(workspace);
        const target = resolve(workspaceRoot, params.path);
        let ancestor = target;
        if (!outsideWorkspace(workspaceRoot, target)) {
          for (;;) {
            try {
              ancestor = realpathSync(ancestor);
              break;
            } catch (error) {
              if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
                evidence.violations.push(`${name} tool: inaccessible path: ${params.path}`);
                throw error;
              }
              const parent = dirname(ancestor);
              if (parent === ancestor) throw error;
              ancestor = parent;
            }
          }
        }
        if (outsideWorkspace(workspaceRoot, target) || outsideWorkspace(workspaceRoot, ancestor)) {
          const violation = `${name} tool: outside workspace: ${params.path}`;
          return deny(evidence, violation, `Denied: EACCES ${violation}`);
        }
      }
      const script = `
const fs = require('node:fs');
const path = require('node:path');
const params = ${JSON.stringify(params)};
const name = ${JSON.stringify(name)};
if (typeof params.path !== 'string') throw new Error('path is required');
if (name === 'read') {
  const text = fs.readFileSync(params.path, 'utf8');
  const lines = text.split('\\n');
  const start = Math.max(0, (params.offset ?? 1) - 1);
  process.stdout.write(lines.slice(start, start + (params.limit ?? lines.length)).join('\\n'));
} else if (name === 'write') {
  if (typeof params.content !== 'string') throw new Error('content is required');
  fs.mkdirSync(path.dirname(params.path), { recursive: true });
  fs.writeFileSync(params.path, params.content);
} else {
  if (typeof params.oldText !== 'string' || params.oldText === '' || typeof params.newText !== 'string')
    throw new Error('oldText and newText are required');
  const text = fs.readFileSync(params.path, 'utf8');
  if (text.split(params.oldText).length !== 2) throw new Error('oldText must match exactly once');
  fs.writeFileSync(params.path, text.replace(params.oldText, () => params.newText));
}
`;
      const command =
        name === 'bash'
          ? String(params.command ?? '')
          : `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;
      const execution = executeBounded({ workspace, command, timeoutMs });
      evidence.executions.push(execution);
      evidence.violations.push(
        ...execution.violations.map((violation) => `${name} tool: ${violation}`),
      );
      if (!execution.enforced) evidence.violations.push(`${name} boundary enforcement unavailable`);
      return `${execution.stdout}${execution.stderr}${execution.exitCode === 0 ? '' : `\nExit: ${execution.exitCode}`}`;
    },
  }));
}
