# Coordinator interaction brief

Surface: Coordinator chat and shared conversation traces.
Goal: Flat, immediate hover and press feedback; conversation scrolling stays in its pane.
Rules: P1, P3, P4, P5, C11, V1, V7, A2, R1.
Reference: `docs/design/references/coordinator-chat/claude-ai-mobile-reply-actions-light.jpg`; retain compact message tools and a flat text surface.
Draft: exempt, fixes to existing controls with owner-specified behavior.

| Component | States | Production method | Acceptance |
| --- | --- | --- | --- |
| Summary | closed, open, pressed, keyboard focus, light/dark | API-mocked app | no copy, no box shadow; keyboard outline retained |
| Expanded rows | thinking, command, read, search, edit, tool, hover/press | API-mocked app | zero transition duration, no box shadow |
| Conversation | long inline command, fenced code, 1440/375, light/dark | API-mocked app | viewport scrollWidth <= clientWidth; code alone scrolls; overscroll axes not auto |
| Unchanged states | empty, loading, offline, pending question | existing affected tests | no intended behavior change |

Failure modes: inherited Button active inset shadow; inherited transition-all background fade; message tool opacity fade; long inline code intrinsic width; unconstrained flex ancestors; overscroll containment still allowing rubber-band feedback.

Measured feasibility: shared trace primitives and MessageScroller already serve both conversation surfaces. The detail WorkTrace owns the extra summary copy action. Browser regressions exercise computed CSS rather than class strings. No dependency or lockfile change is needed.

Plan: record failing browser tests and before captures, fix primitives and ancestor sizing, update gallery, rerun regressions and required gates, archive after captures and metadata. Owner action: orchestrator commits and publishes; this lane leaves the git directory untouched.
