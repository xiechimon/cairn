# #917 skill visibility surface recall — verification evidence index

Ticket: #917 (server+daemon: fold the skill visibility surface back to pacman). The canonical copy of the post-ruling scope =
`docs/spec/14-skills-execution-surface-injection.md` §skill-visibility-surface folding (points 1/2 deferred by #958/spec 24;
landed = point 3 explicit settingSources declaration, point 4 hard-block whitelist, point 5 observation lines,
plus the shutoff of pi's native `<available_skills>` section folded back by #958).

Mechanism-class claims all take runtime ground truth (the repo rule "mechanism-effect acceptance: artifact criteria"). This directory has two artifact groups:

## 1. Real SDK/CLI probe (claude-code-side mechanism)

- `probe-sdk-917.mjs` — the probe script. Real `@anthropic-ai/claude-agent-sdk@0.3.278`
  (bundled CLI 2.1.278) + a real model (glm-5.3, through the local claude login). Reproduce:
  from the repo root `node docs/verify/917/probe-sdk-917.mjs` (each query gets up to 3 attempts,
  all archived into the result JSON).
- `probe-results.json` — the final run (six arms A1/A2, B1, B3/B4/B5, C1). Verdict summary:

  | arm | claim | artifact result |
  |---|---|---|
  | A1 before | under bypassPermissions with no deny rule, reading a file outside the worktree succeeds | ✅ read `SECRET-MARKER-917` (= the vulnerability face exists) |
  | A2 after | the `Read(//<dir>/**)` deny rule blocks Read under bypassPermissions | ✅ replied `DENIED`, marker absent |
  | A attached | both sides' `init.permissionMode` are `bypassPermissions` | ✅ (bypass is really in effect, not a false positive of falling back to default) |
  | B1 | native skill listing measured (the baseline the product neither owns nor knows about) | 122 entries |
  | B3 before | with no rule an unauthorized skill can be loaded by the Skill tool | ✅ the skill content marker was echoed (= the native-face invocation hole exists) |
  | B4 | a Read deny alone does **not** block the Skill tool's content loading along the way | ✅ the marker was still echoed (Read deny does not cover Skill loading → the Skill-name deny must be an independent rule) |
  | B5 after | `Skill(<name>)` deny refuses the invocation under bypassPermissions | ✅ replied `DENIED`, and `result.permission_denials` landed `{tool_name:"Skill", tool_input:{skill:"probe-skill"}}` |
  | C1 | the CLAUDE.md brief channel stays alive under explicit `settingSources: ['user','project','local']` | ✅ the codeword was echoed (re-verify of the spec 24 load-bearing position) |

- `probe-results-run1-skills-option-inert.json` — the first-round run, containing one **negative
  finding**: the SDK `skills: [<name>]` option (the d.ts claims "unlisted skills are hidden
  from the model's listing and rejected by the Skill tool") in reality is only translated by
  the SDK into a `Skill(<name>)` **allow** rule — an allow rule has no effect under
  bypassPermissions, and the native listing count did not move at all (`init.skills` still
  122 entries after passing `skills:['agent-reach']`).
  On this basis the option was abandoned, and the hard block moved to deny rules — three per
  skill (Read path + exact Skill name + any Skill(skill:) name shape). This JSON is the
  archive basis for "the claim does not match the implementation".

## 2. Integration tests before/after (pi side + observation row)

harness = `integration/test/skills-inject-e2e.test.ts` (real daemon + real server +
stub LLM; the worker-step whitelist = `['demo-skill']`, an unauthorized `extra-skill`
sits in the same directory, and the pi agentDir/skills is planted with the native skill
`native-dup`).

- `before-deny-integration-red.txt` — the pre-implementation red run: reading the unauthorized
  `extra-skill/SKILL.md` **succeeded** (tool result `isError:false`, the body
  `EXTRA-BODY-MARKER-917` landed in the DB) = the artifact of the hole policy 4 must plug.
- `before-noskills-integration-red.txt` — the red run with only `noSkills` flipped back to false:
  the pi native `<available_skills>` section (`PI-NATIVE-DUP-MARKER-917`) appears on the LLM input
  face (the AssertionError verbatim is in the file) = the #958 wiring record "two listings coexist"
  reproduced in this harness, proving the after-side assertions are not spinning idle. The dump
  also nailed the native discovery's actual scope: pi picks up this machine's entire
  `~/.agents/skills` pool through the `~/.pi` default directory — that worker session's native
  section contained **106** skills (every entry outside the whitelist included), all unconstrained
  by `agent.skills`. The file contains the referenced third-party skill descriptions verbatim
  (captured verbatim at runtime, not sanitized, to keep the evidence faithful).
- `after-integration-green.txt` — the post-implementation green run: both directions evidenced in
  a single run — the authorized SKILL.md body marker lands in the DB, the unauthorized read is
  refused (the refusal copy lands in the DB, the body marker does not); the daemon.log canon lines
  `catalog: entries=1 chars=618` / `deny: 1 skill dir(s) hard-blocked` / `denied-read: …(skill
  extra-skill not in allowlist)`; the native-section marker is absent from the LLM input face.

## Version compatibility

This ticket has zero wire/schema changes (`SessionOpts.skillsAllowlist` / `teamSkillsDir` /
the machine skills endpoints are all existing faces): new daemon × old server and old daemon ×
new server are constructively compatible. Criterion = the shared snapshot face untouched + the
full unit suite (193 files / 2113 cases) and the full integration suite (21 files / 60 cases)
green.
