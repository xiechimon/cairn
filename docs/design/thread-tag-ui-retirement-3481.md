# Thread-tag UI retirement brief

## Scope and source

This is the UI-only segment of the [approved retirement](../research/thread-tags-retirement-3481.md), after label isolation in #3782. Audited main: db61ebe0a8a9e10f9badc52d55ca1057df703dab. No new mechanism or reference-product behavior is proposed.

Project settings still lists a Tags tab, but selecting it renders the same general settings content. `useTags` and `useProjectTags` have no consumers. The web mutation type still advertises an unused generic category replacement. Remove that entry and those unused client surfaces now; preserve all existing project, memory, task and GitHub-label behavior.

Backend tag routes, persisted categories, wire records, agent tooling and final registry/spec cleanup remain for subsequent segments. This change neither drops data nor closes #3481.

## UI brief

Surface: project settings.

Goal: stop offering thread-tag configuration without removing GitHub labels or changing the working settings.

Rules: P1, P2, P3, P5, C2, C3, V1, V10, A2, R1. Existing components, tokens, focus handling and layout are unchanged. Deleting the tab must remove its layout space, not hide a disabled control.

References opened before code:

- `docs/design/references/settings/t3code-general.jpg`: grouped working settings, no duplicate placeholder destination.
- `docs/design/references/settings/t3code-mobile-settings.png`: readable settings navigation at phone width.

Draft: exempt, retirement of one existing setting entry; no new feature or layout.

| Component/state | Production or observation |
|---|---|
| General settings | Isolated live project; compare main and changed page at 1440 and 390 in light/dark. |
| Repository and memory navigation | Existing controls remain available; targeted browser regression. |
| Empty/missing category vocabulary | Irrelevant to tab availability: entry is absent regardless of stored categories; no tag query is emitted. |
| Loading/error/offline project data | No new state branch; existing settings data handling remains unchanged. No new coverage claimed for these states. |
| Long project name/pending question | Unchanged existing components, not new retirement states. No new coverage claimed. |
| GitHub issue labels | Existing issue picker tests retain chips, color and import behavior. |

## Acceptance

1. Red-first source contracts reject the settings entry and unused category hooks/mutation field before removal.
2. Browser contracts prove no Tags tab and preserve Basic, Repository and Memory at both widths/themes; measure horizontal overflow.
3. Real isolated stack captures the main settings state before and after, with no production data, external provider or GitHub calls. Fixture browser evidence remains labelled separately.
4. Reference-versus-ours rows describe the unchanged settings composition and the removed entry; list uncovered states honestly.
5. Existing task mapping, project editing and GitHub issue regressions pass. Run lint, typecheck, spec parse and prepush; CI and fresh cloud review must pass on the PR head.
