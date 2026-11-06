# Capability routing: how products choose the model per task

Date: 2026-11-06. Method: read each product's current public docs (fetched this session); nothing below is inferred from behavior we did not read.

## What the products do

| Product | Who chooses | Signal | Observability | Source |
|---|---|---|---|---|
| Amp | The user picks a mode (`low`, `medium`, `high`, `ultra`); each mode bundles a model, reasoning effort, system prompt and tools "for a level of difficulty". Subagents inherit the thread's model and effort. | Task difficulty, chosen by a person, not the model name | The Modes page shows the current routing; models change under the mode names | https://ampcode.com/docs/models-and-subagents |
| OpenRouter Auto Router | A lightweight classifier labels each prompt with one of about 30 task types; the router ranks models for that type by trailing 7-day spend share, filtered by `cost_tier`, `allowed_models` and `excluded_models`. | Task kind plus a cost band plus an allow list; the top remaining models become primary plus fallbacks | The response `model` field names the model that answered; a metadata header reports the classified `task_type` | https://openrouter.ai/docs/guides/routing/routers/auto-router |
| Cursor Auto | Auto has Cost, Balance and Intelligence modes; Balance and Intelligence use Cursor Router to pick among Cursor and third-party models per request. Manual selection bypasses routing. | Optimization mode; billing follows the routed model | The docs do not say how the router decides | https://cursor.com/docs/models |
| Codex | The user picks a model and a reasoning effort. Guidance maps model to work: the most capable model for complex end-to-end work, a cheaper near-top model for long repeated work, an efficient model for high-volume focused tasks. Effort goes up for multi-step or high-trade-off work. | Speed, cost and capability balance; effort as a second dial | `--model` and `/model`; no routing record | https://learn.chatgpt.com/docs/models |

## What to take

1. Route on two inputs, as Amp and OpenRouter both do: task kind and difficulty. Model name is the output, not the input.
2. The candidate set is what is actually available (OpenRouter filters by allow list and guardrails; Cursor by plan). Ours is connections, harnesses on machines and quota.
3. Rank inside the candidates by the cheapest model that is adequate for the difficulty (OpenRouter's cost band, Codex's "near-top at lower cost" model for long work), then fall back down the ranked list, never up to something the task does not need.
4. Report the decision on every request: OpenRouter returns the answering model and the task type. Cairn records harness, model, task kind, difficulty, reason and the rejected candidates for each dispatched step.
5. Effort is a second dial (Codex, Amp), kept next to the model in the decision.
6. Fixed policy is separate from the router: Review always runs on Codex and the Coordinator is only a router. These are not scored; they are rules of the product.

## What none of them settle

No source documents a mid-run model switch. Cairn pins a step to the decision recorded when it is first dispatched; a later quota change affects the next step, and the existing fallback mechanism (`step.fallback`) is the only way a running step changes model.

## Design in cairn

- One pure function, `routeWork`, in `packages/shared/src/capability-routing.ts`, takes the step kind, difficulty, the candidate harness/model/machine options and quota, and returns the chosen option, a reason and every rejected candidate with its rejection reason.
- Review: candidates are restricted to `openai-codex` / `gpt-6.1-sol`; with none available the step is unroutable and waits (no model switch).
- Implementation (`plan`, `build`, `session`, `verify`): a ranked capability table per difficulty. `hard`: `gpt-6.1-sol`, then `claude-opus-5-5`, then `claude-sonnet-5-5`. `standard`: `claude-sonnet-5-5`, then `gpt-6.1-sol`. `easy`: `claude-haiku-5-5`, then `claude-sonnet-5-5`, then `gpt-6.1-sol`. A candidate is rejected when its harness is not enabled or not logged in on the machine, its connection is unavailable, or its weekly quota used is at or above 70%.
- `routeForStep` is the one path every dispatch reads. For `session` and `review` steps it finds the team's `routing_rule` row and replaces its provider and model with the router's choice. The row's machine, capability and thinking constraints stay. When no candidate qualifies (a machine that reports nothing), a `session` step keeps the row's model as the default; a `review` step is still set to Codex, so it waits for a Codex machine instead of running on Claude.
- At claim the decision is written once to `step_route` (step id, harness, provider, model, machine, difficulty, reason, rejected candidates). Any later read for that step reuses the stored row, so a step never changes model in flight, and the step's OTel span carries the same fields as `cairn.route.*` for Langfuse.
- Difficulty comes from an explicit `difficulty:easy|standard|hard` marker in the todo, else spec length (under 300 characters easy, 3000 or more hard). It is crude and recorded on every decision so the thresholds can be tuned from traces.
- `ROUTING_USES` / `resolveRouting` stay as the read-only settings view; `ROUTE_USES` rows are what dispatch uses, now through the router.
