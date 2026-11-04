# Agent batch brief

## Orb setup and resume

Run `.agents/setup` for a fresh orb. It enables Corepack, installs the frozen
dependencies, installs and checks the Husky pre-push hook, and installs Playwright
Chromium into `$HOME/.cache/ms-playwright`. It is safe to rerun and starts no server.

Run `.agents/resume` when returning to an orb. It fetches Git refs and installs from
the offline pnpm store within a shared nine-second budget. Failures are non-fatal;
rerun setup if dependencies are unavailable.

## Orb ports

Inside an orb, `E2E_PORT` and the heavy-slot ports are private to the container.
Other orbs can use the same port numbers. Processes inside one orb still share its
ports and heavy slots; follow the existing slot and port allocation rules there.
