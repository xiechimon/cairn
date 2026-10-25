---
Category: The avatar swap only changed the avatar component; the standalone glyph for the unbound chief (the dashed little face) was missed, and ian called it out with a screenshot
Source: #1429 (2026-10-25)
Level: 2
Safeguard: the "the unbound chief wears the spiral face" case in `avatar-spiral.spec.ts` pins the avatar slot of the unbound chief; the old `ChiefFaceDashed` icon was deleted and cannot be referenced again
Intercepts: 0
Recurrences: 0
Notes: same-class practice: when swapping a visual identity, search every component that draws a "face", not just the avatar component
---
