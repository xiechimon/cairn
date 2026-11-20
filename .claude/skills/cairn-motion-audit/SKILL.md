---
name: cairn-motion-audit
disable-model-invocation: true
description: Manually invoked motion audit for apps/web/src — sweeps motion code for animations to remove or reduce, missing motion worth adding and craft violations, reporting findings keyed to DESIGN.md rule ids. Read-only; run only when a motion audit or motion review is asked for. Building motion goes through cairn-motion.
---

# cairn-motion-audit

The audit is four of Emil Kowalski's skills, vendored verbatim at `emilkowalski/skills@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (MIT, `upstream/LICENSE`), minus their persona openers and with Cairn's values in place of theirs. Each upstream `SKILL.md` is vendored as `README.md`; links inside the vendored files that say `SKILL.md` point at the sibling `README.md`, and `../choreograph/SKILL.md` resolves to `../cairn-motion/references/choreograph/README.md`.

Read the file for the job at hand and follow its workflow:

| Job | File |
|---|---|
| Audit a surface for motion to remove or reduce | `upstream/remove-animations/README.md` — gate, reduction table, hunt list, removal hazards |
| Find where motion is missing | `upstream/find-animation-opportunities/README.md` — the four-question gate, opportunity seams |
| Audit the whole motion surface and write plans | `upstream/improve-animations/README.md` + `AUDIT.md` + `PLAN-TEMPLATE.md` |
| Review a diff's motion before it lands | `upstream/review-animations/README.md` + `STANDARDS.md` |

## Cairn overrides

Where upstream values conflict, Cairn wins:

- **Read-only.** The audit reports; it never edits code, writes plans into `plans/` or removes a dependency. `remove-animations`' Edit step and `improve-animations`' `execute` become verdicts a build lane applies.
- **No persona.** The vendored `Initial Response` sections do not apply; the audit starts at recon.
- **Stance.** Cairn's stone is quiet: motion says where a surface came from or that work continues. A deliberate consistent convention is a preference, not a finding; the same detail done two ways is a finding.
- **Values.** Durations and easings come from the `docs/design/surfaces/motion.md` table and the `--dur-fast` / `--dur-overlay` / `--ease-standard` / `--ease-out-expo` tokens, not upstream's tables. No motion library, no springs, bounce `0`; a press never moves (instant tint). No entry animation on chat messages, list rows or board cards — the `grow-*` rows are the only live-surface choreography. Overlay scale and curve changes pending owner A/B stay out of findings.
- **Where motion lives** for recon: `src/styles/motion.css`, `shadcn.css` tokens, `tw-animate-css` utilities, the `grow-*` utilities, `typing-hop`. ⌘K and menus are high-frequency; Growth rows are live surfaces; first run is rare.
- **Findings map to rule ids.** Every finding names the id it violates in the `## Rules` sections of `apps/web/DESIGN.md` and `docs/design/surfaces/*.md` — usually `V24` (named properties, no bounce, no layout-property motion), `A2` (reduced motion, instant own-action feedback), `C23` (what is shown stays put), `C24` (the user's change lands in the same frame), `A4` (skeleton in final shape), `R1` (both widths and themes) — or `no rule`, a candidate for a new `M` row.

Report in the vendored file's own format (its `Required Output Format` / findings table), adding the `Rule` column above. Every check that could not run is `Not verified`; a claim that needs feel gets a recording step (replay at ~0.1x) instead of a guess.
