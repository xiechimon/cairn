# Thinking levels per model

Settings > Model offered the same seven levels (Off, Minimal, Low, Medium, High, Xhigh, Max) for every model, from `THINKING_LEVELS` in `packages/shared/src/agent-backend.ts`. Each backend accepted a different subset and quietly mapped the rest onto a neighbour or onto nothing, so most levels the user picked had no effect or the same effect as another level. Devin models had no selector at all, although Devin accepts a per-model effort. This page records what each backend really accepts (measured 2026-11-20 against the installed packages and CLIs) and the rule the settings page now follows.

## Rule

- Each model carries the levels its backend really distinguishes: `thinkingLevels` on every `ModelSourceModel` (`packages/shared/src/records/model-source.ts`), filled by the server (`apps/server/src/services/providers.ts`) from the facts below. A level that maps onto the same backend value as another level is dropped; the level whose name equals the backend value is kept.
- The dropdown shows a default entry (no override) followed by those levels. The default entry names what it resolves to, "Default (Medium)", from `thinkingDefault` (`inServerThinkingDefault` for the in-server runtime) in the Default columns below; it reads plain "Default" only where the value is not knowable on our side. Level names and the default entry are the same English words in both locales. Nothing else is offered, so no choice silently falls back.
- No inert UI (DESIGN-RULES C25, mon X 2026-11-20): `ThinkingLevelSelect` renders nothing when its entries resolve to fewer than two different settings. A model with no adjustable thinking, and a Devin model whose levels are not learned yet, show nothing in the thinking slot: no dropdown, no label, no tooltip.
- Coordinator and compaction rows on a pi provider run in the in-server runtime, which honors fewer levels than a Runner (see below). Those rows read `inServerThinkingLevels`, which the server fills for pi models; every other runtime runs the Coordinator through the same backend as a task, so the row falls back to `thinkingLevels`.
- Rows show the provider's mark for Devin and Antigravity models (they run through that subscription whatever the upstream vendor is); other rows keep the model vendor's mark.

Prior art: Claude Code's `/effort` offers `auto` plus the levels the current model supports (model capability flags `effort`, `xhigh_effort`, `max_effort` in the CLI's model table), Codex lists `supported_reasoning_levels` per model from its model catalog (`~/.codex/models_cache.json`), and Amp has no effort control at all, only modes. Cairn follows Claude Code and Codex: per-model lists with a default entry that names the level it resolves to.

## Measured support

"Old mapping" is what Cairn did before this change for each UI level. Levels marked **same** produced a setting identical to another level, so the user could not tell them apart.

### Claude Code runtime (`apps/daemon/src/backend/claude-code.ts`, `apps/daemon/src/engine/claude-tui.ts`)

Source: `@anthropic-ai/claude-agent-sdk` 0.3.278 `EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`; Claude Code 2.1.329 model table, where `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` and `claude-fable-5-2` carry `effort`, `xhigh_effort`, `max_effort` and `rejects_disabled_thinking`.

The levels come from a per-model table in `claudeCodeThinkingLevels` (shared), built from the CLI's own capability gates — the `effort`, `xhigh_effort` and `max_effort` deny lists — instead of a version-number rule:

| Model | Supported | Default (no `--effort`) | Old mapping of Off / Minimal | Now offered |
|---|---|---|---|---|
| claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 | low, medium, high, xhigh, max; thinking cannot be disabled | medium: measured with `claude -p --model <id>` and a Stop hook, whose `effort.level` was `medium` for all three, with and without the user's settings; matches `default_effort: "medium"` in the CLI model table | Off and Minimal both sent no `--effort`, the model default: **same** as each other and as Default | Default (Medium), Low, Medium, High, Xhigh, Max |
| claude-opus-4-7, claude-opus-4-8 | low, medium, high, xhigh, max | xhigh / high respectively, from the CLI's `default_effort` | as above | Default (Xhigh), Low, Medium, High, Xhigh, Max |
| claude-opus-4-6, claude-sonnet-4-6 | low, medium, high, max (no xhigh) | high | as above | Default (High), Low, Medium, High, Max |
| claude-opus-4-5 | low, medium, high (no xhigh, no max) | high | as above | Default (High), Low, Medium, High |
| Other Claude 5.x ids (claude-sonnet-5, claude-opus-5, fable) | low, medium, high, xhigh, max | high in the CLI table | as above | Default (High), Low, Medium, High, Xhigh, Max |
| Model ids the CLI table denies effort for (claude-opus-4-0/4-1, claude-sonnet-4-0/4-5, claude-haiku-4-5, Claude 3.x) | none | n/a | Every level sent `--effort`, ignored | Nothing |
| Any model behind a custom backend (`ANTHROPIC_BASE_URL` or a custom auth token in settings.json — reported as `customBackend` in the machine's Claude Code report) | unknowable: the table describes the stock binary against Anthropic | n/a | Same CLI flags applied | Nothing |

### pi runtime on a Runner (`apps/daemon/src/backend/pi.ts`)

Source: `@earendil-works/pi-ai` 1.5.0 `getSupportedThinkingLevels` and each catalog model's `thinkingLevelMap`; `clampThinkingLevel` moves an unsupported level to the next supported one. The daemon passes no level for Default, and pi-coding-agent then uses `medium` (clamped).

| Provider / model | Supported (pi-ai) | Default (`clampThinkingLevel(model, 'medium')`) | Old mapping | Now offered |
|---|---|---|---|---|
| anthropic claude-opus-5-5, claude-sonnet-5-5 | low, medium, high, xhigh, max | medium | Off, Minimal clamped to Low: **same** as Low | Default (Medium), Low, Medium, High, Xhigh, Max |
| anthropic claude-haiku-5-5 | off, low, medium, high, xhigh, max | medium | Minimal clamped to Low: **same** | Default (Medium), Off, Low, Medium, High, Xhigh, Max |
| openai-codex gpt-6-sol, gpt-6-luna, gpt-6.1-terra | off, minimal, low, medium, high, xhigh, max; minimal maps to `low` | medium | Minimal sent `low`: **same** as Low | Default (Medium), Off, Low, Medium, High, Xhigh, Max |
| openai-codex gpt-6-astra, gpt-6.1-sol | minimal, low, medium, high, xhigh, max; minimal maps to `low` | medium | Off clamped to Low, Minimal sent `low`: **same** | Default (Medium), Low, Medium, High, Xhigh, Max |
| deepseek deepseek-flash | off, low, high, max | high | Minimal clamped to Low, Medium to High, Xhigh to Max: **same** | Default (High), Off, Low, High, Max |
| deepseek deepseek-v4-pro | off, high, max | high | Minimal, Low, Medium clamped to High, Xhigh to Max: **same** | Default (High), Off, High, Max |
| zai glm-5.3, moonshotai kimi-k3 | low, high, max | high | Off, Minimal to Low, Medium to High, Xhigh to Max: **same** | Default (High), Low, High, Max |
| Custom endpoint (provider id not in the pi-ai catalog: OpenAI- or Anthropic-compatible URLs, relays, DeepSeek-style gateways) | none: Cairn registers these models with `reasoning: false`, so pi-ai sends no reasoning parameter | n/a | Every level ignored: all seven **same** | Nothing |

`CAIRN_CUSTOM_MODEL_REASONING=1` (developer switch) turns reasoning on for custom models with the map off→none, minimal/low/medium→low, high/xhigh→high, max→max; it is not a user setting and the page does not reflect it.

### pi runtime in the server (Coordinator and compaction, `apps/server/src/coordinator/runtime/provider.ts`)

Every materialized model now borrows `reasoning`, `thinkingLevelMap` and `compat` from the pi-ai catalog entry whose provider and api match the configured row — alias ids resolve first (`z-ai` → `zai`, `z-ai-coding-cn` → `zai-coding-cn`), the Codex subscription resolves to its own catalog, and a row whose `api` differs from the catalog entry's `api` borrows nothing. Explicit `compat` on the provider row wins over catalog keys. Levels are offered only when the catalog entry marks the model reasoning-capable; "off" is offered only when the model's map sends a real off value, otherwise it collapses into Default.

| Provider / model | Default (no level) | Old | Now offered on the Coordinator row |
|---|---|---|---|
| openai-codex subscription gpt-6-sol, gpt-6.1-terra | off: pi-ai sends `reasoning.effort: none` | Seven levels; Minimal sent `low` (**same** as Low), Off **same** as Default | Default (Off), Low, Medium, High, Xhigh, Max |
| openai-codex subscription gpt-6.1-sol | no reasoning field is sent; the Codex service picks (not knowable here) | as above | Default, Low, Medium, High, Xhigh, Max |
| anthropic claude-opus-5-5 (and other `supportsMidConvoEffort` models) | high: pi-ai sends `output_config.effort` markers and defaults a missing level to `high` | Seven levels, all ignored: **same** | Default (High), Low, Medium, High, Xhigh, Max |
| anthropic reasoning models without an `off` map entry (claude-haiku-4-5, claude-fable-5) | off for haiku-4-5; not knowable for models that keep their effort on replies | as above | Minimal, Low, Medium, High (+ Xhigh, Max where the catalog supports them) |
| z-ai / z-ai-coding-cn glm-5.3 (aliased to the `zai`/`zai-coding-cn` catalog) | not knowable: `thinking.type` stays enabled, no effort sent | as above | Low, High, Max |
| deepseek deepseek-v4-pro | off | as above | Default (Off), High, Max |
| Reasoning models whose api differs from the catalog entry, non-reasoning models, unknown models, custom endpoints | n/a | Seven levels, all ignored: **same** | Nothing |

Measured live: `stepProvider` on `anthropic`/`claude-opus-5-5` with reasoning `high` sends `thinking: {type: "adaptive"}` plus an `output_config.effort: "high"` marker message to `api.anthropic.com`; the same request on a model registered the old way (`reasoning: false`, no compat) sends neither field, so the choice was silently dropped. The old shape is also why simply flipping `reasoning: true` was never enough — without the catalog `compat` (`forceAdaptiveThinking`, `supportsMidConvoEffort`), pi-ai would send budget-based or `disabled` thinking to Claude 5.5 models, which reject disabled thinking.

### Devin ACP (`apps/daemon/src/backend/acp.ts`, Devin CLI 3000.14.30821)

Devin advertises a `thought_level` select config option per model; its values change when the `model` option changes. Measured with `session/new` then `session/set_config_option` for each of the 80 advertised models:

The default is the option's `currentValue` right after the model is selected.

| Model | `thought_level` values | Default (`currentValue`) | Now offered |
|---|---|---|---|
| swe-2-high (default model) | medium, high, max | high | Default (High), Medium, High, Max |
| swe-2-flash-medium | medium, high, max | medium | Default (Medium), Medium, High, Max |
| adaptive | no option | n/a | Nothing |
| claude-opus-5-5-medium, claude-sonnet-5-5-medium, claude-haiku-5-5-medium (and most Claude ids) | low, medium, high, xhigh, max | medium | Default (Medium), Low, Medium, High, Xhigh, Max |
| gpt-6-sol-medium (and other GPT-6 ids) | none, low, medium, high, xhigh, max | medium | Default (Medium), Off, Low, Medium, High, Xhigh, Max |
| glm-5-2 | none, high, max | high | Default (High), Off, High, Max |
| gemini-4-carbon-medium | low, medium, high | medium | Default (Medium), Low, Medium, High |
| kimi-k3-1-pro-max | low, medium, high, max | max | Default (Max), Low, Medium, High, Max |
| A model this Runner has not run yet | unknown | unknown | Nothing until its first run |

Old mapping: the settings page hid the selector for every Devin model. The daemon still applied a level picked elsewhere (project override, Coordinator dispatch), but read the `thought_level` values from the `session/new` response, which describe the default model, not the selected one, and fell back (Xhigh to Max or High, Minimal to Low, Max to Xhigh or High); Off sent nothing although many models accept `none`. Now the daemon reads the values from the `set_config_option` response for the selected model, sends only an exact match (Off as `none`), and reports the values and current value it saw for that model, so the Devin source learns each model's levels and default on its first run. `swe-2-high` and `swe-2-flash-medium` ship with the measured values in `DEFAULT_DEVIN_MODELS`.

### Antigravity ACP (`agy`, `apps/daemon/src/backend/antigravity-managed.ts`)

| Model | `thought_level` values | Default (`currentValue`) | Now offered |
|---|---|---|---|
| gemini-3.8-flash (default) | low, medium, high | high | Default (High), Low, Medium, High |
| claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b-medium | no option | n/a | Nothing |
| gemini-4-carbon, gemini-4-argon, gemini-4-hydrogen, orchestrators | not offered to the measuring account | unknown | Nothing until a Runner's probe reports them |

The managed probe now sets each advertised model once on its throwaway session, records that model's `thought_level` values and current value, and restores the model it started with. Before, the same stale-options bug as Devin applied: the level for a Claude model was matched against Gemini Flash's values.

### Gemini ACP

No model source is listed for it in settings; `GEMINI_CAPABILITIES.thinkingLevels` stays empty.

## Paths that read or write a level

- Write: Settings > Model Coordinator and compaction rows (`routing_rule.thinkingLevel`), Frequently used models (`top_models`), project overrides. All store `null` for Default.
- Read: `machine-claim.ts` and `info-card-runner.ts` pass the stored level to the step; backends above apply it.
- A stored level the model does not list (saved before this change) is shown as Default. Claude Code and the Runner pi backend still apply it as before (Claude Code: Off and Minimal send nothing; pi clamps to a neighbour); the ACP backends now send it only when the selected model offers exactly that value. Picking any entry replaces it.
