# Packaged-journey and visual-baseline gates

## Edge-case table

| Case | Required behavior | Control |
|---|---|---|
| A feature has no real walk when the ratchet starts | It is listed in `.claude/skills/verify-cairn/packaged-journey-baseline.json`, and changing its files does not require a walk | the checked-in registry and baseline pass |
| A `shipped` or `partial` feature is not on the baseline (new, or taken off) | A registered journey covers it in `local-server` and in `remote-server`; otherwise `check` fails and names the missing mode | unit control |
| A change adds an id to the baseline | Red against the merge base: the list only shrinks | unit control |
| A journey covers a feature that is still listed | Red until the id is removed, so the coverage cannot be lost again | unit control |
| A listed id is unknown or `planned` | Red | invariant |
| A journey lists a feature it never drives | Red: the walk must pass one of the feature's `testid:` reach steps to `getByTestId` or a `data-testid` selector, or navigate to one of its static routes. A feature with neither cannot be claimed until its feature-map row gains one, so a feature name in a string proves nothing | the hollow `step-claim` walk (a constant asserted to be a string) is red |
| A journey performs no UI action or asserts nothing | Red | unit control |
| A journey is registered without a walk file, or names an unknown feature or mode | Red | registry validation |
| A walk file is in `apps/desktop/scripts/journeys/` but not registered | Red: the runner starts only registered walks, so the file would never run | `coordinator-chat.mjs` and `thread-transcript.mjs`, added by `1b5eee7ee` without entries, are red |
| A packaged-app workflow stops running the journeys | Red: `desktop-mac.yml` and `desktop-release.yml` must call `apps/desktop/scripts/packaged-journey.mjs`; the runner walks every registered journey in each of its modes, so no per-workflow case list can drift | registry validation |
| The remote walk silently runs against the app's own server | The walk fails unless the window origin is the seeded remote server | packaged run |
| The remote server asks the app to sign in | The runner gives the scratch server its own access token and enters it in the app's access-token form before the walk, then refuses the pairing request the sign-in screen itself created; without that the walk fails on the sign-in screen | packaged run |
| The app under test installs the published release over itself (an unreleased build reports a lower version) | Each walk launches its own copy, and a workflow that walks the build output after `pnpm smoke` is red: `desktop-mac` walks first | `desktop-mac` run 45758615586 walked the published release and is red on a layout the build had fixed; `6f5c86d50` is red in the gate |
| A journey touches the real user home | Both modes run with a scratch `HOME` and no inherited `CAIRN_HOME` | packaged run |
| Several features are uncovered | All are reported at once; one journey covers several only when it drives each | gate output |
| Escape hatch | None. A new feature, or one taken off the baseline, carries its walk in the same change | — |

What this gate does not prove: the check is static. It shows that a walk reaches the feature's surface, not that its assertions test that feature or the changed behavior, and a change to a feature on the baseline ships without any packaged walk. The wrap-up cites the packaged-app run id.

| Visual case | Required behavior | Control |
|---|---|---|
| Pixels change on a surface the change did not name | The visual spec fails with actual, expected and diff images uploaded; comparison is exact (`threshold: 0`, no differing pixels), so a colour-only change counts | CI run 45751814764 |
| Pixels change on a surface the change did name | The surface's baseline is refreshed in the same diff and a commit declares it | positive control |
| A baseline is modified, or removed together with its surface, without `Visual-Surfaces:` naming it (or `all`) | `check` fails; removal is allowed once declared | unit control |
| A baseline is deleted or renamed while its surface remains registered | `check` fails even when declared (renames are listed as delete plus add) | unit control |
| A new surface arrives with its baselines | Pass | unit control |
| A diff touches a file under `apps/web/src/components` that two or more pages render | Pages are discovered from the source tree (`*-page.tsx` plus the board, thread and coordinator views), following runtime imports and not walking through another page; every one needs a surface with light and dark baselines | removing the `thread` surface is red for `message-body.tsx` |
| A new page appears without a surface and renders shared components | Red | inventory test |
| Only types are imported | The page does not count as rendering the component | unit control |
| Code highlighting is switched off | No highlight token renders, so `coordinator-chat-markdown-code-highlighting` fails in light and dark before any pixel comparison; the check waits for asynchronous highlighting | CI run 45751814764 |
| Keywords render but are painted like body text | Each named keyword token must differ in computed colour from the code block's text colour | colour assertion |
| A web source change selects no feature spec | The affected run still includes the visual spec; Markdown alone does not | selector tests |
| Font or browser noise | Fixed clock and timezone, reduced motion, disabled animations, fixture data; a flake is fixed or the surface removed, never masked by a tolerance | two CI runs |
| Escape hatch | `Visual-Surfaces: all` is the only broad declaration, for global token or theme changes | — |

What this gate does not prove: each surface compares one default state of a page at 1440x900; dialogs, menus, hover states and narrow windows are compared only when they get their own surface.
