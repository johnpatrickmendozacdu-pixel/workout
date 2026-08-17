#!/usr/bin/env python3
"""
Pulls every green in the app onto one hue.

    python3 tools/greens.py

The app had five different greens by accident: the arena artwork at hue 80, one
fire sheet at 97, another at 129, the profile frame at 137, the CSS accent at
144 and the floor ring at 158. Individually each looked fine; together they read
as a palette that had never been decided.

TARGET is the floor ring's own hue, because that asset is the reference Johnny
chose. Everything else is rotated onto it.

Only saturated pixels are moved. The arena is mostly desaturated stone, and
rotating grey does nothing but tint it — the guard is what keeps the room stone
rather than turning it green.

Saturation and value are untouched throughout: this changes WHICH green, never
how bright or how vivid, so nothing that was tuned by eye has to be tuned again.
Re-run after regenerating any sheet.
"""
import colorsys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TARGET = 156.0          # degrees — the floor ring's median green
MIN_SAT = 0.18          # below this a pixel is stone, not paint

# file -> the hue it is being moved FROM (its own measured median)
JOBS = [
    ('arena-source.jpg',        'public/arena.jpg',              80.0),
    ('public/fire-body.webp',   'public/fire-body.webp',        129.0),
    ('public/fire-column.webp', 'public/fire-column.webp',       97.0),
    ('public/fire-frame.webp',  'public/fire-frame.webp',       137.0),
    ('public/floor-ring.webp',  'public/floor-ring.webp',       158.0),
    ('public/icons/icon-192.png',        'public/icons/icon-192.png',        85.0),
    ('public/icons/icon-512.png',        'public/icons/icon-512.png',        85.0),
    ('public/icons/icon-maskable-512.png','public/icons/icon-maskable-512.png',85.0),
    ('public/favicon.png',      'public/favicon.png',            85.0),
]


def rotate(img, delta):
    """Hue-rotate the saturated pixels of an RGB(A) image by delta degrees."""
    has_alpha = img.mode == 'RGBA'
    alpha = img.getchannel('A') if has_alpha else None
    rgb = img.convert('RGB')
    px = list(rgb.getdata())
    out = []
    d = delta / 360.0
    for r, g, b in px:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s >= MIN_SAT:
            h = (h + d) % 1.0
            r2, g2, b2 = colorsys.hsv_to_rgb(h, s, v)
            out.append((int(r2 * 255 + .5), int(g2 * 255 + .5), int(b2 * 255 + .5)))
        else:
            out.append((r, g, b))
    rgb.putdata(out)
    if has_alpha:
        rgb = rgb.convert('RGBA')
        rgb.putalpha(alpha)
    return rgb


for src, dst, from_hue in JOBS:
    p_in, p_out = ROOT / src, ROOT / dst
    if not p_in.exists():
        print(f'skip {src} (missing)')
        continue
    im = Image.open(p_in)
    im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
    moved = rotate(im, TARGET - from_hue)
    if p_out.suffix == '.jpg':
        moved.convert('RGB').save(p_out, 'JPEG', quality=86, optimize=True)
    elif p_out.suffix == '.webp':
        moved.save(p_out, 'WEBP', quality=74, method=6)
    else:
        moved.save(p_out, 'PNG', optimize=True)
    print(f'{dst}: {from_hue:.0f} -> {TARGET:.0f}deg, '
          f'{p_out.stat().st_size / 1024:.0f} KB')
