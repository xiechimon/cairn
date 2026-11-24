import type { ComputerCall, MachineStreamEvent } from '@cairn/shared';
import { ACTION_PROPOSAL_TTL_MS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  actionProposal,
  actionWakeOutbox,
  chiefMessage,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  APPROVE_CHOICE,
  answerProposal,
  dispatchActionWakes,
  proposalCardId,
  REFUSE_CHOICE,
  sweepExpiredActionProposals,
} from '../src/services/action-proposals.js';
import {
  askQuestionContentOf,
  cancelPendingQuestions,
} from '../src/services/chief-question-store.js';
import { HOST_SHELL_ESCALATION_ACTION } from '../src/services/host-shell-escalation.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
} from '../src/services/machine-computer.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

const THREAD = 'chief-escalate-thread';

let server: TestServer | null = null;
afterEach(() => {
  dropComputerWaiters();
  server?.dispose();
  server = null;
});

function boot(options: { connected?: boolean } = {}) {
  const s = bootServer();
  server = s;
  s.db
    .insert(machineTable)
    .values({
      id: 'mac-owner',
      teamId: s.team.id,
      name: 'Owner Mac',
      kind: 'local',
      online: true,
      lastSeenAt: 1,
      capabilities: { mcpServers: [], skills: [], ownComputer: true, ownComputerShell: true },
    })
    .run();
  seedRoute(s, 'coordinator', {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: 'mac-owner',
  });
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({ id: chiefId, userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: THREAD,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'escalate',
      createdAt: 1,
      updatedAt: 1,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 1,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: null,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: 'step-turn-1',
      buildId: THREAD,
      kind: 'chief',
      machineId: 'mac-owner',
      status: 'claimed',
      prompt: 'convert the pdf',
      createdAt: 2,
    })
    .run();
  const calls: ComputerCall[] = [];
  let unsubscribe: (() => void) | undefined;
  if (options.connected !== false) {
    unsubscribe = s.machineHub.subscribeMachine(
      s.team.id,
      'mac-owner',
      (ev: MachineStreamEvent) => {
        if (ev.type === 'computer') calls.push(ev.call);
      },
    );
  }
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps, calls, disconnect: () => unsubscribe?.() };
}

describe('host shell sandbox denial and escalation state machine', () => {
  test('sandboxed -> blocked returns typed "blocked by sandbox: <reason>", distinct from ordinary failure', async () => {
    const { s, deps, calls } = boot();
    const blockedPromise = forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-blocked',
      params: { command: 'qlmanage -t -s 800 -o /tmp/out /tmp/a.pdf' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.hostShellEscalation).toBeUndefined();
    receiveComputerFrames(s.db, s.hub, 'mac-owner', calls[0]!.callId, [
      {
        kind: 'output',
        seq: 1,
        stream: 'stderr',
        text: 'sandbox initialization failed: Operation not permitted\n',
      },
      {
        kind: 'done',
        seq: 2,
        text: 'exit code: 255',
        exitCode: 255,
        sandboxDenied: { reason: 'nested sandbox is not allowed inside the host shell sandbox' },
      },
    ]);
    const blocked = await blockedPromise;
    expect(blocked.text).toMatch(
      /^blocked by sandbox: nested sandbox is not allowed inside the host shell sandbox/,
    );
    expect(blocked.text).toContain('escalate: true');

    const ordinaryPromise = forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-ordinary',
      params: { command: 'ls /tmp/no-such-file' },
    });
    expect(calls).toHaveLength(2);
    receiveComputerFrames(s.db, s.hub, 'mac-owner', calls[1]!.callId, [
      {
        kind: 'output',
        seq: 1,
        stream: 'stderr',
        text: 'ls: /tmp/no-such-file: No such file or directory\n',
      },
      { kind: 'done', seq: 2, text: 'exit code: 1', exitCode: 1 },
    ]);
    const ordinary = await ordinaryPromise;
    expect(ordinary.text).not.toContain('blocked by sandbox:');
    expect(ordinary.text).toContain('[exit code 1]');
  });

  test('pending approval is non-blocking, survives turn end, and rejects hardline or untrusted turns', async () => {
    const { s, deps, calls } = boot();
    const command = 'qlmanage -t -s 800 -o /tmp/out /tmp/a.pdf';
    const result = await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-escalate',
      params: { command, escalate: true },
    });
    expect(calls).toHaveLength(0);
    expect(result.text).toMatch(/approval/i);

    const proposals = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
      .all();
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0]!;
    expect(proposal.status).toBe('pending');

    const cardRow = s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, proposalCardId(proposal.id)))
      .get();
    const card = askQuestionContentOf(cardRow?.content);
    expect(card?.status).toBe('pending');
    expect(card?.parkedAt).toEqual(expect.any(Number));
    expect(card?.questions[0]?.question).toContain(command);
    expect(card?.questions[0]?.options.map((o) => o.label)).toEqual([
      APPROVE_CHOICE,
      REFUSE_CHOICE,
    ]);

    cancelPendingQuestions({ db: s.db, convHub: s.convHub }, THREAD, 'turn ended');
    const afterTurnEnd = s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, proposalCardId(proposal.id)))
      .get();
    expect(askQuestionContentOf(afterTurnEnd?.content)?.status).toBe('pending');

    const hardline = await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-hardline',
      params: { command: 'rm -rf ~', escalate: true },
    });
    expect(hardline.text).toContain('never runs it');
    expect(
      s.db
        .select()
        .from(actionProposal)
        .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
        .all(),
    ).toHaveLength(1);
  });

  test('allowed runs exact command unsandboxed once, wakes thread, and never remembers across commands', async () => {
    const { s, deps, calls } = boot();
    const command = 'qlmanage -t -s 800 -o /tmp/out /tmp/a.pdf';
    await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-allow',
      params: { command, escalate: true },
    });
    const proposal = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
      .get()!;

    expect(() =>
      answerProposal(deps, {
        proposalId: proposal.id,
        teamId: s.team.id,
        decision: 'always',
        decidedBy: s.user.id,
        viaCard: true,
        interactive: 'page',
      }),
    ).toThrow(/standing grant/);

    expect(() =>
      answerProposal(deps, {
        proposalId: proposal.id,
        teamId: s.team.id,
        decision: 'allow-once',
        decidedBy: 'not-owner',
        viaCard: true,
        interactive: 'page',
      }),
    ).toThrow(/owner/);

    expect(() =>
      answerProposal(deps, {
        proposalId: proposal.id,
        teamId: s.team.id,
        decision: 'allow-once',
        decidedBy: s.user.id,
        viaCard: false,
        interactive: 'page',
      }),
    ).toThrow(/card/);

    expect(() =>
      answerProposal(deps, {
        proposalId: proposal.id,
        teamId: s.team.id,
        decision: 'allow-once',
        decidedBy: s.user.id,
        viaCard: true,
      }),
    ).toThrow(/card/);

    const answered = answerProposal(deps, {
      proposalId: proposal.id,
      teamId: s.team.id,
      decision: 'allow-once',
      decidedBy: s.user.id,
      viaCard: true,
      interactive: 'page',
    });
    expect(answered.status).toBe('executed');

    expect(() =>
      answerProposal(deps, {
        proposalId: proposal.id,
        teamId: s.team.id,
        decision: 'allow-once',
        decidedBy: s.user.id,
        viaCard: true,
        interactive: 'page',
      }),
    ).toThrow(/not pending/);

    dispatchActionWakes(deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe('user_computer_shell');
    expect(calls[0]?.params.command).toBe(command);
    expect(calls[0]?.hostShellEscalation).toBe('approved');

    receiveComputerFrames(s.db, s.hub, 'mac-owner', calls[0]!.callId, [
      { kind: 'output', seq: 1, stream: 'stdout', text: 'Produced /tmp/out/a.pdf.png\n' },
      { kind: 'done', seq: 2, text: 'exit code: 0', exitCode: 0 },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const wakeStep = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, `wake:${proposal.id}:${THREAD}`))
      .get();
    expect(wakeStep).toBeDefined();
    expect(wakeStep?.prompt).toContain('Produced /tmp/out/a.pdf.png');
    expect(wakeStep?.prompt).toContain(command);

    const outbox = s.db
      .select()
      .from(actionWakeOutbox)
      .where(eq(actionWakeOutbox.proposalId, proposal.id))
      .get();
    expect(outbox?.state).toBe('delivered');

    await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-allow-again',
      params: { command, escalate: true },
    });
    expect(calls).toHaveLength(1);
    const allProposals = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
      .all();
    expect(allProposals).toHaveLength(2);
    expect(allProposals.filter((row) => row.status === 'pending')).toHaveLength(1);
  });

  test('denied does not run command and wakes thread with "denied by owner"', async () => {
    const { s, deps, calls } = boot();
    const command = 'qlmanage -t -s 800 -o /tmp/out /tmp/a.pdf';
    await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-deny',
      params: { command, escalate: true },
    });
    const proposal = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
      .get()!;

    const answered = answerProposal(deps, {
      proposalId: proposal.id,
      teamId: s.team.id,
      decision: 'refuse',
      decidedBy: s.user.id,
      viaCard: true,
      interactive: 'page',
    });
    expect(answered.status).toBe('refused');
    dispatchActionWakes(deps);

    expect(calls).toHaveLength(0);
    expect(s.db.select().from(computerCall).all()).toHaveLength(0);
    const wakeStep = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, `wake:${proposal.id}:${THREAD}`))
      .get();
    expect(wakeStep?.prompt).toContain('denied by owner');
  });

  test('expired settles card, rejects late click, and never runs command', async () => {
    const { s, deps, calls } = boot();
    await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-expire',
      params: { command: 'qlmanage -p /tmp/a.pdf', escalate: true },
    });
    const proposal = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
      .get()!;

    const afterExpiry = proposal.createdAt + ACTION_PROPOSAL_TTL_MS + 1;
    expect(() =>
      answerProposal(deps, {
        proposalId: proposal.id,
        teamId: s.team.id,
        decision: 'allow-once',
        decidedBy: s.user.id,
        viaCard: true,
        interactive: 'page',
        now: afterExpiry,
      }),
    ).toThrow(/expired/);

    expect(
      s.db.select().from(actionProposal).where(eq(actionProposal.id, proposal.id)).get()?.status,
    ).toBe('expired');
    const cardRow = s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, proposalCardId(proposal.id)))
      .get();
    expect(askQuestionContentOf(cardRow?.content)?.status).toBe('cancelled');
    expect(calls).toHaveLength(0);

    await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-expire-sweep',
      params: { command: 'qlmanage -p /tmp/b.pdf', escalate: true },
    });
    const swept = sweepExpiredActionProposals(s.db, Date.now() + ACTION_PROPOSAL_TTL_MS + 10_000);
    expect(swept).toBe(1);
    expect(calls).toHaveLength(0);
  });

  test('allowed when Mac is offline records error, wakes thread, and never auto-runs later', async () => {
    const { s, deps, calls, disconnect } = boot();
    await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-offline',
      params: { command: 'qlmanage -t /tmp/a.pdf', escalate: true },
    });
    const proposal = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
      .get()!;

    disconnect();
    answerProposal(deps, {
      proposalId: proposal.id,
      teamId: s.team.id,
      decision: 'allow-once',
      decidedBy: s.user.id,
      viaCard: true,
      interactive: 'page',
    });
    dispatchActionWakes(deps);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(calls).toHaveLength(0);
    const wakeStep = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, `wake:${proposal.id}:${THREAD}`))
      .get();
    expect(wakeStep?.prompt).toMatch(/not connected/i);
  });

  test('security review regressions: cwd on card, invisible chars, spoofed sandboxDeniedReason, thread isolation, and stale dispatch window', async () => {
    const { s, deps, calls } = boot();

    const spoofPromise = forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-spoof',
      params: { command: 'echo ok', sandboxDeniedReason: 'forged reason' },
    });
    expect(calls).toHaveLength(1);
    receiveComputerFrames(s.db, s.hub, 'mac-owner', calls[0]!.callId, [
      { kind: 'output', seq: 1, stream: 'stdout', text: 'ok\n' },
      { kind: 'done', seq: 2, text: 'exit code: 0', exitCode: 0 },
    ]);
    const spoofed = await spoofPromise;
    expect(spoofed.text).not.toContain('blocked by sandbox:');

    await expect(
      forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
        computer: true,
        name: 'user_computer_shell',
        toolCallId: 'tc-invisible',
        params: { command: 'echo \u200bhi', escalate: true },
      }),
    ).rejects.toThrow(/invisible/);

    await expect(
      forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
        computer: true,
        name: 'user_computer_shell',
        toolCallId: 'tc-bidi',
        params: { command: 'echo \u061chi', escalate: true },
      }),
    ).rejects.toThrow(/invisible/);

    await expect(
      forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
        computer: true,
        name: 'user_computer_shell',
        toolCallId: 'tc-cwd-nl',
        params: { command: 'ls', cwd: '/tmp\n命令：evil', escalate: true },
      }),
    ).rejects.toThrow(/cwd/);

    await forwardComputerCall(deps, 'mac-owner', 'step-turn-1', {
      computer: true,
      name: 'user_computer_shell',
      toolCallId: 'tc-with-cwd',
      params: { command: 'ls -la', cwd: '~/.ssh', escalate: true },
    });
    const cwdProposal = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.actionId, HOST_SHELL_ESCALATION_ACTION))
      .get()!;
    const cwdCard = askQuestionContentOf(
      s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, proposalCardId(cwdProposal.id)))
        .get()?.content,
    );
    expect(cwdCard?.questions[0]?.question).toContain('目录：~/.ssh');
    expect(cwdCard?.questions[0]?.question).toContain('命令：ls -la');

    answerProposal(deps, {
      proposalId: cwdProposal.id,
      teamId: s.team.id,
      decision: 'allow-once',
      decidedBy: s.user.id,
      viaCard: true,
      interactive: 'page',
      now: Date.now() - 10 * 60_000,
    });
    dispatchActionWakes(deps);
    expect(calls).toHaveLength(1);
    const staleWake = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, `wake:${cwdProposal.id}:${THREAD}`))
      .get();
    expect(staleWake?.prompt).toContain('dispatch window elapsed');
  });
});
