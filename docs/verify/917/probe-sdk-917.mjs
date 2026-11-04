#!/usr/bin/env node
// #917 real-artifact evidence probe (claude-code-side mechanism, real SDK/CLI +
// real model, no source inference). Three before/after groups:
//   A. deny path rules block Read under bypassPermissions
//      (A1 before = read succeeds with no rule; A2 after = blocked with the
//      Read(//dir/**) rule in place)
//   B. whitelist enforcement on the native Skill tool face (B1 = native listing
//      measured baseline; B3 before = an unauthorized skill can be loaded by
//      the Skill tool with no rule; B4 = does a Read deny alone block Skill
//      content loading; B5 after = Read deny + Skill(name) deny must refuse)
//   C. the new option set (settingSources explicitly including 'project') does
//      not break the CLAUDE.md brief channel (C1 = the codeword from the
//      worktree CLAUDE.md is echoed back by the model)
// Run: from the repo root `node docs/verify/917/probe-sdk-917.mjs`
// Prereq: a local claude login (or ANTHROPIC_API_KEY); model defaults to
//         glm-5.3, PROBE_MODEL overrides. Output = probe-results.json here.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sdk = await import(
  new URL(
    '../../../apps/daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
    import.meta.url,
  ).href
);

const SECRET_MARKER = 'SECRET-MARKER-917';
const BRIEF_MARKER = 'BRIEF-MARKER-917';
const SKILL_CONTENT_MARKER = 'SKILL-CONTENT-MARKER-917';
// Same value as the daemon's CLAUDE_SETTING_SOURCES (spec 14, scope 1 after the ruling).
const SETTING_SOURCES = ['user', 'project', 'local'];
const MODEL = process.env.PROBE_MODEL || 'glm-5.3';

/** Same shape as claude-code.ts buildSkillDenyRules: `Read(/<absolute path>/**)`. */
function denyRule(baseDir) {
  const escaped = baseDir.replaceAll(/([\\*?[\]])/g, '\\$1');
  return `Read(/${escaped}/**)`;
}

async function runOnce(label, options, prompt, timeoutMs = 150_000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const out = { label, model: MODEL, init: null, result: null, is_error: null, error: null };
  try {
    const q = sdk.query({ prompt, options: { ...options, abortController: abort } });
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        out.init = {
          permissionMode: msg.permissionMode,
          claude_code_version: msg.claude_code_version,
          model: msg.model,
          tools: msg.tools,
          tool_skill_present: (msg.tools ?? []).includes('Skill'),
          skills: msg.skills,
          skills_count: (msg.skills ?? []).length,
          slash_commands_count: (msg.slash_commands ?? []).length,
        };
      }
      if (msg.type === 'result') {
        out.result = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
        out.is_error = msg.is_error ?? false;
        out.permission_denials = msg.permission_denials ?? null;
      }
    }
  } catch (err) {
    out.error = String((err && err.message) ?? err);
  } finally {
    clearTimeout(timer);
    try {
      abort.abort();
    } catch {}
  }
  return out;
}

/** The relay channel has a history of intermittent failures: up to 3 attempts per group, all archived. */
async function runProbe(label, options, prompt) {
  const attempts = [];
  for (let i = 0; i < 3; i++) {
    const attempt = await runOnce(`${label}#try${i + 1}`, options, prompt);
    attempts.push(attempt);
    if (attempt.error === null && attempt.result !== null) return { label, attempts };
  }
  return { label, attempts };
}

const root = mkdtempSync(join(tmpdir(), 'pac-917-probe-'));
const evidence = { generated_at: new Date().toISOString(), sdk_model_requested: MODEL, probes: {} };

try {
  // —— Ground: work directory (cwd) + the unauthorized "skill" directory (deny target) ——
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  const secretDir = join(root, 'secret-skill');
  mkdirSync(secretDir, { recursive: true });
  const secretFile = join(secretDir, 'SKILL.md');
  writeFileSync(secretFile, `${SECRET_MARKER}\nunauthorized skill body.\n`, 'utf8');

  const base = {
    cwd: work,
    model: MODEL,
    permissionMode: 'bypassPermissions',
    settingSources: [...SETTING_SOURCES],
  };
  const readPrompt = [
    `Use the Read tool to read the file ${secretFile}.`,
    'If the tool returns the file content, reply with exactly the first line of the file.',
    'If the tool call is denied or errors, reply with exactly: DENIED',
  ].join('\n');

  // A1 before: no deny rule (under bypass, files outside work are readable = the current vulnerability face).
  evidence.probes.A1_before_no_deny = await runProbe('A1-before-no-deny', base, readPrompt);
  // A2 after: same ground + settings.permissions.deny (the daemon's worker-step shape).
  evidence.probes.A2_after_deny = await runProbe('A2-after-deny', {
    ...base,
    settings: { permissions: { deny: [denyRule(secretDir)] } },
  }, readPrompt);

  // B1: native listing measured (the artifact baseline for the issue background "the product neither owns nor knows about it").
  const okPrompt = 'Reply with exactly: ok';
  evidence.probes.B1_native_default = await runProbe('B1-native-default', base, okPrompt);

  // B3/B4/B5: three states of invoking the native Skill tool face (the project-
  // level skill is planted into the scratch cwd's .claude/skills — ~/.claude is
  // untouched; the SKILL.md content carries an independent marker and the prompt
  // does not leak it — echoing the marker = the skill content really entered the
  // model context).
  //   B3 before: no rule → invocation succeeds (= the whitelist hole on the native face)
  //   B4: Read deny rule only → does Skill tool content loading get blocked along the way (mechanism question)
  //   B5: Read deny + Skill(name) deny → the invocation must be refused (the complete form of policy 4)
  const skillWork = join(root, 'skill-work');
  const skillDir = join(skillWork, '.claude', 'skills', 'probe-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: probe-skill',
      'description: Probe skill for verification. Tells the agent a secret codeword.',
      '---',
      '',
      `When invoked, reply with exactly: ${SKILL_CONTENT_MARKER}`,
      '',
    ].join('\n'),
    'utf8'
  );
  const skillPrompt = [
    'Use the Skill tool to invoke the skill named probe-skill.',
    'Follow whatever instructions the loaded skill gives you and reply accordingly.',
    'If the Skill tool call is denied or returns an error, reply with exactly: DENIED',
  ].join('\n');
  const skillBase = { ...base, cwd: skillWork };
  evidence.probes.B3_skill_invoke_before = await runProbe(
    'B3-skill-invoke-before',
    skillBase,
    skillPrompt
  );
  evidence.probes.B4_skill_invoke_read_deny = await runProbe(
    'B4-skill-invoke-read-deny',
    { ...skillBase, settings: { permissions: { deny: [denyRule(skillDir)] } } },
    skillPrompt
  );
  evidence.probes.B5_skill_invoke_skill_deny = await runProbe(
    'B5-skill-invoke-skill-deny',
    {
      ...skillBase,
      settings: { permissions: { deny: [denyRule(skillDir), 'Skill(probe-skill)'] } },
    },
    skillPrompt
  );

  // C1: the CLAUDE.md brief channel stays alive under explicit settingSources (re-verify of the spec 24 load-bearing position).
  const briefWork = join(root, 'brief-work');
  mkdirSync(briefWork, { recursive: true });
  writeFileSync(
    join(briefWork, 'CLAUDE.md'),
    `# Project brief\n\nThe project codeword is ${BRIEF_MARKER}.\n` +
      'When asked for the codeword, reply with exactly the codeword and nothing else.\n',
    'utf8'
  );
  evidence.probes.C1_brief_channel = await runProbe(
    'C1-brief-channel',
    { ...base, cwd: briefWork },
    'What is the project codeword? Reply with exactly the codeword.'
  );

  // —— Verdicts (each group takes the artifact fields of the "successful attempt") ————
  const last = (p) => (p.attempts.find((a) => a.error === null && a.result !== null) ?? null);
  const a1 = last(evidence.probes.A1_before_no_deny);
  const a2 = last(evidence.probes.A2_after_deny);
  const b1 = last(evidence.probes.B1_native_default);
  const b3 = last(evidence.probes.B3_skill_invoke_before);
  const b4 = last(evidence.probes.B4_skill_invoke_read_deny);
  const b5 = last(evidence.probes.B5_skill_invoke_skill_deny);
  const c1 = last(evidence.probes.C1_brief_channel);
  const loaded = (r) => !!r && r.result.includes(SKILL_CONTENT_MARKER);
  const refused = (r) => !!r && !r.result.includes(SKILL_CONTENT_MARKER);
  evidence.verdicts = {
    A_before_read_succeeds: a1 ? a1.result.includes(SECRET_MARKER) && !/DENIED/.test(a1.result) : false,
    A_after_read_denied: a2 ? /DENIED/.test(a2.result) && !a2.result.includes(SECRET_MARKER) : false,
    A_permission_mode_is_bypass: a1?.init?.permissionMode === 'bypassPermissions' && a2?.init?.permissionMode === 'bypassPermissions',
    B_native_listing_count: b1?.init?.skills_count ?? null,
    B3_skill_invocable_before: loaded(b3),
    B4_read_deny_blocks_skill_load: refused(b4),
    B5_skill_deny_blocks: refused(b5),
    C_brief_channel_alive: c1 ? c1.result.includes(BRIEF_MARKER) : false,
  };
  console.log(JSON.stringify(evidence.verdicts, null, 2));
} finally {
  const out = new URL('./probe-results.json', import.meta.url);
  writeFileSync(out, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(`evidence written: ${out.pathname}`);
  rmSync(root, { recursive: true, force: true });
}
