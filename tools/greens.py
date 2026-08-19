#!/usr/bin/env python3
"""
The arena plate, the app icons, and the floor mark cut from one of them.

    python3 tools/fire-sheets.py && python3 tools/greens.py

The flame sheets are NOT here any more. They used to be recoloured in this
second pass, which meant re-encoding a WebP that had just been written — the
profile frame went out at quality 74 having been made at 84. Each of those is
rotated while it is generated now and encoded once; see tools/fire-sheets.py.

The arena had the same fault and worse: it was a JPEG recoloured from a JPEG,
so it carried two lots of encoding loss on the app's single most-looked-at
image. It is built from backgroundarena.png, the lossless original, and written
as WebP — which at this size is both sharper and smaller than the JPEG it
replaces.

The contrast and colour lift is the point of that: the arena is a dark picture
under a heavy scrim, and the scrim cannot lighten without letting the flames
fight the text. Putting the contrast into the plate instead makes the greens
carry through the scrim rather than trying to see past it. The unsharp mask is
for the upscale: the art is 852 wide and a phone at 3x asks for more than that,
so the browser enlarges it either way — sharpening before it does is the only
part of that we control.
"""
import sys
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hue import rotate_to_target, FROM

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public'

# --- the arena -------------------------------------------------------------
arena = Image.open(ROOT / 'backgroundarena.png').convert('RGB')
arena = rotate_to_target(arena, FROM['arena'])
arena = ImageEnhance.Contrast(arena).enhance(1.16)
arena = ImageEnhance.Color(arena).enhance(1.24)
arena = arena.filter(ImageFilter.UnsharpMask(radius=1.2, percent=62, threshold=3))
arena.save(OUT / 'arena.webp', 'WEBP', quality=90, method=6)
print(f'arena.webp: {arena.size[0]}x{arena.size[1]}, '
      f'{(OUT / "arena.webp").stat().st_size / 1024:.0f} KB')

# --- the icons, and the mark cut out of one ---------------------------------
ICONS = ['icons/icon-192.png', 'icons/icon-512.png',
         'icons/icon-maskable-512.png', 'favicon.png']
for rel in ICONS:
    src = ROOT / 'icon-sources' / Path(rel).name
    if not src.exists():
        src = OUT / rel                      # first run: recolour in place
    im = Image.open(src)
    im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
    rotate_to_target(im, FROM['icon']).save(OUT / rel, 'PNG', optimize=True)
    print(f'{rel}: -> {(OUT / rel).stat().st_size / 1024:.0f} KB')

# The mark burned into the floor is the sigil off the WALL, not the app icon.
# The icon is a flat silver S drawn on a tile; laid on stone it read as a decal
# stuck to the floor rather than as part of the room. The wall carries the same
# mark cut in cracked stone with the green running through it, and the floor is
# the same room, so the floor now carries that one.
#
# Ring centre and radius were measured on the finished arena: (422, 602) r=156.
# Luminance becomes alpha exactly as before, so it floats free of the wall
# behind it; the 26/3.2 curve is what makes it read as carved at 0.66 opacity
# under a 0.323 squash — as cut it disappeared into the stone, and any stronger
# it started looking like a sticker again.
CX, CY, RAD = 422, 602, 156
sigil = arena.crop((CX - RAD, CY - RAD, CX + RAD, CY + RAD))
sigil.putalpha(sigil.convert('L').point(
    lambda p: 0 if p < 26 else min(255, int((p - 26) * 3.2))))
mark = sigil.resize((320, 320), Image.LANCZOS)
mark.save(OUT / 'floor-mark.webp', 'WEBP', quality=92, method=6)
print(f'floor-mark.webp: {(OUT / "floor-mark.webp").stat().st_size / 1024:.0f} KB')
