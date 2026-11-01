# Link roundup, 2026-11-01

Thirteen links ian shared, all read on 2026-11-01:
- X posts were fetched through agent-reach (`tw.sh`), fxtwitter and jina.
- Videos were read as 4-second frame contact sheets.
- The Ron Minsky talk transcript was pulled in full, but only partly read.
- variant.com/community redirects to a sign-in page for anonymous fetches, so it was read in ian's Chrome.

Labels: **[measured]** = read in the source; **[inferred]** = our reading of what it means for cairn.

## 1. What each link says

| # | Author, date | What it says or shows | Technique or claim |
|---|---|---|---|
| 1 | [poteto](https://x.com/poteto/status/2114626630429913383) (React Compiler team), 2026-10-26 | Summary of Ron Minsky's (Jane Street) "Building reliable software" talk at the Antithesis Bug Bash: types are the best feedback for agents; property tests, fuzzing and deterministic simulation; expect tests (snapshot the printed behaviour) shrink the review surface; agents make formal methods worth it. The talk also says agents are bad at keeping a codebase's quality, so review matters more. [measured] | Expect and fixture tests; global rules enforced by types |
| 2 | [Katelyn Lesse](https://x.com/katelyn_lesse/status/2114542280535318557) (Anthropic platform lead), 2026-10-26 | Long post on four new engineering problems in multi-agent systems [measured]: (1) Kubernetes does not fit stateful, single-instance, long-idle agents; (2) agent identity and authorization when acting for a person; (3) isolation, since injected instructions can travel to other agents through memory; (4) observability: cross-agent OTel traces that agents cannot edit, plus a kill switch that stops the whole system and revokes credentials. | Strong isolation, immutable traces, kill switch |
| 3 | [Yasir Noori](https://x.com/yasirahmadnoori/status/2114543938795180375) (landing-page designer), 2026-10-26 | Before/after of a Claude-generated sidebar refined by hand in Figma: tree connector lines, one color chip per account, right-aligned counts, collapse chevrons on group headers. [measured] | AI first draft, human taste pass |
| 4 | [Phil Pitus](https://x.com/pitus_/status/2111519352503873866) (design engineer), 2026-10-17 | 30 s video "Generative UI #2: merge conflicts": a PR card in the chat walks through a commit graph, "3 conflicts with main", Resolve, Resolving, Tests/Lint/Types/Preview checks, Ready to merge, Merge, Merged. He calls it "replacing a wall of text with UI". [measured] | PR state card inside the conversation |
| 5 | [Reason Machines](https://x.com/reasonmachines/status/2115085216834585041) (YC), 2026-10-27 | Launch of Reason: lets Grok Bot, Muse, Claude Code and Codex talk to each other, brings teammates in, and stops active agents from colliding. Free trial, zero data retention. [measured] | Cross-vendor agent interop |
| 6 | [reasonmachines.com](https://reasonmachines.com/) | Named sub-agents (Miso, Juniper, Pixel) fix a bug with a replay video in the chat; the PR shows "8 checks passed" and merges. `/network`: one command joins a machine, and agents get four tools: `list_team`, `send_message`, `check_inbox`, `ask_user`. Peer-to-peer, end-to-end encrypted; the message engine is MIT/Apache open source. [measured] | A four-tool P2P message bus between agents |
| 7 | [jacob](https://x.com/jsnnsa/status/2115623382721126826) (Spawn founder), 2026-10-29 | A 10-person team claims 77k merged changes in 30 days at $3.1M/month in tokens: resident named agents with memory own areas of the company; no PRs; full tests every 15 min; ship every hour, with a missed hour treated as SEV-0; 0.9 % rollbacks. Only irreversible actions such as payments go through "dumb hard-coded gates". Two years of call notes became "taste principles" for an AI judge: in 8 days it ruled on 11k questions (7,296 decided, 2,213 sent back, 1,863 left to people), and he weighed in himself 27 times. All numbers are self-reported and unverified. [measured] | Taste judge, hourly ship, a separate gate for irreversible actions |
| 8 | [chenchengpro](https://x.com/chenchengpro/status/2116158126391259298) (Qoder, author of umi/dva), 2026-10-30 | Screenshot of "How I work with Agents" in a tool called Ikaga. Left: "Needs you", where agent questions are single-choice options with a "(Recommended)" mark plus "answer in my own words". Right: New task (machine, project, engine, account), Drafts, Going on (Running). An Away toggle on top. He says it exists to solve attention: the person only sends tasks and answers questions. [measured] | Inbox-style handoff with recommended options |
| 9 | [poteto](https://x.com/poteto/status/2115880102601101414), 2026-10-29 | The pstack `/statechart` skill is stable. It compiles TLC models through a small IR to mermaid diagrams and pairs with `/create-formal-verification-skill`; the author says this round found 2 real bugs. [measured] | Readable state diagrams from TLA+ models |
| 10 | [variant.com/community](https://variant.com/community) | A feed of generated designs with a "Get endless designs for…" prompt. The tagline means "it shows you instead of you explaining". [measured, via ian's Chrome] | Scroll-to-generate design variants |
| 11 | [kepano](https://x.com/kepano/status/2116561833385709821) (Obsidian), 2026-10-31 | A rewrite of Dieter Rams' ten principles with a reason for each, e.g. "unobtrusive" becomes "cohesive" because a fire extinguisher should stand out. He keeps 3 unchanged: honest, thorough to the last detail, as little design as possible. [measured] | Design principles |
| 12 | [Chris Tate](https://x.com/ctatedev/status/2116323148706771302) (Vercel Labs), 2026-10-31 | agent-desktop, "agent-browser for the whole computer": any coding agent drives macOS, Windows or Linux in the background, with one cursor per agent in parallel. The video uses `agent-desktop snapshot --app Trip -i` to read the accessibility tree, then clicks controls. [measured] | Accessibility-tree desktop automation CLI |
| 13 | [dualface/ste-zh](https://github.com/dualface/ste-zh) (827 stars, created 2026-10-05) | A skill that adapts ASD-STE100 (aviation's Simplified Technical English) into a Chinese reporting spec with 25 rules: conclusion first; 10 fixed status words; "done" is not "verified"; evidence as `path:line`; numbered options with the recommendation first when the user must decide. Active only when invoked. [measured] | Controlled language for agent reports |

## 2. Themes

- **Multi-agent infrastructure and safety:** 2, 5, 6, 7, 12. The shared concerns are agent identity, isolation, interop and a kill switch.
- **How people take in agent output:** 4, 8, 13, and the AI judge in 7. The common thread is to avoid long text and use cards, multiple-choice questions with a recommended answer, and fixed status words.
- **Verification as feedback:** 1, 9. Types, expect tests, and TLA+ made visible.
- **Design taste:** 3, 10, 11.

## 3. What cairn adopts (plan decision D57)

| Adoption | Ticket | Source |
|---|---|---|
| Watchdog gains a kill switch (stop every orb, revoke daemon tokens) and append-only evidence that orb agents cannot edit | #2488 | 2 |
| "Needs you" inbox: numbered decision cards with the recommended option first, plus fixed status words that separate done from verified | #1784 | 8, 13 |
| A PR card in the thread showing the gate verdict bound to its head, so the merge-gate pillar is visible [inferred] | #2512 | 4, 6 |
| Spike: statecharts from the merge-gate and step-claim TLA+ models as PR evidence | #2513 | 9, 1 |

Recorded, not scheduled:
- Spawn's AI taste judge, as a self-evolution candidate. Spawn itself is the counter-example that strengthens cairn's gate: it drops PRs but keeps a dumb gate on irreversible actions [measured, self-reported], and cairn's gate is that boundary for teams without Spawn's token budget [inferred].
- Reason's `list_team`, as a "who is changing what right now" view for #2487 [inferred].
- agent-desktop, as a possible non-browser channel for UI acceptance inside orbs. Untested in nspawn [inferred].

Links 3, 10 and 11 change nothing in the plan. They are taste references for the page rebuild.
