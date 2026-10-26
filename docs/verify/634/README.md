# #634 evidence — detail page trio (tool echo / chip hotzone / layered ESC)

Stack: verify-pacman isolated live stack (server 8797, web 5279, scratch
PACMAN_HOME). The transcript was seeded with the exact shape measured in the
user's live DB: a `set_task_meta` toolcall row plus its role=system result
echo (`msg-<step>` text block wrapping the result JSON), so the before shots
reproduce the reported page byte-for-byte in structure.

| file | shows |
|---|---|
| `before-tool-echo.png` | expanded tool group with the raw JSON output slab + the centered JSON echo note (the two red circles of the user report) |
| `before-chip-chevron.png` | chevron click opens nothing — the dead half of the chip trigger |
| `before-esc.png` | ESC on the detail page does nothing |
| `after-tool-echo.png` | expanded group = footer + slim pill + collapse; no JSON slab, no JSON note |
| `after-chip-popover.png` | chevron click opens the popover (whole chip is one trigger) |
| `after-mention-inline.png` | ESC with the mention inline open closes only the inline, detail stays |

Mechanical pins: `apps/web/test/transcript-tool-echo.test.ts` (5/5) and
`apps/web/e2e/chip-hotzone.spec.ts` + `detail-esc.spec.ts` (5/5). The fourth ESC layer (mention
inline) is pinned here rather than in e2e because the fixture composer is a
static div — it needs the live stack.

`result.json` carries the per-check ok list.

## Follow-up (the `复制 | 完成 Ns ›` row)

Re-measured against the live reference on 2026-10-02: the footer copy is a
real button (robot row copies the message markdown, the user-row icon pair
copies the todo markdown link), and the footer chevron only exists as a
tool-group expander — done-phase footers carry none. Our copy icon was
inert on every row and the robot/plan footers carried an inert `›`.

| file | shows |
|---|---|
| `after-footer-copy.png` | wired copy button on the tools footer (clipboard payload `set_task_meta`), chevron only on the group expander (plan=0, agent=0, tools=1) |

Pins: `apps/web/e2e/footer-copy.spec.ts` C1-C4 (clipboard readback +
chevron counts). Full suite 601/601 after the ruling.
