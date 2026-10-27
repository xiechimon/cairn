# Amp: the native-machine execution model, sandbox design, and Orbs

Research date: 2026-10-02. Subject: Amp (Amp Code Inc., a coding agent originally incubated at Sourcegraph, ampcode.com). It answers three questions: how Amp treats "an agent running on a real machine" (is there a local sandbox, what provides the safety net), the design philosophy behind those choices, and what "ORB" actually means. Every conclusion is pinned to a first-hand source; the source list is at the end. Secondhand and unverified items are marked separately.

## TL;DR

1. **No OS-level sandbox locally, and not even approval by default.** The Amp CLI executes tools and shell commands directly on the user's real machine; the official docs state verbatim "By default, Amp does not ask for approval before running tools". The safety net rests on three things: an optional permission-rule system (allow/ask/reject/delegate, pluggable into external policy programs up to OPA), automatic secret redaction, and the explicit official advice "if you regularly work with untrusted sources, use an isolated development environment" — isolation is treated as the user's environment responsibility or as Amp's own cloud product, not as a property of the local process.
2. **The design philosophy is "feedback first, reversible actions gate-free, errors expected"**: restricting tools forces the agent to detour (block Read and it will `cat`); Git makes the cost of a wrong edit approach zero, so gating reversible actions is not worth it; what really needs gates are irreversible actions (deployments, touching production databases). One level up sits the "follow the frontier" product philosophy: models no longer need editor handrails, and agents want to run even when you are not watching — which directly produces Orbs.
3. **ORB = Amp's product concept "Orbs"**: each thread gets a one-off remote sandbox machine (a Debian 12 VM, compute provided by e2b, six size tiers, per-minute billing, free pause when idle, snapshots for cold-start acceleration). It is not OrbStack and has nothing to do with local container tooling. The official positioning line is literally "machine as sandbox": "People hear the term 'sandbox' and think we're talking about child's play. But Orbs range from tiny to extra extra large."

## 0. Background: Amp's two components and three execution surfaces

The security reference page splits the system into two components (official claim, ampcode.com/security):

- **Amp Client**: the end-user application, primarily the Amp CLI. Responsible for local code and context management, local settings, local thread history; executes tools locally at the Amp Server's request.
- **Amp Server**: the multi-tenant cloud service on ampcode.com (GCP). Responsible for authentication, workspaces, thread sync and storage, usage billing; LLM inference is authorized by the server and issued request-scoped credentials. Amp offers no self-hosted deployment (BYOK is available).

The agent's "body" can land on three execution surfaces (docs/cli "Choose Where the Thread Runs", `amp --executor local|orb|runner:<id>`):

| Execution surface | Whose machine | Isolation form |
|---|---|---|
| local | your native machine | no OS sandbox, permission rules + optional approval |
| orb | Amp cloud (e2b) | one dedicated VM per thread |
| runner | another of your native machines (resident `amp --no-tui`) | same as local; the machine itself is the boundary |

## 1. The real mechanism of "native machine as sandbox"

The "use the native machine as a sandbox" in the user's question needs a two-part answer, because Amp's official narrative is exactly the opposite: **on a native machine it does no sandboxing; the sandbox is another machine it sells you (the orb)**; but a native machine can be treated as a remote execution surface (runner), and on that point "the machine is the boundary" holds.

### 1.1 The local execution surface: no kernel isolation, no approval by default

Two verbatim passages from the docs/tools page (official claim, accessed 2026-10-02):

> By default, Amp does not ask for approval before running tools.

> Amp acts on content in your workspace. Untrusted repositories, MCP servers, and other external inputs can influence what Amp does. If you regularly work with untrusted sources, consider creating a custom policy plugin, or using an isolated development environment.

In other words: local execution = the agent reads/writes files and executes shells with your user permissions; against prompt-injection and untrusted-repository risks, the official exits are "wrap it in your own isolated development environment" or "write a policy plugin". Across the entire official documentation (docs, 153 news slugs, the security page) there is no mention of sandbox-exec / Seatbelt / bubblewrap / Landlock or any other OS-level local sandbox mechanism (searched 2026-10-02; "not mentioned" ≠ "does not exist in closed source", but the official side has never claimed it).

For contrast (per the wiki: ```[[Agent 沙箱与快照加速]]```): Codex takes the other road — Bubblewrap namespaces with no network + read-only mounts + syscall filtering on Linux, `sandbox-exec` loading Seatbelt rules on macOS, writes confined to the project directory. Amp explicitly did not choose that road.

Third-party corroboration (e2b official docs, e2b.dev/docs/agents/amp): e2b provides a sandbox template with Amp preinstalled, recommends `amp --dangerously-allow-all -x "..."`, and explains "Auto-approving tool calls is contained by the sandbox: the agent cannot touch your host machine, local files, or credentials" — i.e. **Amp's own full-auto mode depends on external sandbox containerization; the isolation comes from e2b, not Amp**. This corroborates the official line in 1.1.

### 1.2 The permission-rule system: the real owner of local safety

news/tool-level-permissions (2025-08-07) and notes/permissions (How We Think about Permissions) give the complete model (official claim):

- Before each tool call, Amp matches the `amp.permissions` rule list in order; a hit executes the action: **allow / ask / reject / delegate**; if nothing matches, it falls back to the "built-in default permission list (sensible defaults)" (the exact contents of the built-in list were not obtained; the manual page requires JS rendering — see the "unverified" section).
- Rules can match any tool (including the `mcp__*` wildcard) and its arguments, with wildcard argument values: `{ "tool": "Bash", "matches": { "cmd": "*git*push*" }, "action": "ask" }`.
- **delegate**: hands the decision to an external program on `$PATH`; stdin receives the JSON tool arguments, exit 0=allow, 1=ask, 2=reject (stderr is passed back to the model). Two advanced official examples: a bash helper (reject `git push` with unstaged changes); and forwarding the decision to an **Open Policy Agent** server for centralized policy management.
- The CLI has companion commands: `amp permissions edit/add/test`, `amp tools list/show` (inspect MCP tool argument schemas before writing rules).

### 1.3 Other local protections: secret redaction

news/secret-redaction (2025-05-30): Amp automatically identifies secrets and replaces them with markers like `[REDACTED:aws-access-key-id]` so they never enter the LLM context, other tools, or ampcode.com. The security page lists this as a defense-in-depth layer against prompt injection (same layers: use only the latest frontier models, web search goes through Parallel's injection defenses, thread audit trails, enterprise data-management APIs, minimal data retention).

### 1.4 Runners: turning your native machine into a remote execution surface

docs/cli/runners (official claim): `amp --no-tui --runner-id <id>` registers any machine that can run `amp` as a runner, and threads are dispatched to it remotely from ampcode.com — the official example is literally named `grandmas-garage-server`. Key points:

- One runner can serve multiple directories (repeat `--dir`, `--discover-dirs` auto-scans Git checkouts and worktrees, depth/exclusion patterns configurable, filesystem watchers add/remove entries in real time on macOS/Linux).
- `--desktop` gives runner threads a graphical desktop: **on macOS it directly captures and controls that Mac's real screen** (install `Amp Desktop Helper.app`, requires Screen Recording + Accessibility permissions); **on Linux it starts a headless 1280x720 labwc compositor + Waymote streaming** (noted officially as "the same stack that orb desktops use"), without touching your own session.
- A runner has no additional isolation — it is the native machine itself. The evolution line on the news side (slug chronology): `agents-anywhere` → `the-mac-app-is-your-runner` → `one-runner-many-worktrees` → `one-runner-is-now-enough` → `shared-runners`, a direction of making "your own machine" dispatchable compute on par with orbs.

### 1.5 Orbs: the real sandbox is "the whole machine"

When Amp wants to run "unsupervised", it does not lock down the local machine; it moves the whole execution surface to the cloud: **each orb thread gets a brand-new, isolated remote machine**, preloaded with your code, plugins, and dev tools (docs/orbs). Mechanism details are in Section 3. Verbatim from docs/orbs: "The agent has a whole machine to itself, so it can install dependencies, run your app, spawn browsers, and test its work end to end."

## 2. Design philosophy

### 2.1 Permission philosophy: feedback first, reversible gate-free, errors expected

notes/permissions (How We Think about Permissions; the page carries no author byline) is the first-hand argument for the local model, in three points (official claim; quotations are verbatim):

1. **Feedback first**: "agents work best when they can get feedback about the changes they are making". Models, like humans, converge by iterating on compiler errors, test failures, and red squiggles; "Taking tools away, like preventing the agent from reading certain files, makes the agent look for an alternative, like running a Bash command instead" — restriction does not remove capability, it only creates detours.
2. **Reversible actions do not deserve gates**: "Most people do not worry about file edits anymore, because Git makes the cost of a wrong edit negligible. Restrictions aren't necessary for tools like this with an easy undo action." A commit can be dropped/amended, a database incident is compressed near zero by backups — gates belong only at genuinely irreversible points (triggering deployments, accessing production databases).
3. **An environment that acknowledges errors beats one that tries to eliminate them**: "Errors occur both for models and humans, and building an environment acknowledging this produces better outcomes than trying to prevent all errors in the first place." To the popular story genre "the AI dropped my production database", the official response is: the people telling that story usually had no backups — safety is a property of the environment (version control, backups), not of approval popups.

At the same time the official side acknowledges both operator styles are legitimate (risk-tolerant running many threads unattended all day vs cautious step-by-step review), and the permission system supports both: the example configuration for full-auto mode has only two rules — `ask Bash --cmd '*rm*rf*' ...` plus `allow '*'`, i.e. **allow by default, intercept only command shapes that look like mass deletion**.

### 2.2 Product philosophy: follow the frontier, self-destruct at any time

The manual homepage self-positioning (official claim): "Opinionated: You're always using the good parts of Amp. If we don't use and love a feature, we kill it." "On the Frontier: Amp goes where the models take it. No backward compatibility, no legacy features."

news/the-coding-agent-is-dead (2026-02-19) is the extreme sample of this philosophy: announcing the timed self-destruction of their own VS Code/Cursor extensions, with the rationale "By keeping these new models in an editor sidebar, we restrict them.… They want to write code and run even when you're not sitting in front of your editor." — models no longer need editor handrails, and locking them in a sidebar is holding down the frontier. The CLI is positioned as a "ladder": once you climb to the next level, it may be dropped too. **This explains why a local sandbox is not their priority: their answer is to move the agent off your machine (orbs), not to turn your machine into a prison.**

### 2.3 Orbs philosophy: machines from pets to cattle, friction to zero

- news/agents-in-orbs (2026-06-30): previously, running more agents meant worktrees, SSH into a remote box, and fighting for local resources; the orb turns that into a one-click spawn "in the same interface, right next to your local agent, with the same controls", and so "you tend to do it a lot more" — a bug report directly becomes an agent and an investigation instead of a ticket.
- what-are-orbs: "Orbs are infinite. You can spawn as many as you want without running into any resource issues. No port conflicts, no disk space shortage, no memory pressure." And it names the paradigm shift: "instead of treating machines on which your agents run as pets… you just stop thinking of the machine altogether. You go from 'is this worktree dirty?' to 'what do I want to get done?'" — **the machine itself disappears from the mental model, leaving only the task**. This is exactly the antithesis of "native machine as sandbox": the sandbox should not be the machine you maintain, but a disposable, infinitely supplied, one-off machine.
- notes/what-i-want-to-tell-you-about-orbs (Thorsten Ball, 2026-08-04): the second-order change from zero friction is that agents run much longer — "wait, it's in an orb, I don't give a damn how long this runs". The workflow becomes asking the agent for proof: "I want you to give me 100% proof that what you did works. Test this end to end.… Show me a screenshot, a video, anything that's solid proof!" Agents really do self-verify for 8–30 minutes, and the review burden shifts from "read an 800-line diff" to "look at a stack of evidence". The first item on his orb ingredient list is "secure sandbox", followed by scale to zero, ephemeral, durable agent loop, control from multiple surfaces, portals, multiplayer, automations.
- notes/orbs-explained (Thorsten Ball, 2026-08-25) answers the naming controversy: "Yes, they are VMs, or sandboxes, or whatever you want to call them. Remote machines that we spin up for you, put your code into, and start the Amp agent on." The reason they are not called remote agents / cloud agents is that the product surface wrapped around the machine — portals, shareable thread URLs, multiplayer, scheduled wake-ups, agent-spawns-agent — makes it "a whole thing more than a VM".

### 2.4 The balance point between safety and capability

Putting the three layers together, Amp's trade-off is clear (a synthesis across official pages, not a single-page quotation):

- **Capability side**: zero local isolation, zero approval by default, keeping the feedback loop intact (running tests, installing dependencies, starting services all at full strength);
- **Responsibility side**: reversible actions are covered by Git; irreversible actions are covered by user-configured rules/approval/delegate policies (enterprises can put OPA in front for centralized management); secrets are cut off at the source by redaction;
- **Isolation side**: when real isolation is needed (untrusted inputs, unsupervised runs, large-scale parallelism), the local machine is not retrofitted — the whole surface switches to an orb. Isolation is sold as a product rather than imposed as a restriction. The security page's general line on prompt injection is defense in depth: "no single control is perfect, so we layer multiple mechanisms to reduce likelihood, blast radius, and detection time."

## 3. What ORB is

### 3.1 The verdict

**In the Amp context, ORB/Orb = the one-off remote sandbox machine Amp creates for each thread**, a first-class product concept (its own docs area docs/orbs, its own marketing page what-are-orbs, its own naming culture "it's orbin' time"). The security reference defines it: "An orb is a sandboxed cloud machine that runs the agent for a thread."

### 3.2 Mechanism facts (all official claims; sources at the end)

- **Compute substrate**: e2b. "e2b provides ephemeral compute instances for Amp orbs" (infrastructure list on the security page). e2b's own definition of its sandbox: "A fast, secure Linux VM created on demand… which you can pause and resume as needed" (e2b.dev/docs).
- **OS and environment**: Debian 12, with `amp` preinstalled (already authenticated after activation), `gh`, Git/SSH/tmux, Bun/Node/npm/pnpm/Yarn, Python/pip/uv, `agent-browser`, ffmpeg/ImageMagick/jq/fzf/ripgrep, etc.; Docker is not installed by default but can be installed in a setup script and run as a managed service (docs/orbs/customizing).
- **Sizes and billing**: six size tiers, from a1.tiny (1 CPU/2GB/60GB, $0.08/h) to a1.3xlarge (16 CPU/44GB/60GB, $2.13/h), per-minute billing; the agent auto-pauses after a few idle minutes, pausing is free, it can sleep for weeks, and the next message wakes it (conversation, files, and services resume in place) (what-are-orbs, docs/orbs).
- **Cold-start acceleration: snapshots**. Each project×size keeps one prepared orb snapshot (including the repo clone + setup-script artifacts), reused for at most 72 hours before a forced rebuild; the lifecycle is driven by two executables in the repository: `.agents/setup` (provisioning, 20-minute timeout, must be idempotent, must kill every leftover process on exit) and `.agents/resume` (an auth/repair hook running within 10 seconds of every wake-up); plus pre-clone/pre-setup scripts in the project settings (docs/orbs/customizing).
- **Machine-surface products**: the Terminal panel (shares the same tmux session and filesystem with the agent), the Files panel with 512MB uploads, diff review, Portals (any HTTP service listening on a port gets a shareable public URL), multiplayer (multiple people share one orb thread), Automations (scheduled wake-ups), Webhooks (CI/GitHub/Linear events directly spawn orb threads), Agent-to-Agent (agents configure software inside orbs, spawn other agents in new orbs, and exchange messages and files) (what-are-orbs, docs/orbs).
- **Local integration**: `amp sync <thread>` mirrors the orb's changes back to the local checkout; `amp -ox "..."` in the CLI starts an execute-mode thread directly in an orb; the TUI command palette has `thread: new in orb` (docs/orbs, news/agents-in-orbs).
- **Security and credentials**: the orb filesystem and snapshots are encrypted at rest (AES-256 volume-level); the orb lifecycle is bound to the thread — deleting the thread deletes the orb in seconds; the preferred secret management is **OIDC workload identity** (issuer `https://ampcode.com/api/workload-identity`, granting project-level/thread-level short-lived credentials at the setup/resume stages respectively, avoiding long-lived secrets on disk), with workspace/personal environment variables and the `amp secrets` CLI as fallbacks; secret values in orb shell output are automatically masked (security page, docs/orbs/handling-secrets).
- **Quota**: a burst allowance of 20 metered orbs per user, then one new orb admitted every 5 minutes (queuing, not failure); enterprises can raise the limit (docs/orbs).

### 3.3 Candidate exclusions

- **OrbStack (macOS container/Linux VM tool, CLI name `orb`)**: excluded. None of Amp's official docs, news, or the security page mentions OrbStack anywhere; orbs run on e2b cloud compute and have nothing to do with local container runtimes. The name collision is pure coincidence.
- **CORBA ORB (Object Request Broker)**: excluded. No intersection with the Amp context; zero occurrences in the first-hand sources searched for this research.
- If the "ORB" the user heard comes from Amp's podcast/X promotion (e.g. the "it's orbin' time" meme cited at the opening of notes/orbs-explained), it also refers to the same Orbs.

## 4. Relevance to pacman (one paragraph)

Per the wiki: ```[[todos.dev 与 Multica 对照]]```, ```[[pacman 的编排器坐标与借鉴清单]]```: Amp sits at the extreme sample of "productized execution surface" — todos builds the hosted-runtime sandbox into the product but states external runtimes are unsandboxed, Multica simply declares it does no filesystem sandboxing and pushes the boundary outside the daemon, while Amp packages "every machine disposable + snapshot pre-warming + OIDC short-lived credentials + portal-exposed services" into a billed product, while keeping the local surface at zero isolation and zero approval and making gates programmable rules (down to delegating to OPA). The two points of most direct value to pacman: the `.agents/setup` / `.agents/resume` pair as a "declare the environment lifecycle inside the repository" hook shape (isomorphic to pacman's daemon enroll / runtime discovery), and the gate-allocation principle "gates only for irreversible actions, reversible actions covered by version control" (compatible with pacman's dual-gate semantics; usable to calibrate which steps are worth blocking).

## 5. Unverified / search boundaries

- **The exact contents of the built-in default permission list** (what "sensible defaults" look like, which command shapes ask by default): news/tool-level-permissions mentions it exists, but the canonical copy lives at ampcode.com/manual#permissions — that page is a JS-rendered SPA, and Jina Reader only fetched the table-of-contents shell, so the original text could not be read this time.
- **The author of notes/permissions**: the page carries no byline (`/Users/dhamidi/` appears in the example output; no author guess is made from that).
- **e2b's virtualization substrate** (common industry knowledge says Firecracker microVM): the e2b pages read this time only call themselves a "secure Linux VM"; the Firecracker phrasing was not re-verified and is not used as a conclusion in this document.
- github.com/sourcegraph/amp returns 404 (renamed or made private, measured 2026-10-02), so there is no source-level verification; the evidence ceiling for all mechanism descriptions is "official claim".
- The podcast (Raising an Agent) and Chronicle were not searched episode by episode; all philosophical quotes in this document come from the text notes/news.

## 6. Source list

All accessed 2026-10-02 via agent-reach web (Jina Reader) / exa semantic search / the gh CLI. "Official claim" = Amp first-party documentation; "third-party official" = e2b first-party documentation.

| # | Source | URL | Date | Evidence strength |
|---|---|---|---|---|
| 1 | Amp Docs homepage (Introduction) | https://ampcode.com/manual | accessed 2026-10-02 | official claim |
| 2 | Amp Security Reference | https://ampcode.com/security | accessed 2026-10-02 | official claim |
| 3 | Orbs Overview | https://ampcode.com/docs/orbs | accessed 2026-10-02 | official claim |
| 4 | What Are Orbs? | https://ampcode.com/what-are-orbs | accessed 2026-10-02 | official claim |
| 5 | Customizing Orbs (lifecycle/snapshots/setup/resume) | https://ampcode.com/docs/orbs/customizing | accessed 2026-10-02 | official claim |
| 6 | Handling Secrets (OIDC workload identity) | https://ampcode.com/docs/orbs/handling-secrets | accessed 2026-10-02 | official claim |
| 7 | Getting Started With the CLI (three executor surfaces) | https://ampcode.com/docs/cli | accessed 2026-10-02 | official claim |
| 8 | Runners (incl. desktop/labwc+Waymote) | https://ampcode.com/docs/cli/runners | accessed 2026-10-02 | official claim |
| 9 | Tools (no approval by default + isolated-environment advice + Permissions section) | https://ampcode.com/docs/tools | accessed 2026-10-02 | official claim |
| 10 | How We Think about Permissions | https://ampcode.com/notes/permissions | accessed 2026-10-02 | official claim (first-hand philosophy) |
| 11 | News: Tool-Level Permissions | https://ampcode.com/news/tool-level-permissions | published 2025-08-07 | official claim |
| 12 | News: Secret Redaction | https://ampcode.com/news/secret-redaction | published 2025-05-30 | official claim |
| 13 | News: Agents in Orbs | https://ampcode.com/news/agents-in-orbs | published 2026-06-30 | official claim |
| 14 | News: The Coding Agent Is Dead | https://ampcode.com/news/the-coding-agent-is-dead | published 2026-02-19 | official claim (first-hand philosophy) |
| 15 | Notes: Orbs, Explained (Thorsten Ball) | https://ampcode.com/notes/orbs-explained | published 2026-08-25 | official claim |
| 16 | Notes: What I Want to Tell You About Orbs (Thorsten Ball) | https://ampcode.com/notes/what-i-want-to-tell-you-about-orbs | published 2026-08-04 | official claim |
| 17 | e2b Docs: Run Amp in a secure E2B sandbox | https://e2b.dev/docs/agents/amp | accessed 2026-10-02 | third-party official |
| 18 | e2b Docs homepage (sandbox = on-demand Linux VM) | https://e2b.dev/docs | accessed 2026-10-02 | third-party official |
| 19 | Amp sitemap (all 153 news slugs scanned; no local OS-sandbox entry) | https://ampcode.com/sitemap.xml | accessed 2026-10-02 | official claim (structural evidence) |
| 20 | wiki ```[[Agent 沙箱与快照加速]]``` (Codex sandbox-exec/bubblewrap contrast, E2B niche) | local `~/.agents/wiki/wiki/` | ingested 2026-09-29 | secondhand (local distillation) |
| 21 | wiki ```[[todos.dev 与 Multica 对照]]```, ```[[pacman 的编排器坐标与借鉴清单]]``` | local `~/.agents/wiki/wiki/` | 2026-09-30/10-01 | secondhand (local distillation) |
