---
Category: The avatar change only touched the avatar component; the standalone glyph for an unbound chief (the dashed small face) was missed, which ian caught in a screenshot
Source: #1429 (2026-10-25)
Level: 2
Safeguard: `avatar-spiral.spec.ts` "the unbound chief wears the spiral face" pins the avatar slot of an unbound chief; the old icon `ChiefFaceDashed` has been deleted and cannot be referenced again
Intercepts: 0
Recurrences: 0
Notes: Same-class practice: when changing a visual identity, first search every component that draws a "face", not just the avatar component
---

