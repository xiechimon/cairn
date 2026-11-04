# #948 domain construction · overlay/ family — verification evidence index

Four per-face CSS files zeroed (overlay.css 644 / mention-picker.css 446 / slash-menu.css 117 /
attachment-strip.css 115, totaling 1322 lines); 18 bare controls collected into 17 (the remaining 1 =
the new-task-dialog hidden file input, an existing #855 deliberate-native ruling); the chip family
skin migrates to the `overlay/mention-chip.ts` single source (solid sealed slot pairs, the color-slot
mapping's provisional canon in that file's header note). The acceptance template v2's seven items,
artifact by artifact:

| directory/file | content | acceptance item |
| --- | --- | --- |
| `live-stack/drive-948-overlay/` | verify-pacman custom probe (script canon `.claude/skills/verify-pacman/scripts/drive-948-overlay.mjs`): live-stack real-user path **34/34 PASS** (itemized in result.json), 10 screenshots (8 dark + 2 light). Includes computed artifact assertions of the utility migration (frozen-anchor 39.5/96.5, row bands 40/37/41/45, picker 400 wide centered transform:none, close 28×28 hugging the right edge at 4px, backdrop z=40) and zeroing runtime mechanism assertions (vite stylesheet enumeration: the four retired CSS files never load, zero resident retired selectors on non-carrier layers). | 4 |
| `contrast-948.md` + `contrast.json` | better-colors in-domain measurement (script `scripts/contrast-948.mjs`, single token source shadcn.css, WCAG 2.x real computation, no estimating): **48 pairs (dark 24 / light 24) all PASS, FAIL 0**. The first round's 4 FAILs (chip 15% tint shape in light at 4.0~4.3:1 below text 4.5 ×3, keep button --text-dim in light at 2.89:1) were zeroed after swapping the consumer-face slot references per #908 ruling 2: the chip family moved to solid sealed slot pairs (same shape as StatusChip §5.2), the keep button --text-dim → --muted-foreground (same cure as the #943 notify-banner). | 3 |
| `probe-dump/` | the #921 probe dump comparison table (12 specs in this domain): **visual rows 38 — KEPT 38 / DRIFT 0 / VIOLATION 0 / NOT-RUN 0**. 1:1 utility migration with zero drift; probe-comparison.md is the human-review diff record. | 2 |
| `build-artifact-grep.txt` | compiled-artifact CSS mechanism grep (over dist/assets/*.css after `pnpm --filter @pacman/web build`): zero hits for the four retired files' characteristic selectors; `.more-menu-item`/`.new-task-*` survive only as motion.css #73-family hover laws and the app.css backdrop z ladder (carrier layers, whitelisted). | 5 |
| `local-full-e2e.log` | tail of the local full e2e (one run before merging, E2E_PORT 8401). | 1 |

The e2e re-pin face (#910 rulings 1/2): 10 of this domain's 13 specs have pin couplings, all of which swapped semantic carriers with this PR (first-class role/label/text + 6 new secondary testids: new-task-head /
new-task-tools / new-task-project-chip / new-task-machine-dot / new-task-spec /
attachment-pending / composer-float — 7 in total, the blind spots being structures without role hooks); token-gate / dialog-viewport / collapse-family's three spec focus sets had zero hits (measured by inventory), no re-pin face. Cross-directory specs' (composer-inline-mention / composer-slash / composer-paste / hotkeys) class-name hooks all survive in the DOM as-is (alias residue is legal), belong to the domain tickets' re-pins, and were not touched by this PR.

Stack coordinates: the live probe ran on the isolated stack `VERIFY_PORT=8797 / VERIFY_WEB_PORT=5279` (8791/5273 and 8795/5277 were held by a neighbor lane; the neighbor's processes were left untouched); PACMAN_HOME = the worktree's `.claude/verify-run/home` fresh library; the probe runs `cleanup` to recycle right after finishing.
