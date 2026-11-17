import { createHash } from 'node:crypto';
import {
  COMPUTER_HANDOFF_TIMEOUT_MS,
  type ComputerTool,
  OWN_COMPUTER_ALLOW_COMMAND,
  OWN_COMPUTER_ALLOW_CONVERSATION,
  OWN_COMPUTER_ALLOW_ONCE,
  OWN_COMPUTER_APP_ACTION,
  OWN_COMPUTER_DENIED,
  OWN_COMPUTER_DENY,
  OWN_COMPUTER_NEVER_DRIVEN,
  OWN_COMPUTER_NEVER_DRIVEN_TEXT,
  OWN_COMPUTER_NO_ACCESSIBILITY,
  OWN_COMPUTER_NO_ANSWER,
  OWN_COMPUTER_NO_SHELL,
  OWN_COMPUTER_NOT_INSTALLED,
  OWN_COMPUTER_NOT_ON,
  OWN_COMPUTER_NOT_OWNER_TURN,
  OWN_COMPUTER_SHELL_ACTION,
  type OwnComputerGrant,
  type OwnComputerGrantStamp,
  ownComputerGrantKey,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actionProposal, chiefThread, computerCall, machine, step } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import {
  type Decision,
  endPendingProposal,
  endPendingProposalIn,
  proposalCardId,
  proposeAction,
} from './action-proposals.js';
import { announceQuestion } from './chief-questions.js';
import { COMPUTER_HANDOFF_POLL_MS, pause } from './computer-handoff.js';
import { isOwner } from './instance-owner.js';
import type { MachineDeps } from './machine-deps.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

export type OwnComputerTool = 'user_computer_shell' | 'user_computer_observe' | 'user_computer_act';

export const OWN_COMPUTER_TOOL_NAMES: readonly OwnComputerTool[] = [
  'user_computer_shell',
  'user_computer_observe',
  'user_computer_act',
];

export function isOwnComputerTool(tool: ComputerTool | string): tool is OwnComputerTool {
  return (OWN_COMPUTER_TOOL_NAMES as readonly string[]).includes(tool);
}

export const OWN_COMPUTER_SHELL_CWD =
  'user_computer_shell runs in the Runner folder; put any cd inside the command. Nothing ran.';
export const OWN_COMPUTER_SEVERAL_MACS = (names: readonly string[]) =>
  `Several Macs let the agent use them (${names.join(', ')}); the owner turns off all but one in Settings, Computers. Nothing ran.`;
export const OWN_COMPUTER_DISCONNECTED = (mac: string) =>
  `${mac} is not connected, so the agent cannot use it now. Nothing ran.`;

type StepRow = typeof step.$inferSelect;
type ThreadRow = typeof chiefThread.$inferSelect;
type MachineRow = typeof machine.$inferSelect;
type ProposalRow = typeof actionProposal.$inferSelect;

type ClosedTurn = { kind: 'refused'; text: string };

export function ownerTurnRefusal(db: Db, stepRow: StepRow, thread: ThreadRow): string | null {
  if ((stepRow.prompt ?? '').startsWith('[wake:'))
    return `${OWN_COMPUTER_NOT_OWNER_TURN} This turn was started by a routine, watch, mail or gate wake.`;
  if ((stepRow.ownerMessageIds ?? []).length === 0)
    return `${OWN_COMPUTER_NOT_OWNER_TURN} This turn was not started by an owner message.`;
  if (!isOwner(db, thread.userId))
    return `${OWN_COMPUTER_NOT_OWNER_TURN} This conversation belongs to someone else.`;
  return null;
}

function switchedOn(db: Db, teamId: string): MachineRow[] {
  return db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.ownComputerEnabled, true)))
    .all();
}

export function teamOffersOwnComputer(db: Db, teamId: string): boolean {
  return switchedOn(db, teamId).some(
    (row) => row.capabilities?.ownComputer === true || row.capabilities?.ownComputerShell === true,
  );
}

export function ownComputerOffered(db: Db, threadId: string, stepId: string | null): boolean {
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (thread === undefined || stepId === null) return false;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stepRow === undefined) return false;
  return teamOffersOwnComputer(db, thread.teamId) && ownerTurnRefusal(db, stepRow, thread) === null;
}

function liveMachine(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  teamId: string,
): MachineRow | ClosedTurn {
  const on = switchedOn(deps.db, teamId);
  if (on.length === 0) return { kind: 'refused', text: OWN_COMPUTER_NOT_ON };
  const connected = on.filter((row) => deps.machineHub.isConnected(row.id));
  if (connected.length > 1)
    return { kind: 'refused', text: OWN_COMPUTER_SEVERAL_MACS(connected.map((row) => row.name)) };
  const chosen = connected[0];
  if (chosen === undefined)
    return {
      kind: 'refused',
      text: OWN_COMPUTER_DISCONNECTED(on.map((row) => row.name).join(', ')),
    };
  return chosen;
}

function shellTarget(machineId: string, command: string): string {
  return `${machineId}:${createHash('sha256').update(command).digest('hex')}`;
}

interface Request {
  tool: OwnComputerTool;
  key: string;
  label: string;
  actionId: string;
  targetId: string;
}

function requestOf(
  host: MachineRow,
  tool: OwnComputerTool,
  params: Record<string, unknown>,
): Request | ClosedTurn {
  const key = ownComputerGrantKey(tool, params);
  if (tool === 'user_computer_shell') {
    if (key === null)
      return { kind: 'refused', text: 'user_computer_shell needs a command. Nothing ran.' };
    if (params.cwd !== undefined) return { kind: 'refused', text: OWN_COMPUTER_SHELL_CWD };
    if (host.capabilities?.ownComputerShell !== true)
      return { kind: 'refused', text: OWN_COMPUTER_NO_SHELL(host.name) };
    return {
      tool,
      key,
      label: `the command ${key}`,
      actionId: OWN_COMPUTER_SHELL_ACTION,
      targetId: shellTarget(host.id, key),
    };
  }
  if (key === null) return { kind: 'refused', text: `${tool} needs an app name. Nothing ran.` };
  if (host.capabilities?.ownComputer !== true)
    return { kind: 'refused', text: OWN_COMPUTER_NOT_INSTALLED(host.name) };
  if (host.capabilities?.hostPermissions?.accessibility !== 'granted')
    return { kind: 'refused', text: OWN_COMPUTER_NO_ACCESSIBILITY(host.name) };
  if (OWN_COMPUTER_NEVER_DRIVEN.includes(key))
    return { kind: 'refused', text: OWN_COMPUTER_NEVER_DRIVEN_TEXT(String(params.app).trim()) };
  return {
    tool,
    key,
    label: String(params.app).trim(),
    actionId: OWN_COMPUTER_APP_ACTION,
    targetId: `${host.id}:${key}`,
  };
}

interface Binding {
  machineId: string;
  key: string;
  threadId: string;
  stepId: string;
  toolCallId: string;
}

function bindingOf(row: Pick<ProposalRow, 'inputJson'>): Partial<Binding> {
  try {
    return JSON.parse(row.inputJson) as Partial<Binding>;
  } catch {
    return {};
  }
}

function grantFor(
  db: Db,
  teamId: string,
  request: Request,
  call: { threadId: string; stepId: string; toolCallId: string },
): ProposalRow | undefined {
  return db
    .select()
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.teamId, teamId),
        eq(actionProposal.actionId, request.actionId),
        eq(actionProposal.targetId, request.targetId),
        eq(actionProposal.status, 'executed'),
      ),
    )
    .all()
    .find((row) => {
      if (row.decidedBy === null || !isOwner(db, row.decidedBy)) return false;
      const bound = bindingOf(row);
      if (bound.key !== request.key) return false;
      if (row.decision === 'allow-once')
        return bound.stepId === call.stepId && bound.toolCallId === call.toolCallId;
      if (row.decision === 'conversation') return bound.threadId === call.threadId;
      return row.decision === 'always';
    });
}

function cardFor(request: Request, host: MachineRow) {
  const shell = request.tool === 'user_computer_shell';
  return [
    {
      header: shell ? '在你的 Mac 上运行命令' : '使用你的 Mac 上的应用',
      question: shell
        ? `Coordinator 想在 ${host.name} 上以你的身份运行这条命令：${request.key}`
        : `Coordinator 想在 ${host.name} 上读取和操作 ${request.label}。`,
      options: [
        { label: OWN_COMPUTER_ALLOW_ONCE },
        { label: shell ? OWN_COMPUTER_ALLOW_COMMAND : OWN_COMPUTER_ALLOW_CONVERSATION },
        { label: OWN_COMPUTER_DENY },
      ],
    },
  ];
}

export function ownComputerDecisionOf(choice: string | undefined): Decision {
  if (choice === OWN_COMPUTER_ALLOW_ONCE) return 'allow-once';
  if (choice === OWN_COMPUTER_ALLOW_CONVERSATION) return 'conversation';
  if (choice === OWN_COMPUTER_ALLOW_COMMAND) return 'always';
  return 'refuse';
}

export type GateResult =
  | { kind: 'refused'; text: string }
  | { kind: 'granted'; machineId: string; stamp: OwnComputerGrantStamp };

export interface GateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
}

export async function ownComputerGate(
  deps: MachineDeps,
  stepRow: StepRow,
  thread: ThreadRow,
  tool: OwnComputerTool,
  toolCallId: string,
  params: Record<string, unknown>,
  opts: GateOptions = {},
): Promise<GateResult> {
  const { db } = deps;
  const turnRefusal = ownerTurnRefusal(db, stepRow, thread);
  if (switchedOn(db, thread.teamId).length === 0)
    return { kind: 'refused', text: OWN_COMPUTER_NOT_ON };
  if (turnRefusal !== null) return { kind: 'refused', text: turnRefusal };
  const host = liveMachine(deps, thread.teamId);
  if ('text' in host) return host;
  const request = requestOf(host, tool, params);
  if ('text' in request) return request;
  const call = { threadId: thread.id, stepId: stepRow.id, toolCallId };
  const granted = (row: ProposalRow): GateResult => ({
    kind: 'granted',
    machineId: host.id,
    stamp: { proposalId: row.id, key: request.key },
  });
  const existing = grantFor(db, thread.teamId, request, call);
  if (existing !== undefined) return granted(existing);

  const binding: Binding = { machineId: host.id, key: request.key, ...call };
  const proposal = proposeAction(db, {
    teamId: thread.teamId,
    actionId: request.actionId,
    targetId: request.targetId,
    input: binding,
    threadId: thread.id,
    scopeProjectId: stepRow.scopeProjectId,
    card: cardFor(request, host),
    subscribe: false,
  });
  if (proposal.created) announceQuestion(deps, thread.id, proposalCardId(proposal.proposalId));
  const deadline = nowMs() + (opts.timeoutMs ?? COMPUTER_HANDOFF_TIMEOUT_MS);
  const pollMs = opts.pollMs ?? COMPUTER_HANDOFF_POLL_MS;
  for (;;) {
    const row = db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.id, proposal.proposalId))
      .get();
    if (row?.status === 'executed') {
      const live = grantFor(db, thread.teamId, request, call);
      return live === undefined
        ? { kind: 'refused', text: OWN_COMPUTER_NO_ANSWER(request.label) }
        : granted(live);
    }
    if (row?.status === 'refused')
      return { kind: 'refused', text: OWN_COMPUTER_DENIED(request.label) };
    if (row?.status !== 'pending')
      return { kind: 'refused', text: OWN_COMPUTER_NO_ANSWER(request.label) };
    const still = liveMachine(deps, thread.teamId);
    const owner = db
      .select({ status: step.status })
      .from(step)
      .where(eq(step.id, stepRow.id))
      .get();
    const ended =
      'text' in still ||
      still.id !== host.id ||
      owner?.status !== 'claimed' ||
      opts.signal?.aborted === true ||
      nowMs() >= deadline;
    if (ended) {
      endPendingProposal(db, proposal.proposalId, 'expired');
      return 'text' in still
        ? still
        : { kind: 'refused', text: OWN_COMPUTER_NO_ANSWER(request.label) };
    }
    await pause(pollMs, opts.signal);
  }
}

const STANDING: Decision[] = ['conversation', 'always'];

export function listOwnComputerGrants(db: Db, machineRow: MachineRow): OwnComputerGrant[] {
  return db
    .select()
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.teamId, machineRow.teamId),
        inArray(actionProposal.actionId, [OWN_COMPUTER_APP_ACTION, OWN_COMPUTER_SHELL_ACTION]),
        eq(actionProposal.status, 'executed'),
        inArray(actionProposal.decision, STANDING),
      ),
    )
    .all()
    .flatMap((row) => {
      const bound = bindingOf(row);
      if (bound.machineId !== machineRow.id || bound.key === undefined) return [];
      if (row.decidedBy === null || !isOwner(db, row.decidedBy)) return [];
      const thread =
        row.decision === 'conversation' && bound.threadId !== undefined
          ? db
              .select({ title: chiefThread.title })
              .from(chiefThread)
              .where(eq(chiefThread.id, bound.threadId))
              .get()
          : undefined;
      return [
        {
          proposalId: row.id,
          kind: row.actionId === OWN_COMPUTER_SHELL_ACTION ? ('shell' as const) : ('app' as const),
          key: bound.key,
          threadId: row.decision === 'conversation' ? (bound.threadId ?? null) : null,
          threadTitle: thread?.title ?? null,
          decidedAt: row.decidedAt ?? row.createdAt,
        },
      ];
    })
    .sort((a, b) => b.decidedAt - a.decidedAt);
}

export function revokeOwnComputerGrant(db: Db, machineRow: MachineRow, proposalId: string): void {
  const found = listOwnComputerGrants(db, machineRow).find(
    (grant) => grant.proposalId === proposalId,
  );
  if (found === undefined) throw notFound(`grant ${proposalId}`);
  db.update(actionProposal)
    .set({ status: 'superseded' })
    .where(and(eq(actionProposal.id, proposalId), eq(actionProposal.status, 'executed')))
    .run();
}

export function setOwnComputerEnabled(
  deps: { db: Db; machineHub: MachineWakeHub },
  machineRow: MachineRow,
  enabled: boolean,
): string[] {
  const { db } = deps;
  if (enabled) {
    if (machineRow.capabilities?.ownComputerHost !== true)
      throw new HttpError(409, 'this machine cannot let the agent use it; open Cairn on that Mac');
    db.update(machine).set({ ownComputerEnabled: true }).where(eq(machine.id, machineRow.id)).run();
    return [];
  }
  const cancelled = db.transaction(
    (tx) => {
      tx.update(machine)
        .set({ ownComputerEnabled: false })
        .where(eq(machine.id, machineRow.id))
        .run();
      const proposals = tx
        .select()
        .from(actionProposal)
        .where(
          and(
            eq(actionProposal.teamId, machineRow.teamId),
            inArray(actionProposal.actionId, [OWN_COMPUTER_APP_ACTION, OWN_COMPUTER_SHELL_ACTION]),
            inArray(actionProposal.status, ['pending', 'executed']),
          ),
        )
        .all()
        .filter((row) => bindingOf(row).machineId === machineRow.id);
      for (const row of proposals) {
        if (row.status === 'pending') endPendingProposalIn(tx, row, 'superseded');
        else
          tx.update(actionProposal)
            .set({ status: 'superseded' })
            .where(eq(actionProposal.id, row.id))
            .run();
      }
      const open = tx
        .select({ id: computerCall.id })
        .from(computerCall)
        .where(
          and(
            eq(computerCall.machineId, machineRow.id),
            inArray(computerCall.tool, [...OWN_COMPUTER_TOOL_NAMES]),
            inArray(computerCall.state, ['dispatched', 'running']),
          ),
        )
        .all()
        .map((row) => row.id);
      if (open.length > 0)
        tx.update(computerCall)
          .set({ state: 'cancelled' })
          .where(inArray(computerCall.id, open))
          .run();
      return open;
    },
    { behavior: 'immediate' },
  );
  for (const callId of cancelled) deps.machineHub.pushComputerCancel(machineRow.id, callId);
  return cancelled;
}
