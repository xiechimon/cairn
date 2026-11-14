import sys

from PIL import Image, ImageDraw

SCREEN_SCALE = 3
OUTPUT_SCALE = 2
CORNER_POINTS = 55

source, target, border = sys.argv[1], sys.argv[2], sys.argv[3]
shot = Image.open(source).convert("RGBA")
size = (shot.width * OUTPUT_SCALE // SCREEN_SCALE, shot.height * OUTPUT_SCALE // SCREEN_SCALE)
shot = shot.resize(size, Image.Resampling.LANCZOS)
radius = CORNER_POINTS * OUTPUT_SCALE

supersample = 4
mask = Image.new("L", (size[0] * supersample, size[1] * supersample), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    (0, 0, mask.width - 1, mask.height - 1), radius * supersample, fill=255
)
shot.putalpha(mask.resize(size, Image.Resampling.LANCZOS))

outline = Image.new("RGBA", (size[0] * supersample, size[1] * supersample), (0, 0, 0, 0))
ImageDraw.Draw(outline).rounded_rectangle(
    (0, 0, outline.width - 1, outline.height - 1),
    radius * supersample,
    outline=border,
    width=2 * supersample,
)
shot.alpha_composite(outline.resize(size, Image.Resampling.LANCZOS))
shot.save(target)
