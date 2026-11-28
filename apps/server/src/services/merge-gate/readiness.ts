import { MERGE_GATE_STATUS_CONTEXT, type MergeBlockerCode } from '@cairn/shared/merge-gate';

export interface GateCheckRun {
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
}

export interface GateCommitStatus {
  context: string;
  state: string;
}

export interface RequiredChecks {
  headSha: string;
  statusSha: string;
  required: string[] | null;
  runs: GateCheckRun[];
  statuses: GateCommitStatus[];
  complete: boolean;
}

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const FULL_SHA = /^[0-9a-f]{40}$/;
export const isFullSha = (s: string) => FULL_SHA.test(s);

const DETAIL_NAME_CHARS = 120;
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function escapeChar(ch: string): string {
  const json = JSON.stringify(ch).slice(1, -1);
  if (json !== ch || !UNSAFE_CHAR.test(ch)) return json;
  return Array.from(
    { length: ch.length },
    (_, k) => `\\u${ch.charCodeAt(k).toString(16).padStart(4, '0')}`,
  ).join('');
}

function quoted(name: string): string {
  let body = '';
  for (const ch of name) {
    const esc = escapeChar(ch);
    if (body.length + esc.length > DETAIL_NAME_CHARS) return `"${body}"…`;
    body += esc;
  }
  return `"${body}"`;
}

const runPasses = (r: GateCheckRun) =>
  r.status === 'completed' && r.conclusion !== null && PASSING_CONCLUSIONS.has(r.conclusion);

export function requiredChecksReadiness(
  head: string | null,
  input: RequiredChecks | null,
  block: (code: MergeBlockerCode, ...detail: string[]) => void,
) {
  let checks = input;
  const checkShas =
    checks === null ? [] : [checks.headSha, checks.statusSha, ...checks.runs.map((r) => r.headSha)];
  if (checks !== null && !checkShas.every(isFullSha)) {
    block('required-checks-unreadable', 'check SHA not 40 lowercase hex');
    checks = null;
  } else if (checks !== null && head !== null && checkShas.some((s) => s !== head)) {
    block('required-checks-unreadable', 'checks not read at the PR head');
    checks = null;
  } else if (checks !== null && !checks.complete) {
    block('required-checks-unreadable', 'check list incomplete');
    checks = null;
  }
  if (checks === null || checks.required === null) {
    block('required-checks-unreadable');
  } else {
    const required = checks.required;
    if (required.length === 0) block('required-checks-none');
    for (const name of required) {
      if (name.toLowerCase() === MERGE_GATE_STATUS_CONTEXT) {
        block('self-required');
        continue;
      }
      const run = checks.runs.find((r) => r.name === name);
      const status = checks.statuses.find((s) => s.context.toLowerCase() === name.toLowerCase());
      if (run !== undefined) {
        if (run.status !== 'completed') block('required-check-pending', quoted(name));
        else if (!runPasses(run))
          block('required-check-failed', `${quoted(name)}: ${run.conclusion ?? 'none'}`);
      } else if (status !== undefined) {
        if (status.state === 'pending') block('required-check-pending', quoted(name));
        else if (status.state !== 'success')
          block('required-check-failed', `${quoted(name)}: ${status.state}`);
      } else {
        block('required-check-missing', quoted(name));
      }
    }
  }
}
