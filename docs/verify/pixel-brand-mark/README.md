# Pixel pac-man in the sidebar brand slot

`shots.mjs` loads `/app?scenario=22d` from two fixture builds and captures the
sidebar workspace row in light and dark: `before` is `main` at `4f3f9b54`
(served on 28400), `after` is this branch (served on 28410). It then clicks the
Pacman name on the `after` build and captures the row on `/app/team`.

`result.json` is its output: the brand mark's text, box, mask image and paint
colour for each build and theme, the URL after the click, and the page error
count.

| file | what it shows |
| --- | --- |
| `before-head-light.png`, `before-head-dark.png` | `main`: 24px accent tile with a serif "P" |
| `after-head-light.png`, `after-head-dark.png` | this branch: 16px `logo.svg` mark in the row ink |
| `after-sidebar-light.png` | the full sidebar on this branch |
| `after-team-active-light.png` | the workspace row after clicking the name (`/app/team`) |
