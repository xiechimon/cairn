import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComputerCall, MachineStreamEvent } from '@cairn/shared';
import {
  ATTACHMENT_MAX_BYTES,
  CORE_COORDINATOR_TOOLS,
  OWN_COMPUTER_NO_MAC,
  OWN_COMPUTER_NOT_OWNER,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  attachment as attachmentTable,
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { writeAttachmentFile } from '../src/services/attachments.js';
import {
  COORDINATOR_COMPUTER_TOOL_OFFERS,
  coordinatorToolDefs,
} from '../src/services/coordinator-tool-defs.js';
import {
  forwardComputerCall,
  receiveComputerFrames,
  stageTurnAttachments,
} from '../src/services/machine-computer.js';
import { executeRelayToolCall, isCoordinatorComputerTool } from '../src/services/machine-relay.js';
import { refuseRestrictedTurnTool } from '../src/services/report-turn.js';
import { bootServer, insertMachine, type TestServer } from './helpers.js';

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let server: TestServer | null = null;
afterEach(() => {
  server?.dispose();
  server = null;
});

function setup(opts: { online?: boolean; owner?: boolean } = {}) {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  server = s;
  const userId = opts.owner === false ? 'other-user' : s.svc.user.id;
  const macId = insertMachine(s, {
    name: 'owners-mac',
    capabilities: { mcpServers: [], skills: [], ownComputer: true, ownComputerShell: true },
  });
  const plainToken = 'mac-bearer-secret';
  s.db
    .update(machineTable)
    .set({
      kind: 'local',
      tokenHash: createHash('sha256').update(plainToken).digest('hex'),
    })
    .where(eq(machineTable.id, macId))
    .run();
  const calls: ComputerCall[] = [];
  if (opts.online !== false) {
    s.machineHub.subscribeMachine(s.team.id, macId, (ev: MachineStreamEvent) => {
      if (ev.type === 'computer') calls.push(ev.call);
    });
  }
  s.db.insert(chiefTable).values({ id: 'c1', userId, teamId: s.team.id, createdAt: 1 }).run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: 'chief-t1',
      chiefId: 'c1',
      userId,
      teamId: s.team.id,
      title: 'inline files',
      createdAt: 2,
      updatedAt: 2,
      sessionId: '',
      sessionOpenedAt: 2,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: 's1',
      buildId: 'chief-t1',
      kind: 'chief',
      status: 'claimed',
      machineId: null,
      ownerMessageIds: ['m1'],
      prompt: 'export resume.pdf to png',
      claimedAt: 3,
      createdAt: 3,
    })
    .run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  const stepRow = s.db.select().from(stepTable).where(eq(stepTable.id, 's1')).get()!;
  const threadRow = s.db
    .select()
    .from(chiefThreadTable)
    .where(eq(chiefThreadTable.id, 'chief-t1'))
    .get()!;
  return { s, deps, macId, calls, plainToken, stepRow, threadRow };
}

function seedPdfAttachment(s: TestServer, id = 'att-pdf-1', fileName = 'resume.pdf') {
  const key = `${s.team.id}/${id}.pdf`;
  writeAttachmentFile(s.attachmentsDir, key, PDF_BYTES);
  s.db
    .insert(attachmentTable)
    .values({
      id,
      teamId: s.team.id,
      createdBy: s.svc.user.id,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: PDF_BYTES.length,
      storageKey: key,
      grantId: 'g1',
      scope: 'message',
      status: 'ready',
      createdAt: 1,
    })
    .run();
  return key;
}

describe('Coordinator attach_file and upload staging contract', () => {
  test('attach_file is offered under the same condition as user_computer_shell and routed as a computer tool', () => {
    expect(COORDINATOR_COMPUTER_TOOL_OFFERS.attach_file).toEqual({
      offered: 'when_owner_thread_and_team_has_mac',
    });
    expect('withheld' in COORDINATOR_COMPUTER_TOOL_OFFERS.stage_attachment).toBe(true);
    expect(coordinatorToolDefs({ ownComputer: true }).map((d) => d.name)).toContain('attach_file');
    expect(coordinatorToolDefs({ ownComputer: false }).map((d) => d.name)).not.toContain(
      'attach_file',
    );
    expect(isCoordinatorComputerTool('attach_file')).toBe(true);
    expect(isCoordinatorComputerTool('stage_attachment')).toBe(false);
  });

  test('attach_file refuses cleanly when Mac is offline, thread is non-owner, or turn is untrusted mail', async () => {
    const offline = setup({ online: false });
    const offlineText = await executeRelayToolCall(
      offline.deps,
      null,
      's1',
      'attach_file',
      { path: '/tmp/out.png' },
      'call-offline',
    );
    expect(offlineText).toBe(OWN_COMPUTER_NO_MAC);
    offline.s.dispose();
    server = null;

    const nonOwner = setup({ online: true, owner: false });
    const nonOwnerText = await executeRelayToolCall(
      nonOwner.deps,
      null,
      's1',
      'attach_file',
      { path: '/tmp/out.png' },
      'call-non-owner',
    );
    expect(nonOwnerText).toBe(OWN_COMPUTER_NOT_OWNER);
    expect(nonOwner.calls).toEqual([]);

    expect(() =>
      refuseRestrictedTurnTool(nonOwner.s.db, '[wake:wake] provenance=mail:m1\nhi', 'attach_file'),
    ).toThrow(/mail turn cannot call attach_file/);
  });

  test('attach_file dispatches to Mac, uploads via computer attachment route, stores attachment and appends token to reply', async () => {
    const { s, deps, macId, calls, plainToken } = setup();

    const pending = forwardComputerCall(deps, null, 's1', {
      computer: true,
      name: 'attach_file',
      toolCallId: 'attach-1',
      params: { path: '/tmp/resume-page-1.png', caption: 'Page 1' },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.tool).toBe('attach_file');
    expect(call.params).toEqual({ path: '/tmp/resume-page-1.png', caption: 'Page 1' });
    expect(call.computerGrant).toBeUndefined();

    const uploadRes = await s.app.request(`/api/machine/computer/${call.callId}/attachment`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${plainToken}`,
        'content-type': 'application/octet-stream',
        'x-cairn-filename': encodeURIComponent('resume-page-1.png'),
        'x-cairn-caption': encodeURIComponent('Page 1'),
      },
      body: PNG_BYTES,
    });
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as {
      id: string;
      key: string;
      token: string;
      sha256: string;
    };
    expect(uploaded.token).toBe(`![Page 1](attachment:${uploaded.key})`);

    receiveComputerFrames(s.db, s.svc.hub, macId, call.callId, [
      { kind: 'done', seq: 1, text: JSON.stringify(uploaded) },
    ]);

    const result = await pending;
    expect(JSON.parse(result.text)).toMatchObject({ id: uploaded.id, key: uploaded.key });

    const row = s.db
      .select()
      .from(attachmentTable)
      .where(eq(attachmentTable.id, uploaded.id))
      .get();
    expect(row).toMatchObject({
      teamId: s.team.id,
      fileName: 'resume-page-1.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      scope: 'message',
      status: 'ready',
    });
    expect(existsSync(join(s.attachmentsDir, uploaded.key))).toBe(true);
    expect(readFileSync(join(s.attachmentsDir, uploaded.key))).toEqual(PNG_BYTES);

    const msg = s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.id, 'attachment-output-s1'))
      .get();
    expect(msg?.role).toBe('assistant');
    expect(msg?.content).toBe(uploaded.token);

    const pending2 = forwardComputerCall(deps, null, 's1', {
      computer: true,
      name: 'attach_file',
      toolCallId: 'attach-2',
      params: { path: '/tmp/resume-page-2.png' },
    });
    await new Promise((r) => setTimeout(r, 20));
    const call2 = calls[1]!;
    const uploadRes2 = await s.app.request(`/api/machine/computer/${call2.callId}/attachment`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${plainToken}`,
        'content-type': 'application/octet-stream',
        'x-cairn-filename': encodeURIComponent('resume-page-2.png'),
      },
      body: PNG_BYTES,
    });
    expect(uploadRes2.status).toBe(201);
    const uploaded2 = (await uploadRes2.json()) as { token: string };
    receiveComputerFrames(s.db, s.svc.hub, macId, call2.callId, [
      { kind: 'done', seq: 1, text: JSON.stringify(uploaded2) },
    ]);
    await pending2;

    const msgAfter = s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.id, 'attachment-output-s1'))
      .get();
    expect(msgAfter?.content).toBe(`${uploaded.token}\n${uploaded2.token}`);
  });

  test('attach_file upload rejects MIME mismatch and leaves no attachment row', async () => {
    const { s, deps, macId, calls, plainToken } = setup();

    const pending = forwardComputerCall(deps, null, 's1', {
      computer: true,
      name: 'attach_file',
      toolCallId: 'attach-bad',
      params: { path: '/tmp/fake.png' },
    });
    await new Promise((r) => setTimeout(r, 20));
    const call = calls[0]!;
    const badRes = await s.app.request(`/api/machine/computer/${call.callId}/attachment`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${plainToken}`,
        'content-type': 'application/octet-stream',
        'x-cairn-filename': encodeURIComponent('fake.png'),
      },
      body: Buffer.from('not-a-png'),
    });
    expect(badRes.status).toBe(400);
    receiveComputerFrames(s.db, s.svc.hub, macId, call.callId, [
      {
        kind: 'error',
        seq: 1,
        message: 'attach_file content does not match its file extension',
        delivery: 'not_delivered',
      },
    ]);
    const res = await pending;
    expect(res.text).toContain('does not match its file extension');
    expect(s.db.select().from(attachmentTable).all()).toHaveLength(0);
    expect(ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  test('stage_attachment download route serves authorized attachment bytes to the target Mac', async () => {
    const { s, macId, plainToken } = setup();
    seedPdfAttachment(s);

    const callId = 'a'.repeat(64);
    s.db
      .insert(computerCallTable)
      .values({
        id: callId,
        teamId: s.team.id,
        stepId: 's1',
        toolCallId: 'stage-1',
        machineId: macId,
        computerId: null,
        tool: 'stage_attachment',
        replaySafe: true,
        params: { threadId: 'chief-t1', attachmentId: 'att-pdf-1', fileName: 'resume.pdf' },
        state: 'dispatched',
        deadlineAt: Date.now() + 30_000,
        createdAt: 1,
      })
      .run();

    const res = await s.app.request(`/api/machine/computer/${callId}/attachment`, {
      method: 'GET',
      headers: { authorization: `Bearer ${plainToken}` },
    });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF_BYTES);
  });

  test('stageTurnAttachments stages uploaded files onto the Mac and injects their paths', async () => {
    const { s, deps, macId, calls, stepRow, threadRow } = setup();
    const key = seedPdfAttachment(s);
    const prompt = `Export this PDF:\n[resume.pdf](attachment:${key})`;

    const pending = stageTurnAttachments(deps, stepRow, threadRow, prompt);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.tool).toBe('stage_attachment');
    expect(call.params).toEqual({
      threadId: 'chief-t1',
      attachmentId: 'att-pdf-1',
      fileName: 'resume.pdf',
    });

    receiveComputerFrames(s.db, s.svc.hub, macId, call.callId, [
      {
        kind: 'done',
        seq: 1,
        text: JSON.stringify({
          path: '/var/folders/cairn-uploads/chief-t1/att-pdf-1-resume.pdf',
          sizeBytes: PDF_BYTES.length,
        }),
      },
    ]);

    const note = await pending;
    expect(note).toContain('<staged_uploads>');
    expect(note).toContain('/var/folders/cairn-uploads/chief-t1/att-pdf-1-resume.pdf');
    expect(note).toContain('resume.pdf (application/pdf');
  });

  test('stageTurnAttachments reports a plain failure line when the Mac is offline and skips non-owner threads', async () => {
    const offline = setup({ online: false });
    const offlineKey = seedPdfAttachment(offline.s);
    const offlineNote = await stageTurnAttachments(
      offline.deps,
      offline.stepRow,
      offline.threadRow,
      `[resume.pdf](attachment:${offlineKey})`,
    );
    expect(offlineNote).toContain('could not be staged');
    expect(offlineNote).toContain(OWN_COMPUTER_NO_MAC);
    offline.s.dispose();
    server = null;

    const nonOwner = setup({ online: true, owner: false });
    const nonOwnerKey = seedPdfAttachment(nonOwner.s);
    const nonOwnerNote = await stageTurnAttachments(
      nonOwner.deps,
      nonOwner.stepRow,
      nonOwner.threadRow,
      `[resume.pdf](attachment:${nonOwnerKey})`,
    );
    expect(nonOwnerNote).toBeNull();
    expect(nonOwner.calls).toEqual([]);
  });

  test('security guards: untrusted turns skip staging, attachment upload is single-use and deadline-bound, VM shell is refused, and worker attach_file stays intact', async () => {
    const { s, deps, macId, calls, plainToken, stepRow, threadRow } = setup();
    const key = seedPdfAttachment(s);

    const mailNote = await stageTurnAttachments(
      deps,
      stepRow,
      threadRow,
      `[wake:wake] provenance=mail:m1\n![resume.pdf](attachment:${key})`,
    );
    expect(mailNote).toBeNull();
    expect(calls).toEqual([]);

    await expect(
      forwardComputerCall(deps, null, 's1', {
        computer: true,
        name: 'shell',
        toolCallId: 'vm-shell-direct',
        params: { command: 'echo nope' },
      }),
    ).rejects.toMatchObject({ status: 400 });

    const pending = forwardComputerCall(deps, null, 's1', {
      computer: true,
      name: 'attach_file',
      toolCallId: 'attach-single-use',
      params: { path: '/tmp/one.png' },
    });
    await new Promise((r) => setTimeout(r, 20));
    const call = calls[0]!;

    const first = await s.app.request(`/api/machine/computer/${call.callId}/attachment`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${plainToken}`,
        'content-type': 'application/octet-stream',
        'x-cairn-filename': encodeURIComponent('one.png'),
      },
      body: PNG_BYTES,
    });
    expect(first.status).toBe(201);

    const duplicate = await s.app.request(`/api/machine/computer/${call.callId}/attachment`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${plainToken}`,
        'content-type': 'application/octet-stream',
        'x-cairn-filename': encodeURIComponent('two.png'),
      },
      body: PNG_BYTES,
    });
    expect(duplicate.status).toBe(409);

    receiveComputerFrames(s.db, s.svc.hub, macId, call.callId, [
      { kind: 'done', seq: 1, text: JSON.stringify(await first.json()) },
    ]);
    await pending;

    const expiredCallId = 'b'.repeat(64);
    s.db
      .insert(computerCallTable)
      .values({
        id: expiredCallId,
        teamId: s.team.id,
        stepId: 's1',
        toolCallId: 'stage-expired',
        machineId: macId,
        computerId: null,
        tool: 'stage_attachment',
        replaySafe: true,
        params: { threadId: 'chief-t1', attachmentId: 'att-pdf-1', fileName: 'resume.pdf' },
        state: 'dispatched',
        deadlineAt: Date.now() - 1000,
        createdAt: 1,
      })
      .run();
    const expiredRes = await s.app.request(`/api/machine/computer/${expiredCallId}/attachment`, {
      method: 'GET',
      headers: { authorization: `Bearer ${plainToken}` },
    });
    expect(expiredRes.status).toBe(409);
  });

  test('skills tool is core-loaded and lets the Coordinator read SKILL.md and reference files safely', async () => {
    const { s, deps } = setup();
    const skillDir = join(s.skillsDir, 'great-resume');
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: great-resume\ndescription: Resume rewrite guide\n---\n\n# Great Resume\nFollow the ledger.\n',
    );
    writeFileSync(
      join(skillDir, 'references', 'claim-evidence-ledger.md'),
      '# Claim Evidence Ledger\nKeep facts real.\n',
    );
    writeFileSync(join(s.skillsDir, 'outside.txt'), 'secret-outside');

    expect(CORE_COORDINATOR_TOOLS.has('skills')).toBe(true);

    const listed = JSON.parse(
      await executeRelayToolCall(deps, null, 's1', 'skills', {}, 'call-skills-list'),
    ) as { id: string; name: string; description: string | null }[];
    expect(listed).toEqual([
      { id: 'great-resume', name: 'great-resume', description: 'Resume rewrite guide' },
    ]);

    const doc = JSON.parse(
      await executeRelayToolCall(
        deps,
        null,
        's1',
        'skills',
        { skillId: 'great-resume' },
        'call-skills-read',
      ),
    ) as {
      id: string;
      name: string;
      description: string | null;
      path: string;
      content: string;
      files: string[];
    };
    expect(doc.id).toBe('great-resume');
    expect(doc.path).toBe('SKILL.md');
    expect(doc.content).toContain('# Great Resume');
    expect([...doc.files].sort()).toEqual(['SKILL.md', 'references/claim-evidence-ledger.md']);

    const ref = JSON.parse(
      await executeRelayToolCall(
        deps,
        null,
        's1',
        'skills',
        { skillId: 'great-resume', path: 'references/claim-evidence-ledger.md' },
        'call-skills-ref',
      ),
    ) as { path: string; content: string };
    expect(ref.path).toBe('references/claim-evidence-ledger.md');
    expect(ref.content).toContain('# Claim Evidence Ledger');

    await expect(
      executeRelayToolCall(
        deps,
        null,
        's1',
        'skills',
        { skillId: 'great-resume', path: '../outside.txt' },
        'call-skills-traversal',
      ),
    ).rejects.toMatchObject({ name: 'NotFoundError' });

    await expect(
      executeRelayToolCall(
        deps,
        null,
        's1',
        'skills',
        { skillId: 'no-such-skill' },
        'call-skills-missing',
      ),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
