# Retire team attribution and first-PR sharing

Decision: the personal edition removes human co-author injection, task-initiator review invitations and first-PR community sharing, including their account settings and API fields. Device push and the existing primary bot identity remain. Historical database columns and migrations remain untouched and ignored. Switching the primary identity is a separate change.

## UI brief

Surface: account settings. Goal: remove the three rows without replacing them with placeholders. Reference: `docs/design/references/settings/t3code-chat.png`, for a quiet settings navigation and aligned label/control rows. Rules checked: P1, P3, P5, C3, C6, V1, V4, V10. No new screen, interaction or visual component is introduced, so the existing settings layout is retained.

| Component | Affected states and acceptance |
| --- | --- |
| Account settings | Live 1440px and 390px, light and dark: three retired rows absent, account/name/language and notification rows retained; no horizontal document overflow. |
| Settings search | Retired settings no longer indexed. |
| First-PR reminder | No banner, dismiss state or sharing action, including when historical settings are enabled. |
| Device push | Existing supported-browser enabled/disabled subscription paths retained; fixture-only mode still hides device-only controls. |

No new loading/error/offline/pending-question state exists for a removed row. Existing device push behavior is not redesigned. The account page is intentionally sparse after deletion; mobile settings tabs retain their existing horizontal-scroll affordance and chevron.

## Behavior and compatibility

The team response omits the three retired settings. A PATCH containing only retired fields is rejected as having no supported setting. Remaining autonomy settings retain their validation. Old stored values never activate removed behavior. Machine credentials no longer carry a co-author field. Task publication still normalizes unpublished author and committer to the existing configured identity but does not add trailers; already-published commits and trailers a user intentionally wrote are not rewritten or stripped. GitHub merges and local squash messages no longer append human trailers. PR watch no longer reconciles attribution/review requests. Task completion no longer records first-PR reminder state.

Red/green validation uses public API calls with enabled historical values and a real git repository for publication. Live browser checks cover all four theme/width combinations and the retained device-push subscription lifecycle. Schema snapshots deliberately lose the retired response/wire fields. Dedicated tests whose sole purpose was exercising removed functionality are deleted.
