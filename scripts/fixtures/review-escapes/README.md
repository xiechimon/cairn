# Review escape fixtures

`gate.json` records the relevant REST fields from PR #2120 and its production gate comments, captured on 2026-10-28. Each comment retains its published identity, URL, timestamps, header, and patch marker. Direct review transcripts are omitted. Carried-over comments are complete. The source endpoints are recorded in the JSON file.

The CLI tests also build controlled formal review responses using GitHub REST field names. Those identities and dates are synthetic. They cover human reviews, known AI bot reviews, mixed reviews, pending reviews, unknown bots, stale heads, and post-merge reviews. The temporary REST response files also supply empty pages and API errors. No synthetic identity is presented as a recorded production reviewer.

The multiweek scenario has 6 qualifying events across three UTC weeks, including one exactly at the inclusive 14-day boundary, one unresolved event, two events outside the 14-day window, and one duplicate record. Qualifying events include two with unknown review paths, one of which has unavailable API data.
