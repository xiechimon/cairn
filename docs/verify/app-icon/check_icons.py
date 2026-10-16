"""Check a set of pacman icon files: pixel sizes, macOS tile transparency,
maskable safe zone, and how many distinct colours the mark uses (a crisp
pixel mark uses 3; resampled or traced artwork uses hundreds).

Usage: python3 check_icons.py <dir with AppIcon-1024.png, icon-*.png>
"""

import math
import sys
from pathlib import Path

from PIL import Image

EXPECTED = {
    "AppIcon-1024.png": 1024,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon-192-light.png": 192,
    "icon-192-dark.png": 192,
    "icon-512-light.png": 512,
    "icon-512-dark.png": 512,
    "icon-maskable-192.png": 192,
    "icon-maskable-512.png": 512,
}

root = Path(sys.argv[1])
for name, size in EXPECTED.items():
    im = Image.open(root / name).convert("RGBA")
    ok = im.size == (size, size)
    line = f"{name:24} {im.size[0]}x{im.size[1]} {'ok' if ok else 'WRONG SIZE'}"
    px = im.load()
    w, h = im.size
    if name == "AppIcon-1024.png":
        line += f"  corner alpha={px[0, 0][3]}  body-edge alpha={px[512, 101][3]}"
    if name.startswith("icon-maskable"):
        base = px[0, 0][:3]
        far = max(
            (math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) for y in range(h) for x in range(w)
             if px[x, y][3] == 255 and px[x, y][:3] != base),
            default=0,
        )
        line += f"  mark reaches {far / w:.3f} of width from centre (safe zone 0.400)"
    if name in ("AppIcon-1024.png", "icon-512.png"):
        c0, c1 = int(w * 0.25), int(w * 0.75)
        colours = {px[x, y] for y in range(c0, c1) for x in range(c0, c1) if px[x, y][3] == 255}
        line += f"  distinct opaque colours in centre={len(colours)}"
    print(line)
