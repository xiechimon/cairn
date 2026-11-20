---
name: cairn-copy
description: Interface copy for apps/web/src — labels, buttons, empty states, errors, confirmations and setting descriptions, in Chinese keys with the English table, through the vendored better-writing skill with Cairn overrides. Load when a UI change under apps/web/src adds or edits a user-facing string, or when copy reads wrong, unhelpful or inconsistent with the glossary.
---

# cairn-copy

Copy work starts from `upstream/README.md` — a verbatim copy of Jakub Krehel's `better-writing` at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`). The upstream `SKILL.md` is vendored as `upstream/README.md`; links in its reference files that say `SKILL.md` point there. Read it first, then `upstream/patterns.md` for destructive flows, plurals, locale formatting and status copy.

Cairn adds one fact the upstream does not know: the Chinese string is the source and the English string is a translation, so every new string is written twice and checked twice.

## Cairn overrides

Where this table differs from upstream, Cairn wins. An upstream rule not listed applies as written.

| Upstream rule | Cairn | Rules |
|---|---|---|
| Inventory the strings first: search `t(`, `i18n.`, the locale files, then list the nouns and verbs in use | Cairn is `zh`-authoritative: the Chinese source string is the `t()` key and `src/i18n/en.ts` is the one English layer. Adding a string means the `t('中文')` call in the component plus its English value in `en.ts`; the coverage test fails on a missing entry | T1 |
| Existing copy settles the vocabulary | `CONTEXT.md` is the canonical glossary (`任务` Todo, `运行` Build, `方案` Plan, `总管` Chief, `模型服务` Provider, `密钥` Secret, `机器` Machine), and both the Chinese key and the English value use its word. `README.zh.md` is the reference for the product's Chinese voice | T1 |
| One capitalization policy per element type; sentence case where the project has none | The Chinese side has no case; the English side is sentence case with no uppercase label and normal tracking | V22 |
| Tone flexes with the stakes: warm in onboarding, neutral in settings, calm in errors | Cairn is quiet at every stake: no exclamation mark, no emoji, no hype word, and a one-sentence title ends without a period. Success copy states the result, never "successfully" | T4 |
| Verb-first buttons: "Send", "Delete project" | Same, in Chinese: `保存`, `删除任务`. A dialog's confirm button names the action, not `确定` | — |
| A destructive confirmation names the action and the object, never "Are you sure?", and the buttons are verb plus object | Cairn's shipped shape wins: the title names the action and what cannot be undone (`确定删除该任务？此操作不可撤销。`), and the buttons are the action plus `取消`. An object the user typed stays quoted with `「」` | no rule |
| Undo beats confirmation when the action is reversible and frequent | The shipped shape: the action lands at once and the result toast offers `撤销`, which reverses it through the same call and reports its own failure. Irreversible actions open `alert-dialog-shell` instead | no rule |
| Errors say how to fix, beside the field that broke | Cairn adds two rules: no raw error text reaches the user (the server's message becomes a plain sentence saying what to do next, with the raw text in a tooltip or details), and a failed action puts the row back in the same frame with the message beside it | C5, C24 |
| Empty states point forward: what this place is, how to fill it, one next action | One sentence and at most one primary action, built from `components/ui/empty.tsx`; never park information that should persist inside an empty state | C12, V10 |
| Build strings whole: one message with placeholders, plural rules, `Intl` for numbers and dates | Chinese has no plural forms, so the risk sits on the English side: placeholders stay whole strings in both languages, counts and dates go through `Intl` on the English render, and no sentence is assembled from fragments | T3 |
| A settings toggle describes its ON state | Same, plus a disabled control says why beside it, and a control that only says something cannot be done is not rendered | C7, C25 |
| Placeholders show a realistic example, never an instruction | Same; a draft or fixture uses product-shaped copy, never lorem ipsum or `Item 1`, and a placeholder is never the only label | P4 |
| Name the destination in link text; no bare or repeated "Learn more" | Applies; a link inside Chinese copy still gets a named destination, not `了解更多` twice on one screen | T2 |
| One language per screen | The stricter Cairn rule: no Latin word of four or more letters inside a Chinese string unless it is a glossary term. Code renders as `<code>`, never backticks in a text node | T1, T3 |
| Keep copy out of places the reader cannot act on | Question chips carry option labels only; `推荐` and the description live in the tooltip and the accessible description, and digits pick nothing | C11 |
| Truncation is a typography concern with a way back | The title gets the row; a truncated value keeps its meaningful part and offers a way to the full text | L4 |

## Before wrap-up

Run the upstream **Before you finish** detection table over the diff and read `src/i18n/en.ts` beside the components you touched. Name the rule ids checked. Strings the server or an agent prompt supplies are `Not verified` unless you read the code that emits them.
