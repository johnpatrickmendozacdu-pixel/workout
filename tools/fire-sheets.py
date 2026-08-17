#!/usr/bin/env python3
"""
Turns the source fire GIFs into sprite sheets the app can animate in CSS.

    python3 tools/fire-sheets.py

Why not just use the GIFs. A GIF cannot be paused, so `html.idle` — which
stops every other animation when the app is not on screen — has no effect on
one, and it would keep decoding in a pocket. A GIF cannot respect
prefers-reduced-motion either, and the app promises a resting state. And the
three sources weigh 6.9 MB against a 156 KB arena, with fire1 alone decoding
to roughly 48 MB of frames in memory.

A sheet is a plain image driven by a CSS steps() animation, so it pauses with
everything else, rests with everything else, and costs no JavaScript.

Each sheet is ONE ROW: frames left to right. The CSS walks it with
background-position, which is why the row is simpler than a grid — one axis,
one steps().

Crop boxes and frame counts live here and nowhere else. Re-run after changing
any source GIF.
"""
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public'

# name: (source, frames to keep, height of one frame in the sheet)
JOBS = {
    'fire-band':   ('fire2.gif', 24, 176),   # the line behind the weapon rack
    'fire-column': ('fire3.gif', 24, 320),   # the three braziers
}


def lit_bbox(im):
    """Union of what is actually lit across every frame — these sources are
    mostly black, and black is the part screen-blending throws away."""
    box = None
    for i in range(im.n_frames):
        im.seek(i)
        mask = im.convert('RGB').point(lambda p: 255 if p > 20 else 0).convert('L')
        b = mask.getbbox()
        if not b:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]),
            max(box[2], b[2]), max(box[3], b[3]))
    return box


def build(name, src, count, height):
    im = Image.open(ROOT / src)
    box = lit_bbox(im) or (0, 0, im.width, im.height)
    cw, ch = box[2] - box[0], box[3] - box[1]
    width = max(1, round(cw * height / ch))
    idxs = [round(i * im.n_frames / count) % im.n_frames for i in range(count)]
    sheet = Image.new('RGB', (width * count, height), (0, 0, 0))
    for slot, fi in enumerate(idxs):
        im.seek(fi)
        frame = im.convert('RGB').crop(box).resize((width, height), Image.LANCZOS)
        sheet.paste(frame, (slot * width, 0))
    path = OUT / f'{name}.webp'
    sheet.save(path, 'WEBP', quality=72, method=6)
    kb = path.stat().st_size / 1024
    print(f'{path.name}: {count} frames of {width}x{height} '
          f'-> {sheet.width}x{sheet.height}, {kb:.0f} KB')
    return width, height, count


def build_frame():
    """The profile frame. Not a sheet — one still picture, used as a
    border-image so a single 282x183 rectangle fits any box: nine slices, four
    corners pinned, only the edges stretched.

    Two things are done to it here rather than in CSS. The dead black margin is
    cropped away, or that padding eats the border slice and the flame lands
    well inside the photo instead of framing it. And luminance becomes alpha,
    so the black drops out with no blend mode — both avatars have
    overflow:hidden, and mix-blend-mode inside a clipped box is an argument
    with the stacking context nobody wins.
    """
    im = Image.open(ROOT / 'fireframe.png').convert('RGB')
    box = im.convert('L').point(lambda p: 255 if p > 26 else 0).getbbox()
    im = im.crop(box)
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    im.putalpha(im.convert('L').point(lambda p: min(255, int(p * 1.45))))
    path = OUT / 'fire-frame.webp'
    im.save(path, 'WEBP', quality=82, method=6)
    print(f'{path.name}: {im.width}x{im.height}, '
          f'{path.stat().st_size / 1024:.0f} KB '
          f'(border-image-slice 37 36 — retune if this crop changes)')


for name, (src, count, height) in JOBS.items():
    build(name, src, count, height)
build_frame()
