# Open-source agent memory systems compared with Cairn's memory (2026-11-26)

Labels: **measured** = source code, official documentation or paper text read this round, or a command run this round; **inferred** = follows from measured facts and can be re-checked; **guessed** = everything else, including search snippets and press coverage.

Cairn code references are against `9feeca9a1`. Related earlier notes: [personal-agent-memory-2026-11-07.md](./personal-agent-memory-2026-11-07.md), [trajectory-self-improvement-2026-11-08.md](./trajectory-self-improvement-2026-11-08.md).

## 0. Conclusion

1. **Adopt none of them. Keep Cairn's memory and change three things** (section 7): give every write path the same write criterion; record whether a correction comes back; and send a correction that comes back to a check (test, lint, gate, hook), not to another memory line. (inferred)
2. **The external systems solve a different problem.** The memory libraries mostly answer "what did this person say earlier, and what is true now". Their public benchmarks score exactly that, with question answering over long chats. None of the benchmarks or READMEs read here reports how often an agent repeats a mistake it was corrected on. (measured for the sources listed in section 5; "none exists anywhere" is not claimed)
3. **The owner's view, tested.** "Memory cannot constrain the agent" holds. "It does not stop a repeated mistake" holds if "stop" means reliably; it is false if it means "has no effect". "Memory is the least useful thing" does not hold: it is useful for facts, preferences and continuity, and a rule in context does raise compliance, only far from 100%. Mechanisms are stronger where the rule is machine-checkable, but they cover only that part, and they can go stale or fire wrongly. (inferred from sections 4 and 5)

## 1. Method and limits

- Read official docs and source for every system in section 2. Source links are pinned to the commit read. (measured)
- Installed and ran mem0 2.2.1, graphiti-core 0.32.1 (FalkorDB Lite driver), LangMem 0.0.30, cognee 1.6.10, basic-memory 1.0.0 and Letta Code 0.34.70 in a scratch directory outside the repository, with an isolated home directory and telemetry off. npm lifecycle scripts were disabled. Python used prebuilt wheels except two small pure-Python packages that ship no wheel (`langdetect` for cognee, `pybars3` for basic-memory), whose setup scripts therefore ran. (measured)
- Model: a local Ollama with `qwen3:0.6b` and `qwen3-embedding:0.6b`, behind a proxy that logged every call. **Call counts and prompt sizes are properties of the libraries. Answer quality and latency are properties of a 0.6B model on a laptop and say nothing about any system's quality with a real model.** (measured / inferred)
- Same scenario for the five libraries: write one behavior rule ("do not use the `open` command to show files; use the review page"), then "the deploy target is server alpha", then "it is now server beta, alpha is retired"; query the deploy target and a request that the behavior rule should govern. (measured)
- Not run: Supermemory (its self-hosted server is a closed binary), Zep (cloud service), and the closed products. ChatGPT, Cursor, Amp and Codex memory were **not operated**; their rows rest on documentation only.

## 2. Comparison

### 2.1 What each one stores, writes, retrieves and forgets

| System | Stores | Who decides to write | Retrieval | Update / forget |
|---|---|---|---|---|
| [mem0](https://github.com/mem0ai/mem0/blob/a330119bda245ad05bf1d5e6779fc588b5f19443/mem0/memory/main.py) | Short fact strings in a vector store, plus history; optional procedural summary | One LLM extraction per `add`; the prompt's sole operation is ADD; exact-hash dedup | Vector search; BM25 and entity boost only if extra packages are installed | ADD-only since v3 ([README](https://github.com/mem0ai/mem0/blob/a330119bda245ad05bf1d5e6779fc588b5f19443/README.md): nothing is overwritten); manual update/delete; expiration date hides |
| [Letta](https://github.com/letta-ai/letta/tree/8816d3a8516893bfdc0fa14bfb1235226012e295) → [Letta Code](https://github.com/letta-ai/letta-code/tree/f23cae2c019131c08914203dd6a09c5f60016243) | Markdown files in a git repository (MemFS); core files compiled into the system prompt; skills | The agent edits its own files; `/remember`; background "dreaming" [reflection](https://github.com/letta-ai/letta-code/blob/f23cae2c019131c08914203dd6a09c5f60016243/src/agent/subagents/builtin/reflection-v2.md), default every [25 steps](https://github.com/letta-ai/letta-code/blob/f23cae2c019131c08914203dd6a09c5f60016243/src/settings-manager.ts) | Core always loaded; the rest read with file tools | File edits and git history; `/doctor` for drift; optional [size limits](https://github.com/letta-ai/letta-code/blob/f23cae2c019131c08914203dd6a09c5f60016243/src/memory-constraints.ts) enforced by a git pre-commit hook |
| [Graphiti](https://github.com/getzep/graphiti/tree/b8ea9c5dcba4b0031c9c204f733bcd7ad5e2dadc) | Episodes, entities and fact edges with validity times in a graph database | Every episode goes through LLM extraction and resolution | BM25 + vector, rank fusion; optional graph walk and reranker | An LLM flags a contradiction, then dates decide which edge is [invalidated](https://github.com/getzep/graphiti/blob/b8ea9c5dcba4b0031c9c204f733bcd7ad5e2dadc/graphiti_core/utils/maintenance/edge_operations.py); history kept |
| [Zep](https://github.com/getzep/zep/tree/5e9f35d7c7dcc7eb1d92f180d9296f39a8c64de8) | Hosted context graph; ["Agent Skills"](https://help.getzep.com/agent-skills) compiled from task runs | Cloud service. Skills come from recorded runs with an outcome | Hosted, over MCP or SDK | Versioned skills with a trust score moved by verified successes and failures. The public repository is examples and integrations only |
| [LangMem](https://github.com/langchain-ai/langmem/tree/4beb9c36a40953f09357e5b2dd62ecc726f22d13) | Typed memories in a LangGraph store; [prompt optimizers](https://github.com/langchain-ai/langmem/tree/4beb9c36a40953f09357e5b2dd62ecc726f22d13/src/langmem/prompts) rewrite the system prompt from trajectories and feedback ([concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)) | Agent tools, or a background manager that calls the model | The store's search | The model may update; deletion is a [per-manager option](https://github.com/langchain-ai/langmem/blob/4beb9c36a40953f09357e5b2dd62ecc726f22d13/src/langmem/knowledge/extraction.py) |
| [cognee](https://github.com/topoteretes/cognee/tree/1961133d0c68b450fe8e71941a756371e94f7c04) | Documents, chunks, summaries, entity graph, session records | `add` stores raw data; `cognify` extracts; `improve` runs further stages including conflict review and proposal-first [skill improvement](https://github.com/topoteretes/cognee/blob/1961133d0c68b450fe8e71941a756371e94f7c04/cognee/modules/memify/skill_improvement.py) | Chunk vectors, graph, summaries, hybrid | `forget` deletes an item, a dataset or everything |
| [Supermemory](https://github.com/supermemoryai/supermemory/tree/4fdfbe4516535be27ec5a77e0b8e896080079295) | Facts, profiles and a memory graph (`updates` / `extends` / `derives`) | Automatic extraction plus background "dreaming" | Hybrid search | Documented [automatic forgetting](https://github.com/supermemoryai/supermemory/blob/4fdfbe4516535be27ec5a77e0b8e896080079295/apps/docs/concepts/graph-memory.mdx): expiry, contradiction, noise. Public repository is MIT SDKs and plugins; the [self-hosted server is a closed binary](https://github.com/supermemoryai/supermemory/blob/4fdfbe4516535be27ec5a77e0b8e896080079295/apps/docs/self-hosting/overview.mdx) limited to 10,000 documents |
| [basic-memory](https://github.com/basicmachines-co/basic-memory/tree/9d13a666fc78ee9ce366de06bb376161e32e28ba) | Markdown files with frontmatter, observations and links | The agent or person, through MCP tools; no extraction model | Full text + local embeddings + links | Edit or delete the file; a second write to the same path is refused |
| [Claude Code](https://code.claude.com/docs/en/memory) | `CLAUDE.md` files written by people; auto-memory topic files plus a `MEMORY.md` index | The model, for four note types; it skips what the code or `CLAUDE.md` already says | `CLAUDE.md` always loaded; first 200 lines or 25 KB of the index; topic files on demand; not given to subagents | Model or person edits files; write-time stamp; over-limit index returns an error |
| [ChatGPT](https://help.openai.com/en/articles/8590148-memory-faq) | Saved memories; a synthesized memory that draws on past chats, files and connected apps | Explicit request, the model, or background ["dreaming"](https://openai.com/index/chatgpt-memory-dreaming) | Internal mechanism not documented | The newer experience rewrites itself over time; users can correct and delete |
| [Codex](https://learn.chatgpt.com/docs/customization/memories) | Local generated memory files; off by default | Background pass over idle chats | Injected into later sessions | Generated state; docs say required rules belong in `AGENTS.md` or checked-in docs |
| [Cursor](https://cursor.com/docs/rules) | Rules files (always, by path, by relevance, manual) | People | By rule type | Edit files. `cursor.com/docs/context/memories` now redirects to the Rules page; the docs index lists memory only for the [Agent SDK](https://cursor.com/docs/agent-sdk/reference/memory.md) (a per-turn journal shared by all sessions and users) |
| [Amp](https://ampcode.com/docs/markdown/customize/agents-md) | `AGENTS.md` guidance files | People, or the agent when asked | Always loaded, subtree on read, `globs` | Edit files. No memory page in the documentation index |
| **Cairn** | SQLite rows: core, searchable and scratchpad documents; team lines; history | Agents through tools; a pre-compaction extraction; an owner-initiated "memory edit" turn; repo import | Indexes always injected; other files on demand; lexical recall on user turns | Versioned replace with `supersededBy`, 90-day history; capped team memory with retirement |
| **Owner's Claude Code files** | Same format as Claude Code above, plus `CLAUDE.md` and hooks | Model and owner | Same | Manual consolidation |

All rows except Cairn's two: **measured** from the linked source or documentation. Statements in vendor documentation are measured as "the vendor says", not as verified behavior. For ChatGPT dreaming, the announcement's text was read; its charts were not verified.

### 2.2 Cost and latency, measured locally

Per write and per search, from the proxy log. See the model caveat in section 1.

| System | One write | One search | What the run showed |
|---|---|---|---|
| mem0 | 1 chat + 2 embedding calls, about 8,000 prompt tokens, 46–52 s | 1 embedding, 40–70 ms | With `infer=False`: no chat call, about 70 ms. The small model echoed the first rule on all three writes and hash dedup kept only that. The deploy query returned the unrelated rule (score 0.373, over the 0.1 threshold). A base install runs without BM25 and entity features |
| Graphiti | 6 chat + 5 embedding calls, about 7,700–8,200 prompt tokens, 26–32 s | 1 embedding, 31–55 ms | The correction did not invalidate the old edge: alpha and beta both came back unmarked. Junk entities were created. The Kuzu driver is no longer shipped |
| LangMem | 1 chat + 2 embedding calls, about 650 tokens, 3–5 s | 1 embedding | The small model made no tool call, so nothing was stored. The one-call prompt optimizer returned a rewritten prompt; the two multi-step optimizers failed |
| cognee | `add`: no model call; `cognify`: 1–2 chat + 3–6 embedding calls, 2,000–4,000 tokens, 28–46 s | chunks: 1 embedding, 1–2 s; graph answer: 2 chat + 3–4 embedding calls, about 3,800 tokens, about 40 s | After the correction, the graph answer still said alpha |
| basic-memory | no model call; first write about 26 s (downloads a ~66 MB local embedding model), later 0.8–5 s including CLI start | no model call | Both queries returned the right note; the deploy note said beta after an explicit edit |
| Letta Code | one headless turn: 16,647 prompt tokens with 21 tools; the model call took 129 s | file reads | The local backend created a git memory repository with three files and a validating pre-commit hook, and rejected `--memfs` as unsupported. The small model saved nothing |

All **measured**. The only inference to draw: the extracting systems spend model calls on every write (1 to 6 here), basic-memory and plain files spend none, and every system that relies on a model to resolve contradictions is only as right as that model (**inferred**).

Hosting and licences (**measured** from the repositories): mem0, Graphiti, cognee and Letta Code are Apache-2.0; LangMem and Supermemory's public repository are MIT; basic-memory is AGPL-3.0. Graphiti needs a graph database; hosted Zep, Supermemory's engine and the closed products cannot be embedded.

## 3. Cairn's memory today (measured from code)

- **Store.** `agent_memory` and `team_memory_entry` in `apps/server/src/db/schema.ts`; layers core, scratchpad, searchable.
- **Always loaded.** `injectMemoryDocuments` in `apps/server/src/services/memory.ts` injects the team and project indexes, thread scratchpads, and only a count of searchable files. Indexes are bounded to 200 lines / 25 KB, with a notice when truncated. Team memory is capped at 2,000 characters.
- **Writes.** Four tools (`save_memory`, `update_memory`, `delete_memory`, `memories`); a pre-compaction extraction (`apps/server/src/coordinator/memory-flush.ts`); an owner-initiated edit turn limited to those tools (`apps/server/src/services/memory-edit.ts`) with versioned receipts; import of repository guidance files.
- **Write criterion.** The extraction prompt has a good one (durable, still true in a month, saving nothing is normal, absolute dates, say what it replaces). The Coordinator's `update_memory` description also has one. The worker tool descriptions in `WORKER_MEMORY_REMOTE_TOOLS` (`packages/shared/src/protocol/chief-tools.ts`) have none, and the Coordinator override replaces only `update_memory`, so its `save_memory` keeps the worker text.
- **Retrieval.** Substring search; per-message lexical recall of up to 4 entries (`apps/server/src/services/memory-recall.ts`), only on Coordinator user turns, scored on the first content line. No vectors by design ([memory-recall.md](../design/memory-recall.md)), with paraphrase misses accepted. Workers get memory appended to the system prompt (`apps/daemon/src/step-prompt.ts`) and no per-message recall.
- **Update and forget.** Optimistic concurrency (`baseVersion`), soft delete, restore, `supersededBy`, 90-day version retention. Team retirement (replaced first, then unused for 90 days, at most 25% per run) runs only during the pre-compaction extraction, and "used" is the extraction model's judgement (`apps/server/src/services/team-memory.ts`).
- **Feedback.** `step.memoryTrace` records which memories were injected or recalled. Nothing records whether one was followed, or whether the behavior it forbids came back.
- **Correction to mechanism.** No route. `packages/shared/src/experience-candidate.ts` (kinds `memory`, `skill`, `guard`) and the `memory_candidate` table are dead and kept pending an owner decision (`scripts/dead-runtime-exports-allowlist.json`).

## 4. The owner's Claude Code file memory

Aggregates only; no content is reproduced. All counts come from this machine on 2026-11-26.

**Shape (measured).** For this project: 37 fact files and a 5.2 KB index (30 files typed as corrections, 6 as project facts); a 5.6 KB user-level `CLAUDE.md` and a 17 KB project one. The index is well under the 25 KB limit. Hooks sit beside it: some memory lines now only point at a hook.

**Two natural experiments from local session transcripts** (about 630 non-subagent transcript files, 2026-10-14 to 2026-11-26, sidechain entries and this research session excluded; the script applied each hook's own regular expressions; **measured**, with the interpretation limits listed after each):

*A. "Do not use the `open` command."* A memory saying never to use `open` (naming `open -a "Google Chrome"` in particular) was written on 11-21; the rule was tightened on 11-22; a hook denying it was added on 11-25.

| Period | Matching commands | of which `open -a "Google Chrome"` | All shell calls |
|---|---|---|---|
| Before the memory | 47 | 14 | 18,350 |
| Memory present, no hook | 25 | 12 | 9,791 |
| After the hook (about one day) | 0 | 0 | 1,412 |

The hook's own test call is excluded. The rate was 2.6 per 1,000 shell calls both before and after the memory, and the exact command the memory named ran 12 more times. **Limits:** few sessions (3, then 2); before 11-21 these commands were not yet forbidden; the memory may not have been reloaded into a long-running session; the hook pattern also matches some harmless uses. **The zero after the hook cannot be credited to the hook**: it recorded no denial, the memory was consolidated in the same hour, and about four matches would have been expected by chance at the old rate over a short and unlike window.

*B. "Reply to the owner in Chinese."* The rule was in always-loaded instructions and memory; a Stop hook was added on 11-24.

| Measure | Before the hook (10-14 to 11-23) | With the hook (11-24 to 11-26) |
|---|---|---|
| Final reply after a Chinese prompt that the hook's test classes as mostly English | 88 / 753 (11.7%) | first attempt: 20 / 152 (13.2%) |
| Stop-hook blocks | none | 44, of which 18 followed a Chinese prompt |

The model's first attempts did not improve; the hook changed what got delivered, by forcing a rewrite (it lets a second attempt through). **Limits:** the classifier is the hook's own heuristic; sample selection by "Chinese prompt" is approximate; the pre-hook rate swung widely (5.0% before 11-13, 19.2% from 11-13 to 11-23), so no trend is claimed. The other 26 blocks did not follow a prompt this script classed as Chinese; they may include correct catches and wrong ones (**guessed**).

**Corroboration.** A separate owner-workflow analysis made on 11-25 (outside this repository; read this round, counts not re-done) sorted 313 owner turns into recurring error classes. It lists eight prose memory rules that never prevented a recurrence, contradictions between instruction files and memories, and no recurrence seen for the classes that had reached a hook or code, over windows of at most two days. That a mechanism-covered class drew no further complaint is measured by that report; that the mechanism caused it is **inferred** at best. Experiment B shows the difference between "the owner stopped seeing it" and "the model stopped doing it".

**Mechanisms age too (measured, this session).** A hook that routes subagent work denied this research's subagent calls, and its message recommended a model family that a newer memory had since ruled out. A mechanism enforces whatever it was last told.

## 5. Does any of this reduce repeated mistakes?

### 5.1 What the memory benchmarks measure

| Benchmark | Measures | Does not measure | Caveats |
|---|---|---|---|
| [LoCoMo](https://arxiv.org/abs/2402.17753) | QA (single-hop, multi-hop, temporal, open-domain, adversarial), event summaries and multimodal dialogue over long synthetic-then-edited chats (about 9K tokens, up to 35 sessions) | Whether an agent acts differently | The context fits current windows. In [mem0's own paper](https://arxiv.org/abs/2504.19413) full context scored highest (about 72.9) against mem0 66.9 and graph mem0 68.4; mem0 won on latency and tokens. [Zep disputes](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) mem0's Zep setup and corrected its own figure; mem0 [disputes Zep's](https://github.com/getzep/zep-papers/issues/5). A third-party audit reporting answer-key errors and a lenient judge was seen only in [secondary form](https://penfieldlabs.substack.com/p/we-audited-locomo-64-of-the-answer) (**guessed**) |
| [LongMemEval](https://arxiv.org/abs/2410.10813) | 500 questions: extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention | Behavior, rule compliance | The paper found large drops for commercial assistants and long-context models |
| [DMR](https://arxiv.org/abs/2310.08560) | Single-turn fact retrieval from short chats | Anything harder | [Zep's paper](https://arxiv.org/abs/2501.13956) reports Zep 94.8 against full context 94.4, and 98.2 against 98.0, and calls the benchmark weak. The same paper reports LongMemEval 63.8 against 55.4 and 71.2 against 60.2 for full context, at about 1.6K instead of 115K tokens (vendor result) |
| [BEAM](https://arxiv.org/abs/2510.27246) | Probing questions over long generated conversations (up to 10M tokens); cognee's report lists [ten abilities](https://github.com/topoteretes/cognee/blob/1961133d0c68b450fe8e71941a756371e94f7c04/cognee/eval_framework/beam/REPORT.md), preference and instruction following among them | Coding work, recurrence over real tasks | Figures read here are self-reported; cognee's [report](https://github.com/topoteretes/cognee/blob/1961133d0c68b450fe8e71941a756371e94f7c04/cognee/eval_framework/beam/REPORT.md) (0.79 at 100K) says its setup was tuned for the benchmark |

mem0's current README numbers and Supermemory's "#1" claim are vendor claims that were not reproduced. All rows are **measured** from the cited text unless marked.

### 5.2 Studies closer to the question

| Finding | Source |
|---|---|
| Applicable preference checks satisfied: no rules 31.6%; all rules in context 55.0%; Mem0 42.5%; task-relevant rules 54.0%; rules compiled into checks 70.1%. Making a correction available does not ensure it is followed; checks help and still miss. Simulated users | [TellOnce](https://arxiv.org/abs/2606.13174) |
| Instructions in repository context files are generally followed (a named tool gets used), yet the files do not generally raise task success and add over 20% cost | [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) |
| No measurable change in correctness from context strategy over 288 runs; failures were implementation skill | [two-agent ablation](https://arxiv.org/abs/2607.27250) |
| Random rule files helped as much as curated ones; only negative constraints helped individually | [Guardrails Beat Guidance](https://arxiv.org/abs/2604.11088) |
| File size, position and architecture showed no detectable effect on compliance; compliance fell as a session went on (about 5.6% lower odds per generated function) | [adherence factorial](https://arxiv.org/abs/2605.10039) |
| Instruction following degrades as instruction count grows; 68% at 500 for the best models (a keyword-inclusion task, not coding rules) | [IFScale](https://arxiv.org/abs/2507.11538) |
| 90.1% of choices followed a stale instruction file over the existing code | [stale files](https://arxiv.org/abs/2610.30571) |
| Agents copy retrieved experience; bad entries propagate; selective addition and deletion do better than storing everything | [experience-following](https://arxiv.org/abs/2505.16067) |
| Stored abstractions can regenerate the errors they came from | [error reproduction](https://arxiv.org/abs/2610.27406) |
| **Counter-evidence:** reusing reflections, insights or strategies raises task success on task streams | [Reflexion](https://arxiv.org/abs/2303.11366), [ExpeL](https://arxiv.org/abs/2308.10144), [ReasoningBank](https://arxiv.org/abs/2509.25140), [MemGuard](https://arxiv.org/abs/2608.21867) |
| One-person case study: on a newer model, several past failures no longer reproduced with or without their fix; one drift failure returned without its check and the check stopped it. Exploratory | [rules case study](https://arxiv.org/abs/2610.32578) |
| A coding-memory project states that its histories are not evidence that warnings prevented failures, and asks for a repeat-failure benchmark | [PROJECTMEM](https://arxiv.org/abs/2606.12329) |

Abstract-level claims are **measured** as what the authors report; the numbers in the first row were read in the paper body. These studies differ in agents, tasks and measures and should not be added together. Among the memory systems themselves, Letta Code's reflection prompt puts mistakes and corrections first, LangMem rewrites prompts from feedback, cognee proposes skill changes and Zep scores skills by outcome, so "learning from mistakes" is a **stated aim**; no measurement of reduced recurrence was found in what was read (**measured** for the search; absence elsewhere is not claimed).

### 5.3 Where memory helps, and where only a mechanism does

| Need | Memory | Mechanism |
|---|---|---|
| Facts the code does not contain (deploy target, who decided what, external references) | Right tool. Needs supersede and dating, or the old fact wins | Not applicable |
| Preferences and judgement (tone, how to report, what counts as enough) | Right tool; compliance is probabilistic | Only where a proxy is checkable, with false positives |
| Continuity across sessions and compaction | Right tool; flush before compaction | Persisted state for anything that must not be lost |
| "Never run this", "always run that first" | A reminder only; the vendor of the owner's tool [says so](https://code.claude.com/docs/en/memory) and points to hooks | Permission rule or pre-tool hook. Covers only the patterns written |
| Output with a checkable property (language, format, forbidden construct) | Raises first-attempt compliance at best | Stop hook, linter, CI gate |
| "This bug must not come back" | Does not do it | Regression test that fails on the old code |
| Design taste, product framing, "verify like a user" | The only cheap place to say it, and the class the 11-25 analysis saw recur most | Usually partial: ratchets, required evidence, review in a fresh context |

**Inferred** from sections 4, 5.1 and 5.2.

## 6. Gap analysis

### 6.1 Cairn's product memory

| Area | Compared with the field | Verdict |
|---|---|---|
| Update, history, restore, supersede | Stronger than mem0's ADD-only and plain files; comparable in intent to Graphiti's validity history without a model deciding contradictions | Keep |
| Bounded always-loaded context | Same pattern as Claude Code and Letta core memory; the caps agree with the evidence that more instructions are not free | Keep |
| Write quality | Weaker than Claude Code's and Letta's written criteria on the worker path | Gap 1 |
| Retrieval | No semantic recall. basic-memory shows local embeddings can run without a model service, at the price of a model download and a second index | Accept for now; no evidence that Cairn users lose answers to paraphrase misses, because nothing measures it |
| Forgetting | Team retirement depends on compaction happening and on a model's idea of "used"; quiet scopes are never cleaned | Minor gap; do not add a scheduled tidy pass (retired in `5964355d2`) |
| Knowing whether memory works | Injection is traced, outcome is not. No system compared here documents this for rule compliance either; Zep's skill trust score is the nearest idea | Gap 2 |
| Repeated corrections | Another memory line is the only response | Gap 3 |
| Staleness against the repository | Stale instructions override code in the cited study. Recall output already says to verify first; always-injected indexes were not checked for an equivalent | Watch; check the index wording when doing gap 1 |

### 6.2 The owner's file memory

- It already has what the extracting systems sell (typed notes, an index, on-demand detail) at no model cost per write, readable and diffable. None of them would constrain the agent better. (inferred)
- Its weak points: rules that are machine-checkable but still only prose; drift and contradictions between memory, instruction files and hooks; "no recurrence" recorded in a memory when only the delivered output was observed; no retirement or re-test routine. (inferred from section 4)

## 7. Recommendation

**Do not adopt mem0, Letta, Graphiti/Zep, LangMem, cognee, Supermemory or basic-memory.** For Cairn's users each would add a second store, mostly a Python or hosted service, and in most cases model calls on each write, to improve conversational recall, which is not the failure in question. Graphiti needs a graph database, Zep and Supermemory's engine are not self-hostable open source, mem0 would lose the supersede behavior Cairn has, and basic-memory (AGPL-3.0) duplicates the document store. (inferred)

Each change below alters agent or product behavior, so it needs the owner's yes. In this order:

1. **One write criterion on every write path.** Move the durable / not derivable from the repository / state what it replaces / absolute date / saving nothing is fine criterion into the shared tool descriptions, so workers and the Coordinator's `save_memory` get it. Areas: `packages/shared/src/protocol/chief-tools.ts`, `packages/shared/src/records/chief.ts`. Cheapest change. Its effect is unmeasured; cap the added prompt text.
2. **Record recurrence before changing retrieval.** When a user's correction leads to a memory write, mark the write as a correction; when a later correction updates or restates an entry that `memoryTrace` shows was injected in that step, count one "injected and still repeated". If it was not injected, count one "retrieval miss". Areas: `apps/server/src/db/schema.ts` (persisted state: needs the one-page design first), `apps/server/src/services/memory.ts`, `apps/server/src/services/coordinator-steps.ts`, worker injection in `apps/server/src/services/machine-claim.ts`. No new user setting. Matching two corrections as "the same" is a model judgement and will be imperfect; keep the evidence so it can be audited. This number then decides whether semantic recall or worker recall is worth building.
3. **Second occurrence goes up the ladder.** On a recurrence, the Coordinator proposes a normal task that adds a check in the user's repository (regression test, lint rule, CI gate), or says plainly that the rule cannot be checked and stays advice. The user accepts or declines; Cairn installs no hook by itself. Memory keeps one pointer to the check. Areas: Coordinator prompt and tools (`apps/server/src/services/chief.ts`, `apps/server/src/services/chief-tools.ts`). With it, delete the dead `experience-candidate` module and `memory_candidate` table rather than keeping two routes.

Not recommended now: vector or graph recall, per-turn extraction, scheduled consolidation, prompt self-rewriting.

**For the owner's own setup** (his configuration, not product work):

- Keep the files. For each correction memory, ask whether it is machine-checkable; if so, move it to the highest rung and keep one pointer line.
- Give each hook a negative control and a way to see its denials and false positives; re-check it when the memory it came from changes (the routing hook is out of date today).
- Count recurrences from transcripts and hook logs, not from the absence of complaints.
- Periodically remove contradicting and dead rules, and re-test whether old rules are still needed on the current model.

**What would change this recommendation:** a measured retrieval-miss rate that lexical recall cannot fix (then try local embeddings inside SQLite before any external system), or a published evaluation showing a memory system lowering recurrence of corrected mistakes on coding tasks.
