#!/usr/bin/env bash
set -euo pipefail
: "${SHOTS_DIR:?directory with mac-desktop-<locale>-<theme>.png (3024x1964) and ios-home-raw-<locale>-<theme>.png (1320x2868)}"
: "${BEZELS_DIR:?directory with the Apple product bezel PNGs from https://developer.apple.com/design/resources/#product-bezels}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs/assets/readme"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mask() {
  magick "$1" -alpha extract -threshold 50% -fill red -draw "color $2,$3 floodfill" \
    -fill black +opaque red -fill white -opaque red "$WORK/$4"
}

for theme in light dark; do
  if [ "$theme" = light ]; then
    mac="$BEZELS_DIR/MacBook Pro M5 14-inch Silver.png"
    phone="$BEZELS_DIR/iPhone 18 Pro Max - Silver - Portrait.png"
  else
    mac="$BEZELS_DIR/MacBook Pro M5 14-inch Space Black.png"
    phone="$BEZELS_DIR/iPhone 18 Pro Max - Black - Portrait.png"
  fi
  mask "$mac" 1930 1300 "mac-mask-$theme.png"
  mask "$phone" 735 1500 "phone-mask-$theme.png"
  for locale in en zh; do
    magick -size 3860x2540 xc:none "$SHOTS_DIR/mac-desktop-$locale-$theme.png" -geometry +418+288 -composite \
      "$WORK/mac-mask-$theme.png" -alpha off -compose CopyOpacity -composite -compose over "$mac" -composite "$WORK/mac.png"
    magick -size 1470x3000 xc:black "$SHOTS_DIR/ios-home-raw-$locale-$theme.png" -geometry +75+66 -composite \
      "$WORK/phone-mask-$theme.png" -alpha off -compose CopyOpacity -composite -compose over "$phone" -composite \
      -resize 65.2% "$WORK/phone.png"
    height=$(magick identify -format %h "$WORK/phone.png")
    magick -size 4980x2540 xc:none "$WORK/mac.png" -composite \
      "$WORK/phone.png" -geometry +4020+$((2540 - height)) -composite \
      -trim +repage -resize 2400x -define webp:alpha-quality=100 -quality 86 "$OUT_DIR/hero-$locale-$theme.webp"
    echo "$OUT_DIR/hero-$locale-$theme.webp"
  done
done
