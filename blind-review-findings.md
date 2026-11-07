# Blind review findings (fresh sub-agent, paired recordings only, 2026-11-07)

Reviewer saw only publish/pairs/*.mp4 (left claude.ai, right cairn), sampled at 3 to 60 fps. Confidence H/M/L.

## Layout and spacing
- 1.1 cairn main column is an inset rounded card on a darker canvas; claude.ai is one flat plane, sidebar flush (H)
- 1.2 sidebar about 288 vs about 245 px (M)
- 1.3 claude.ai nav rows evenly about 34 px; cairn mixes about 30 and 27 px rows with section headers (M)
- 1.4 sidebar collapse: claude.ai removes it and recentres; cairn keeps a 40 px icon rail (H)
- 1.5 composer: claude.ai about 655 px on home, a one-line Reply bar in a chat; cairn two-row 730 px with the Needs-you strip above (H)
- 1.6 user bubble about 60% of the column with 15/10 padding vs cairn single-line 12/8; about 60 px between cairn messages vs 8 to 12 px paragraph rhythm in claude.ai (M)
- 1.7 side panel about 470 px (claude.ai files panel) vs about 330 px cairn thread panel with its own header and composer (H)
- 1.8 settings: claude.ai about 1020x800 modal, 200 px nav, hairline rows; cairn about 1215 px sheet over the app sidebar, breadcrumb, 240 px nav, bordered cards (H)
- 1.9 palette about 670 px centred on the main area vs about 640 px centred on the main panel (M)
- 1.11 at 375 the drawer covers about 96% vs about 73% (H)
- 1.12 at 375 claude.ai menus are bottom sheets with a grabber; cairn keeps an anchored popover (H)
- 1.13 at 375 cairn stacks two composers plus Needs-you, about 30% of the viewport (H)
- 1.14 375 settings: claude.ai pill tabs, controls under labels; cairn full page, no section nav, 4 to 5 line descriptions (H)
- 1.15 375 files panel: claude.ai centred modal card; cairn full screen (H)
- 1.16 cairn fixture badge "Sample data (scenario ...)" overlaps the header icons (H, fixture artefact)

## Typesetting
- 2.1 claude.ai reply prose in serif for Latin and digits, CJK via fallback; cairn all sans with heavy headings (H)
- 2.2 body about 15 to 16 px on 21 to 22 px vs about 14 px tighter (M)
- 2.3 claude.ai sidebar labels regular 14 px; cairn active row semibold, section headers 11 to 12 px medium (M)
- 2.4 greeting: claude.ai centred serif with a mark; cairn left-aligned serif plus sans date and status line (H)
- 2.5 settings row titles about 13 px vs 12 to 13, group labels 10 to 11 (M)
- 2.6 claude.ai bolds the matched query text in palette results; cairn does not (M)

## Lines and borders
- 3.1 composer: claude.ai filled surface without stroke; cairn 1 px stroke on a near-flat fill (H)
- 3.2 settings: hairline rows vs bordered cards (H)
- 3.3 focus: claude.ai 2 px blue ring hugging the element radius; cairn 2 px pale ring offset 2 to 3 px, full width on sidebar rows (H)
- 3.4 code block: claude.ai language label, hover copy button, hairline frame; cairn bare block (M)
- 3.5 cairn inline reply box gains a green-tinted focus border (H)

## Color and surfaces
- 4.1 dark: claude.ai sidebar lighter than main (#1F vs #19); cairn sidebar darker than main (#141616 vs #1A1E1B), green tint (H)
- 4.2 light: #FAFAFA/#FFFFFF vs #E6E7E0/#F6F6F2/#FDFDFB (H)
- 4.3 hover strength: claude.ai about +12 levels, cairn about +7 (M)
- 4.4 active row #414141 vs #272929 (dark) / #D3D4CD (light) plus an amber badge (M)
- 4.5 send: claude.ai accent-filled, voice icon when empty; cairn grey ghost arrow (H)
- 4.6 cairn primary buttons invert between themes (H)
- 4.7 toggles blue vs green or dark track, smaller (H)
- 4.8 light settings backdrop about 40% vs about 60% (M)
- 4.9 light palette backdrop about 40% vs about 25% (M)
- 4.10 dark palette surface #2A2A2A with a light border vs #1B1F1C low contrast (M)

## Icons
- 5.1 claude.ai icon on every nav item; cairn mostly status glyphs (H)
- 5.2 claude.ai menu items with icons, submenu chevrons, blue check; cairn none, grey check (H)
- 5.3 reply action row: claude.ai copy, read aloud, thumbs up and down, retry; cairn copy only, and at 375 copy and retry under every message (H)
- 5.5 375 header: claude.ai one icon; cairn three plus a title (H)

## Components
- 6.1 tooltips: claude.ai dark, bordered, below the trigger, with shortcuts; cairn cream with a caret, above, no shortcuts (H)
- 6.2 model menu has separators and submenus; cairn Send-to menu has none (M)
- 6.3 palette: claude.ai filter chips, close button, timestamps, recents when empty; cairn sections, keycap footer, no close button (H)
- 6.5 select: borderless text plus chevron vs bordered small button (M)
- 6.6 jump button: claude.ai 33 px filled bordered circle; cairn near-invisible disc overlapping message text (H)
- 6.8 empty states: illustration plus friendly text vs system-message text (M)
- 6.10 composer chips: Project / model / Auto below vs a setup chip inside and no model shown (H)
- 6.11 cairn working timer showed 1:12 at 3, 8 and 20 s (M, fixture)
- 6.12 sidebar hover: claude.ai shows a + inside the fill; cairn's trailing label overlaps the title without a fade mask (M)

## Motion and timing
- 7.1 settings open: claude.ai fade about 100 to 120 ms; cairn looked like one frame at 10 fps (probe logs show a 200 ms slide) (H)
- 7.2 settings close: claude.ai 150 to 200 ms fade (H)
- 7.4 375 drawer: claude.ai open about 300 ms, close about 200 ms; cairn about 200 ms both (M)
- 7.5 palette open: claude.ai instant; cairn 120 to 150 ms fade (H)
- 7.7 palette results: claude.ai updates once after typing stops; cairn on every keystroke (M)
- 7.8 first scroll to top: claude.ai eases about 450 ms; cairn constant speed about 850 ms then snaps (H)
- 7.9 jump to latest: instant vs 750 to 800 ms ease-out (H)
- 7.10 hover instant on both, cairn faint (M)
- 7.13 streaming: claude.ai fades in the newest words; cairn showed no streamed text (fixture) (M)

## Copy and tone
- 8.1 placeholders: "How can I help you today?", "Reply" vs longer instructional placeholders (H)
- 8.2 claude.ai shows a one-line disclaimer under the chat composer; cairn has none (H)
- 8.3 greeting: playful and rotating vs formal with the date (H)
- 8.4 tooltips describe the action with a shortcut vs short nouns (H)
- 8.5 empty states friendly vs system-like ("Usage unavailable", "No features registered yet") (M)
- 8.7 cairn palette keycap footer (H)
