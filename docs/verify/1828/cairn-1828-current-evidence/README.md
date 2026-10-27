# Work trace reconciliation evidence

The branch includes main 101877c8d, including chief stop/queue behavior and provider network retries. The work-trace mapper, transcript rendering and runner tool timestamps were reviewed together.

## Failure modes

- A stopped call appears completed or keeps spinning.
- A failed edit hides its error behind requested change lines.
- Thinking and tool groups lose boundaries or truncate long summaries incorrectly.
- Overlapping calls or a resumed provider session lose their individual timestamps.

## Results

The focused browser run passed 15 cases across detail-work-trace, thinking-row-truncate and chat-tools-identity. The runner and mapper regression run passed 25 cases. They exercise stopped and running rows, error output, grouping, width, motion, timestamp relay and uploaded transcript values.

The screenshot is the browser fixture from the current branch. It does not establish a live provider run or deployment. The older real-run screenshots and recording in docs/verify/work-trace are retained as historical evidence from the original implementation.

The initial merge produced a duplicate comma translation key; Biome rejected it. Main's identical single mapping is retained. The legacy lesson row is preserved as a per-entry file, and both branches' helper exceptions are retained.
