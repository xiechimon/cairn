# Instant jump to latest

Pressing the down arrow in the Coordinator conversation reaches the bottom on the first frame, hides the arrow within about 100ms, and gives press feedback with no transition.

Regenerate (opt-in; unset `CAIRN_E2E_EVIDENCE` writes nothing):

```sh
CAIRN_E2E_EVIDENCE=docs/verify/jump-latest-instant JUMP_EVIDENCE_PHASE=after pnpm --filter @cairn/web e2e e2e/chief-home-follow-send.spec.ts --grep 'jump to latest is instant' --workers=1
```

Use `JUMP_EVIDENCE_PHASE=before` on a tree with `jump-to-latest.tsx` from main to produce the before files.

## Files

- `before-frames-*.json`, `after-frames-*.json`: per-animation-frame `{t, top, gap, opacity}` from the click for 400ms, for click, Enter, Space, reduced motion and phone (390px, light, 4x CPU throttle). The e2e fails on main and passes here.
- `before-100ms.png`, `after-100ms.png`: screenshot at the first frame at or after 100ms in the click case.
- `claude-ai-frames.json`: the same probe on claude.ai. It also lands in one scroll event, but fades the button over 0.2s.
- `live-1440-dark.png`, `live-390-light.png`: seeded real server and SQLite, gap 0 after one click.

## Result

| Case | Main | This change |
| --- | --- | --- |
| Click, desktop | gap 7,014px still left at 405ms | gap 0 at the first frame (14ms), stays 0 after lazy layout settles |
| Phone, 4x CPU | not at bottom | gap 0 from the first frame, arrow opacity 0 at 81ms |
| Press | no feedback | background changes on pointer down, transition 0s |

The assertions: the bottom is reached by 150ms and stays reached, the arrow is hidden by 150ms, the latest row is visible, no horizontal overflow. Content-visibility rows are seeded as `auto` so heights change after the jump; the code keeps follow intent until wheel, touch, key or pointer input cancels it.
