# Showcase concept art

Owner decision on 2026-10-27 supersedes the recording implementation for this delivery: generate images now, wire them into the website and both READMEs, and leave image acceptance to the owner before merge. Real recordings, deployed application evidence and sourced metrics are not delivered here. The illustration disclaimer remains.

## Assets and prompts

Assets are in `site/media/showcase/`: `bootstrap-loop.png`, `app-from-scratch.png`, and `harness-comparison.png`. All decode as 1586 by 992 PNGs. Generated using the built-in Codex image generation tool. Subject prompts are recorded in `prompts.json`.

Shared prompt: Use case illustration-story; Cairn website showcase concept art; premium editorial 3D illustration, tactile matte stone and paper, dark charcoal warm black backdrop, one muted amber accent, ivory highlights, generous negative space, restrained cinematic lighting, landscape 16:10 composition. No text, letters, digits, logos, watermarks, real UI screenshot or performance evidence.

The bootstrap image follows the claim, build, review and human gate progression in the issue comments. No existing Pacman recordings were reused. The other two images illustrate application assembly and harness routing, without claiming measured results.

## Verification

- `python3 docs/verify/1667/check.py`: fails on original placeholder content (`red.log`); passes with shared assets and honest labeling (`green.log`). Checks actual PNG dimensions against markup; `dimensions-red.log` captures the incorrect width negative control.
- Headless Chromium opened the actual static HTML through a file URL, decoded all three images, and captured the showcase at 390 and 1440 pixel viewport widths in light and dark themes. All images decoded successfully. No server was started.
- `pnpm lint`, `flock /tmp/cairn-heavy.lock pnpm typecheck`, and `pnpm spec:parse`: passed.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: exit 0; no related Vitest tests selected. This is not evidence of product behavior.
- English, single-use helper and comment discipline gates: zero violations.

## Overlap

Read-only GitHub PR lists confirmed open #1769 touches `site/index.html`, and open #1727 touches `README.md`. Only showcase content and its image styles changed; unrelated lines were preserved. No recently merged showcase additions were identified in the latest 30 merged PRs. Existing unused animation styles remain to avoid an unrelated CSS cleanup.

## Review boundary

The owner must review the generated images before merge. This delivery does not fulfill the original issue's live recording and metric requirements. The commit message follows the owner's requested closing trailer; that trailer is not a claim that those original evidence requirements were met.
