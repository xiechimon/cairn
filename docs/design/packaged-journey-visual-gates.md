# Packaged-journey and visual-baseline gates

## Edge-case table

| Case | Required behavior | Control |
|---|---|---|
| A diff touches a file owned by a `shipped` or `partial` feature-map row (`code`, `verify` or `evidence`) | The candidate tree registers a packaged-app journey covering that feature in `local-server` and in `remote-server`; otherwise `check` fails and names the missing mode | Today's registry replayed over `bbf7d78bd` (Antigravity re-sign-in) is red on `providers` |
| The diff of the update button that was dead in remote mode | Same failure with `remote-server` named; local coverage never satisfies it | Today's registry replayed over `67299d5d4` is red on `server-status` |
| A diff touches no feature-owned path, or only a `planned` row | Pass | `f9b6c3340` is green |
| A feature row is added or changed in `feature-map.json` | The new or changed `shipped`/`partial` row needs both modes | merge-base row comparison |
| A feature file is renamed out of its row | The old path still counts (`--no-renames`) | diff listing |
| A journey lists a feature it never drives | Red: `apps/desktop/scripts/journeys/<id>.mjs` must name one of that feature's own test ids or static routes (feature id when the row has neither) | `providers` appended to `new-task` is red |
| A journey is registered without a walk file, or names an unknown feature or mode | Red | registry validation |
| A packaged-app workflow stops running the journeys | Red: `desktop-mac.yml` and `desktop-release.yml` must call `apps/desktop/scripts/packaged-journey.mjs`; the runner walks every registered journey in each of its modes, so no per-workflow case list can drift | registry validation |
| The remote walk silently runs against the app's own server | The walk fails unless the window origin is the seeded remote server | packaged run |
| The remote server asks the app to sign in | The runner gives the scratch server its own access token and enters it in the app's access-token form before the walk, then refuses the pairing request the sign-in screen itself created; without that the walk fails on the sign-in screen | `desktop-mac` run 45749582376 is red with 401; run 45752928529 is green in both modes |
| A journey touches the real user home | Both modes run with a scratch `HOME` and no inherited `CAIRN_HOME` | packaged run |
| Several features are touched | All are reported at once; one journey covers several only when it drives each | gate output |
| Escape hatch | None. Carry the journey in the same candidate, or narrow the diff | — |

What this gate does not prove: an anchor shows the walk reaches the feature's surface, not that it exercises the changed behavior. The wrap-up cites the packaged-app run id.

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
