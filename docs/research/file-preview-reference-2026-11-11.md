# Attachments and the file preview panel: reference measurements (2026-11-11)

Source: the owner's second Claude Duet screen recording (75 s, light theme, 1878 px wide frames). Shots: `docs/design/references/coordinator-chat/claude-duet-composer-attachment.jpg`, `claude-duet-sent-attachment-uploading.jpg`, `claude-duet-file-preview-panel.jpg`. Scale: 0.725 CSS px per frame px, anchored on 14 px body text (the CJK glyph pitch of a reply). Backend gaps that follow from these measurements are in `docs/design/side-panels-backend-gaps.md`, section "Attachments and file preview".

## What the recording shows

1. A file dragged from the desktop onto the window lands in the composer. No drop highlight is visible in the frames; cairn adds a focus-ring outline on the composer and the placeholder `松开即可添加附件` so the drop target is visible (owner brief).
2. While it uploads, the tile appears as a grey block with the name in a lighter ink and no kind pill for about 0.4 s, then turns white with the pill.
3. Hovering the tile shows a round remove control on its top-right corner; its tooltip is "Remove attachment, <file name>", wrapping to two lines.
4. A 0-byte `test.txt` and an `.xlsx` are both accepted (cairn rejects both today; gaps G-B and G-C).
5. On send the attachment is a card above the user bubble, right-aligned with it, outside the bubble. The card shows the grey upload block for about 2 s, then the white tile.
6. Hovering the sent card fills it grey; clicking it opens the file in the right-hand panel, which folds the sidebar to its toggle and pushes the conversation. None of the header panel toggles is pressed.
7. The panel header holds the file name, copy, download and close. An empty text file shows a box with a single line number `1`. Close restores the previous layout.

## Measurements

| Part | Frame px | CSS px | cairn |
|---|---|---|---|
| Composer tile | 168 × 168, radius 12 | 122 × 122, radius 9 | 122 × 122 (`size-30.5`), `--radius-tile` 10 |
| Tile inset in the composer card | 17 | 12 | 8 top (strip padding) + card padding 8 / 14 |
| Tile name | 4 lines at a 24 px pitch | 12 px text, 17-18 px lines | `text-caption` 12/18, up to four lines |
| Kind pill | 56 × 23 | 41 × 17, outlined | `text-caption`, 1 px inset ring, fully rounded |
| Remove control | 28 circle, centre 3 px inside the corner | 20, centre 2 px inside | 20 (`size-5`), offset 8 px out (centre 2 px inside) |
| Sent card to bubble gap | 11 | 8 | 8 (`gap-2`) |
| Panel width | 587 of 1878 | 426 | shared side-panel width (resizable, same as the other panels) |
| Panel header | 66 | 48 | 48 (`SidePanelHead`) |
| Header glyph pitch | 45 | 32 | 32 (`icon-sm` buttons) |
| Text box offset from header and sides | 11 / 10 | 8 / 7 | 8 / 8 |
| Text box fill and edge | `#f8f8f8`, 1 px `#ebebeb` | – | `--card` with a 1 px `--border` inset ring |
| One-line box height | 47 | 34 | 36 (8 px spacer rows on the 4 px grid) |
| Line-number gutter | 56 wide, 1 px `#e1e1e1` rule | 40 | 40 minimum (`min-w-10`), 1 px `--border` rule, numbers right-aligned in tertiary ink |
| Code text | – | 13 px mono, 20 px lines | `text-code` (13/20), JetBrains Mono |

## Not shown in the recording

Images, PDFs, long files, a failed upload and several attachments at once. cairn fits images to the panel, embeds PDFs in a frame, wraps long lines in the text viewer (the panel is narrow), shows a quiet `无法预览，下载查看` state with a download button for other types, keeps a failed upload as a red-edged tile with `上传失败` and a remove control, and wraps several tiles in rows that scroll after two rows.
