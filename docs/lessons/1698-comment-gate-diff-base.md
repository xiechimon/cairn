---
Category: `comment-discipline-gate` diffed the working tree straight against `origin/main`, so a branch behind main saw main's newer comment lines as its own additions and pre-push went red on a file the branch never touched
Source: #1698 (2026-10-25)
Level: 2
Safeguard: `scripts/comment-discipline-gate.mjs` diffs against `git merge-base origin/main HEAD` when no base is given; CI still passes the exact PR base in `COMMENT_DISCIPLINE_BASE_SHA` (its checkout is shallow, so a merge-base there fails)
Intercepts: 0
Recurrences: 0
Notes: Negative control: branch head d5123a6 behind main ad4bf4e reported `packages/shared/src/brand.ts:143` with the old gate and 0 lines with the fix; a planted `// planted comment` in `apps/web/src/i18n/locale.ts` still reports 1 line
---
