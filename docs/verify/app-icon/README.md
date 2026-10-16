# App icon 6b: evidence

Design source: Doop canvas https://doop.design/c/DJIx3ExrCm (frames "6b · macOS grid").

- `before-after.png`: old and new icons on every place they show up. macOS icon at 256, AppIcon.icns slots 16/32/64/128 at actual pixels on light and dark, browser tab favicon, sidebar brand mark, PWA icons (maskable shown with a circle crop).
- `sidebar-light.png`, `sidebar-dark.png`: the running app (fixture build, `vite preview` on 8399, `/app?scenario=01`), DSF 2. The brand mark is `logo.svg` used as a 16x16 mask at 100%.
- `check_icons.py`: sizes, macOS tile corner transparency, maskable safe zone, and distinct colours in the mark. Run `python3 check_icons.py <dir>` on a folder holding the icon files.

Regenerate every icon file with `node scripts/generate-app-icons.mjs` (macOS, needs `iconutil`).
