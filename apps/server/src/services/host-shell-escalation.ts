import { createHash } from 'node:crypto';
import {
  type AskUserQuestion,
  type ComputerCall,
  HOST_SHELL_ESCALATION_DENIED,
  ownComputerHardlineRefusal,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { type actionProposal, computerCall, machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import {
  COMPUTER_INTERRUPTED,
  COMPUTER_NOT_CONNECTED,
  COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS,
  computerCallId,
  computerDeadlineMs,
  getPendingComputerCall,
  isFinalComputerCallState,
  openPendingComputerCall,
  type PendingComputerDeps,
  resultOfComputerCallRow,
  storedComputerParams,
} from './computer-call-store.js';
import { isOwnerDecider } from './instance-owner.js';

export const HOST_SHELL_ESCALATION_ACTION = 'host.shell.escalate';
export const HOST_SHELL_ESCALATION_TOOL_CALL_ID = 'host-shell-escalate';

const ESCALATION_COMMAND_MAX_CHARS = 4000;
const ESCALATION_CWD_MAX_CHARS = 4096;
const ESCALATION_DISPATCH_WINDOW_MS = 5 * 60_000;
const DISALLOWED_COMMAND_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function hasDisallowedDisplayChars(text: string, allowNewline: boolean): boolean {
  for (const ch of text) {
    if (allowNewline && ch === '\n') continue;
    if (DISALLOWED_COMMAND_CHARS.test(ch)) return true;
  }
  return false;
}

function stripDisallowedDisplayChars(text: string): string {
  let out = '';
  for (const ch of text) {
    if (!DISALLOWED_COMMAND_CHARS.test(ch)) out += ch;
  }
  return out;
}

export const hostShellEscalationBindingSchema = z.strictObject({
  machineId: z.string().min(1).max(200),
  command: z.string().min(1).max(ESCALATION_COMMAND_MAX_CHARS),
  cwd: z.string().max(ESCALATION_CWD_MAX_CHARS).optional(),
  timeoutMs: z.number().int().positive().max(COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS).optional(),
});
export type HostShellEscalationBinding = z.infer<typeof hostShellEscalationBindingSchema>;

export type ValidatedEscalationParams =
  | { kind: 'refused'; text: string }
  | { kind: 'ok'; command: string; cwd?: string; timeoutMs?: number };

export function validateHostShellEscalationParams(
  params: Record<string, unknown>,
): ValidatedEscalationParams {
  const command = params.command;
  if (typeof command !== 'string' || command.trim() === '') {
    throw new HttpError(400, 'user_computer_shell escalation requires a non-empty command string');
  }
  if (command.length > ESCALATION_COMMAND_MAX_CHARS) {
    throw new HttpError(
      400,
      `command is too long (${command.length} chars) for the owner to review safely on one approval card (max ${ESCALATION_COMMAND_MAX_CHARS} chars)`,
    );
  }
  if (hasDisallowedDisplayChars(command, true)) {
    throw new HttpError(
      400,
      'command contains control or invisible characters that cannot be reviewed safely on an approval card',
    );
  }
  const hardline = ownComputerHardlineRefusal(command);
  if (hardline !== null) return { kind: 'refused', text: hardline };

  let cwd: string | undefined;
  if (params.cwd !== undefined) {
    if (
      typeof params.cwd !== 'string' ||
      params.cwd.trim() === '' ||
      params.cwd.length > ESCALATION_CWD_MAX_CHARS ||
      hasDisallowedDisplayChars(params.cwd, false)
    ) {
      throw new HttpError(400, 'invalid cwd for escalated command');
    }
    cwd = params.cwd;
  }

  let timeoutMs: number | undefined;
  if (params.timeoutMs !== undefined) {
    if (
      typeof params.timeoutMs !== 'number' ||
      !Number.isInteger(params.timeoutMs) ||
      params.timeoutMs <= 0 ||
      params.timeoutMs > COMPUTER_SHELL_COMMAND_TIMEOUT_MAX_MS
    ) {
      throw new HttpError(400, 'invalid timeoutMs for escalated command');
    }
    timeoutMs = params.timeoutMs;
  }

  return {
    kind: 'ok',
    command,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export function hostShellEscalationTargetId(
  threadId: string,
  binding: HostShellEscalationBinding,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        threadId,
        machineId: binding.machineId,
        command: binding.command,
        cwd: binding.cwd ?? null,
        timeoutMs: binding.timeoutMs ?? null,
      }),
    )
    .digest('hex');
}

function safeComputerLabel(name: string): string {
  const cleaned = stripDisallowedDisplayChars(name.replace(/[\r\n\t：:]+/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? 'Mac' : cleaned.slice(0, 80);
}

export function hostShellEscalationCard(
  computerName: string,
  command: string,
  approveLabel: string,
  refuseLabel: string,
  cwd?: string,
): AskUserQuestion[] {
  const host = safeComputerLabel(computerName);
  const question =
    cwd !== undefined
      ? `Coordinator 想在 ${host} 上不经沙箱运行这条命令\n目录：${cwd}\n命令：${command}`
      : `Coordinator 想在 ${host} 上不经沙箱运行这条命令：${command}`;
  return [
    {
      header: '审批',
      question,
      options: [{ label: approveLabel }, { label: refuseLabel }],
    },
  ];
}

export function parseHostShellEscalationInput(raw: unknown): HostShellEscalationBinding {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'invalid host shell escalation payload');
  }
  const { cardDigest: _card, untrustedTurn: _untrusted, ...rest } = raw as Record<string, unknown>;
  const parsed = hostShellEscalationBindingSchema.safeParse(rest);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid host shell escalation binding');
  }
  if (hasDisallowedDisplayChars(parsed.data.command, true)) {
    throw new HttpError(400, 'invalid host shell escalation command characters');
  }
  if (parsed.data.cwd !== undefined && hasDisallowedDisplayChars(parsed.data.cwd, false)) {
    throw new HttpError(400, 'invalid host shell escalation cwd characters');
  }
  return parsed.data;
}

export function validateHostShellEscalationApproval(
  db: Pick<Db, 'select'>,
  teamId: string,
  rawInput: unknown,
): HostShellEscalationBinding {
  const binding = parseHostShellEscalationInput(rawInput);
  const hardline = ownComputerHardlineRefusal(binding.command);
  if (hardline !== null) {
    throw new HttpError(409, hardline);
  }
  const host = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.id, binding.machineId)))
    .get();
  if (host?.kind !== 'local' || host.capabilities?.ownComputerShell !== true) {
    throw new HttpError(409, 'this Mac is no longer available for host shell commands');
  }
  return binding;
}

export function hostShellEscalationWakePrompt(
  outcome: string,
  binding: HostShellEscalationBinding | null,
  callResultText?: string,
): string {
  const command = binding?.command ?? '';
  if (outcome === 'refused') {
    return `The owner declined running this command without the sandbox (${HOST_SHELL_ESCALATION_DENIED}).\nCommand: ${command}\nDo not run it or request approval again unless the owner asks you to.`;
  }
  if (outcome === 'expired') {
    return `The approval request to run this command without the sandbox expired without an answer; nothing ran.\nCommand: ${command}`;
  }
  if (outcome === 'executed') {
    return [
      'The owner approved running this exact command once without the sandbox, and it has now finished.',
      `Command: ${command}`,
      ...(binding?.cwd !== undefined ? [`Directory: ${binding.cwd}`] : []),
      'Output:',
      callResultText ?? '(no output)',
      'Continue the conversation using this result. Do not re-run the escalated command.',
    ].join('\n');
  }
  return `The host shell escalation (${outcome}) did not run.\nCommand: ${command}`;
}

type ProposalRow = typeof actionProposal.$inferSelect;

export type ApprovedEscalationPoll = { state: 'ready'; resultText: string } | { state: 'pending' };

export function pollOrStartApprovedHostShellEscalation(
  deps: { db: Db; hub: PendingComputerDeps['hub']; machineHub?: PendingComputerDeps['machineHub'] },
  proposal: ProposalRow,
  onSettled: () => void,
  now = nowMs(),
): ApprovedEscalationPoll {
  const escalationStepId = `escalation:${proposal.id}`;
  const callId = computerCallId(escalationStepId, HOST_SHELL_ESCALATION_TOOL_CALL_ID);
  const existing = deps.db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
  if (existing !== undefined) {
    if (isFinalComputerCallState(existing.state)) {
      return { state: 'ready', resultText: resultOfComputerCallRow(existing).text };
    }
    if (getPendingComputerCall(callId) !== undefined) {
      return { state: 'pending' };
    }
    deps.db
      .update(computerCall)
      .set({
        state: 'interrupted',
        errorMessage: 'the server restarted before this escalated command finished',
        errorDelivery: 'unknown',
        finishedAt: now,
      })
      .where(eq(computerCall.id, callId))
      .run();
    return { state: 'ready', resultText: `computer call ${COMPUTER_INTERRUPTED}` };
  }

  if (proposal.status !== 'executed' || proposal.decision !== 'allow-once') {
    return { state: 'ready', resultText: 'escalation approval is no longer active' };
  }
  if (
    proposal.decidedBy === null ||
    !isOwnerDecider(deps.db, proposal.decidedBy, proposal.teamId) ||
    proposal.revokedAt !== null
  ) {
    return { state: 'ready', resultText: 'escalation was not approved by the owner' };
  }
  if (proposal.decidedAt === null || now - proposal.decidedAt > ESCALATION_DISPATCH_WINDOW_MS) {
    return {
      state: 'ready',
      resultText: 'approval dispatch window elapsed before execution; nothing ran',
    };
  }

  let binding: HostShellEscalationBinding;
  try {
    binding = validateHostShellEscalationApproval(
      deps.db,
      proposal.teamId,
      JSON.parse(proposal.inputJson),
    );
  } catch (error) {
    return {
      state: 'ready',
      resultText: error instanceof Error ? error.message : 'escalation could not be validated',
    };
  }

  const callParams: Record<string, unknown> = {
    command: binding.command,
    ...(binding.cwd !== undefined ? { cwd: binding.cwd } : {}),
    ...(binding.timeoutMs !== undefined ? { timeoutMs: binding.timeoutMs } : {}),
  };
  const deadlineAt = now + computerDeadlineMs('user_computer_shell', callParams);

  const inserted = deps.db
    .insert(computerCall)
    .values({
      id: callId,
      teamId: proposal.teamId,
      stepId: escalationStepId,
      toolCallId: HOST_SHELL_ESCALATION_TOOL_CALL_ID,
      machineId: binding.machineId,
      computerId: null,
      phoneId: null,
      tool: 'user_computer_shell',
      replaySafe: false,
      params: { ...storedComputerParams(callParams), escalatedProposalId: proposal.id },
      state: 'dispatched',
      deadlineAt,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();

  if (inserted.changes === 0) {
    const raced = deps.db.select().from(computerCall).where(eq(computerCall.id, callId)).get();
    if (raced !== undefined && isFinalComputerCallState(raced.state)) {
      return { state: 'ready', resultText: resultOfComputerCallRow(raced).text };
    }
    return { state: 'pending' };
  }

  const call: ComputerCall = {
    callId,
    stepId: escalationStepId,
    tool: 'user_computer_shell',
    params: callParams,
    deadlineAt,
    hostShellEscalation: 'approved',
  };

  if (deps.machineHub === undefined || !deps.machineHub.pushComputer(binding.machineId, call)) {
    deps.db
      .update(computerCall)
      .set({
        state: 'error',
        errorMessage: COMPUTER_NOT_CONNECTED,
        errorDelivery: 'not_delivered',
        finishedAt: now,
      })
      .where(eq(computerCall.id, callId))
      .run();
    return {
      state: 'ready',
      resultText: `computer error: ${COMPUTER_NOT_CONNECTED} (the action did not run)`,
    };
  }

  const pending = openPendingComputerCall(
    { db: deps.db, hub: deps.hub, machineHub: deps.machineHub },
    call,
  );
  void pending.result.finally(() => {
    onSettled();
  });
  return { state: 'pending' };
}
