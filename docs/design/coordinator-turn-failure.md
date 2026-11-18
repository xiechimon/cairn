# Coordinator turn failure

Status: accepted (mon X 2026-11-18: one style for every failure, direction C of the prototype: a grey history line in the conversation and one card above the composer for the latest failure).

## Problem

A failed Coordinator turn stores one `chief_turn_error` row whose content is `{"kind":"chief_turn_error","message":"<raw text>"}`. The web guessed a plain sentence from the raw text with two regular expressions and fell back to `模型服务这次出错了` for everything else, including `no_model`, an interrupted turn and a timeout. Only the newest failure had an explanation and buttons; older ones were one grey line, so one kind of failure had two looks. The raw text names neither the provider nor the model in a form a person reads.

## Stored state

No migration. The row keeps its id (`chief-err-<stepId>`), role `system` and `message`, and gains optional facts the raw text lacks, all written once when the turn fails:

| Field | Meaning | Source |
|---|---|---|
| `providerId` | provider record id, for the `?item=provider:<id>` link on the Model page | `provider.id` of the route that ran |
| `provider` | provider label | `provider.label` |
| `model` | model display name | the provider's model list, else the model id |
| `elapsedMs` | claim to failure | `nowMs() - step.claimedAt` |

The route that ran is the step's fallback model when one was taken, else `coordinatorProfile(team, thread project)`, the same lookup `chiefOutage` uses. A route on a runtime with no provider row (Claude Code) stores no provider fields. Every field is optional, so rows written before this change and rows from a daemon-run turn still parse.

The kind of failure is not stored. It is derived from `message` each time the row is read (`turnErrorKind` in `packages/shared`), so old rows get the new wording and one function decides the kind for every reader.

## Kinds

Derived in this order from `message`: `no-model` (`no_model`, no keyed provider), `interrupted` (`interrupted`, `restart_limit`, `faulted`, `orphaned`, `reset`, a lost journal or server restart), `turn-limit`, `connect`, `key` (401), `context` (context length), `model` (404 model not found, 403), `quota` (insufficient quota or balance), `busy` (429, 503, 529, overloaded, no available accounts), `timeout`, `provider` (any other `model_error` or HTTP status), `unknown`.

## Readers

- Coordinator conversation (`chief-message-rows.tsx`): every failure row is one centred grey line `没完成：<title>` with an expander holding the sentence and the raw text with a copy button. No buttons.
- Card above the composer (`chief-turn-error-card.tsx`): only the newest failure, and only while no owner message follows it. Title, sentence, actions per kind (first one filled), `详情` with the raw text, and close. Close or Escape hides it for that row id in this tab; retry sends the last owner message, which hides the card because an owner message now follows the failure. Above the composer one notice shows at a time: connection lost, Coordinator unavailable, this card, fallback model. When the unavailable banner shows, the card does not.
- Task panel (`Coordinator 没能安排这个任务：{reason}`): the reason is the kind's title, never the raw text.
- Status mark: unchanged; it reads the item kind only.

## Failure behaviour

A failed lookup of the facts (route deleted, provider row gone) stores the row without them; the reader falls back to `模型服务` and the model-free wording. The facts never block writing the row. No new write path exists: the row is still written only by `finishCoordinatorTurn`.

## Tests

- Server: a failed turn on a keyed provider stores provider label, record id, model name and elapsed time (`apps/server/test/coordinator-turns.test.ts`).
- Shared: `turnErrorKind` on the real samples (timeout, 503 no accounts, 404 model not found, 400 context length, `no_model`, `interrupted`, 401, 403, connection error).
- Web e2e (`apps/web/e2e/chief-turn-error.spec.ts`): history lines look the same for every failure; only the newest failure gets the card; retry resends; close hides; the link targets the provider item.
