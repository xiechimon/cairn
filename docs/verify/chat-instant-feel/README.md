# Chat interaction verification

The 1440px before/after images come from the running app with deterministic API mocks. Summary images crop the shared WorkTrace inside the task conversation; long-command images show the global Coordinator. They are fixture evidence, not a production account capture. The original source was read from HEAD for the before captures; the corrected source was restored afterwards without touching the git directory.

## Interaction sweep

| Surface | Change |
| --- | --- |
| TraceGroupSummary / WorkTrace summary | Remove the expanded summary copy action; immediate feedback and no hover, pressed, open or focus box shadow |
| TraceRowButton | Thinking, read, search, run, edit, push and tool rows share flat, immediate feedback |
| ThinkingRow / TraceCollapsibleTrigger / TraceLine | Remove inherited trigger shadow and hover color/background transition, including standalone gallery usage |
| LiveRow disclosure | Flat, immediate disclosure feedback |
| Chief message copy / restore actions | Remove inherited active inset shadow and background fade; remove hover-reveal opacity fade |
| Detail message copy | Remove hover-reveal opacity fade; preserve clipboard action on assistant text |
| Chief digest / report / answered-question / pending-question controls | Chat scope removes inherited active shadow and hover background transitions |
| Composer attachment / project / send / stop / answer controls | Chat scope removes inherited active shadow and hover transitions; composer surface no longer raises its shadow on hover |
| Conversation header / starters / outage actions / thread reply | Chat scope removes inherited active shadow and hover background transitions |
| Jump to latest | Scroller scope removes inherited press shadow and transition delay |

The scope follows the shipped chat containers and shared trace primitives. Settings screens and portal dialogs keep their existing treatment. Keyboard outlines remain visible.

## Scroll constraints

MessageScroller root/content now shrink within flex layouts. Inline code wraps anywhere; user messages also use overflow-wrap:anywhere. Fenced code is capped at the message width and scrolls horizontally itself. The viewport hides horizontal overflow and sets overscroll-behavior:none, as do the Coordinator pane and its ancestors. Code blocks retain local overscroll containment.

The initial Chromium test did not reproduce horizontal expansion with the seeded inline command: its scroller width already matched its client width. It did reproduce the lack of independent horizontal code scrolling. Ancestor overscroll and intrinsic sizing are now checked explicitly. Native macOS trackpad rubber-banding needs an owner check; browser CSS assertions establish the configured behavior, not physical device feel.

## Red controls

Before implementation, the new tests observed active inset box shadows, 0.15s row hover transitions, and the expanded summary copy action. The original-source rerun also captures the failing ancestor overscroll assertions. No snapshot baseline was accepted.

## Results

- `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse`: pass. Lint reports three existing informational formatting notices outside this change.
- `pnpm exec vitest run --changed`: 93 tests pass across 9 files.
- `pnpm --filter @cairn/web e2e:affected`: shared-surface fallback ran 1,447 tests: 1,416 passed, 21 skipped, 10 failed. Eight failures were the removed copy behavior or the hover sweep's changing visibility selector; the corrected five specs were rerun through e2e:affected and all 31 tests pass. The remaining two full-run failures are the light/dark gallery baseline checks.
- The gallery baseline differences include widespread text rendering differences in unrelated specimens and intended changes to trace-states and coordinator-turn-tools. Expected, actual and diff images are preserved here. The trace specimens were visually inspected; no baseline files were replaced. CI-rendered baselines still need comparison after publication.
- Real server and Vite, isolated scratch SQLite data, no API interception and no scenario URL: both themes pass at 1440 and 375. `live-metrics.json` records 1174/1174px and 365/365px scroll/client widths and `none` on both overscroll axes. The seeded transcript is synthetic; no provider run was started. The owned server and web processes were stopped after capture.

## Reference review

`reference-phone.png` pairs Claude.ai's completed reply with the seeded live Coordinator at 375px: message text and actions stay flat; the offline model-source notice adds more footer density than the reference. `reference-open.png` pairs the supporting t3code activity reference with the seeded live Coordinator: the disclosure and activity row stay quiet; Cairn retains its existing hairline trace card and a denser summary. The long command wraps inline and its fenced counterpart scrolls inside the code box. No exact reference screenshot covers native trackpad overscroll.

The main before/after captures use a longer command than the supplemental live captures so the narrowest layouts are stressed. Images keep their original pixels except for the explicitly named side-by-side reference montages.
