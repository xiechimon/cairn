# ui-cds-transcript (PR-6)

Claude Desktop redesign PR-6: transcript column + stick-to-bottom.

## Changes
- Stick-to-bottom: `scrollEdgeThreshold={40}` (FOLLOW_THRESHOLD); unpin on wheel/touch/keys; stream growth follows only while pinned (MessageScroller; ~180ms autoscrolling flag ≈ plan 150ms no-pull-back)
- Jump-to-latest: independent `JUMP_THRESHOLD` **120px** via `MessageScrollerJumpButton`
- Scroll-edge fade: Viewport class `scroll-fade` + `useScrollFade` (was dead `scroll-fade-b`)
- Column: Content `max-w-(--chat-max-w)` **768px**; Viewport bottom pad `--chat-extra-space` **35vh**
- Thinking trigger: **12/16 medium**; fenced code: **12px** radius (`--cds-radius-xl`), mono **11.5/16**
- Detail head: `--titlebar-h` **48px** (was h-11 / 44px)
- Bubble 18px already shipped; colors frozen
- Chief drawer shares FOLLOW 40 + Jump 120

## Evidence
- `before/` / `after/` screenshots (follow / release / jump / streaming)
- `after/metrics-after.json`
- e2e: `cds-transcript.spec.ts`

## Mon checklist (do not merge overnight)
- [ ] Follow pins within ~40px of bottom while streaming
- [ ] Upward scroll / wheel releases pin; stream growth does **not** yank back
- [ ] Jump-to-latest appears past ~120px and returns to end
- [ ] Top/bottom scroll-edge fade present; fades clear at edges
- [ ] Header ~48px; column content capped at 768; 35vh bottom buffer
- [ ] Thinking 12/16 medium; code blocks 12px / 11.5 mono

## Live streaming note
Fixture e2e cannot arm `autoScroll` (`autoScroll={live && transcript.length > 0}`).
Stick-to-bottom follow/unpin is MessageScroller-native with `scrollEdgeThreshold={40}`.
**Mon morning check:** open a live running task, confirm stream growth follows near bottom,
wheel-up releases without yank-back, and jump appears past ~120px.
