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
# Two textures, alternating. A wall made from a single tile repeats no matter
# how the phases are staggered — the eye finds the tile — so the clusters take
# turns between a fat turbulent body and a thin wispy lick.
#
# fire2 is not used. It is a dense wall with a hard ground edge, and at this
# scale it read as cheap: too even, too solid, too obviously a loop. fire1 and
# fire3 are both irregular enough to stand being repeated.
JOBS = {
    'fire-body':   ('fire1.gif', 24, 260),   # fat and turbulent, the deep bases
    'fire-column': ('fire3.gif', 24, 320),   # wispy, the tall thin licks
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
    """The profile frame, baked SQUARE.

    border-image would have let one rectangle fit any box, and it painted
    perfectly in a desktop browser and not at all on the phone — a difference
    that cannot be tested from the machine this runs on, which makes it the
    wrong tool however neat it is. Both avatars are square, so the nine-slice
    happens here instead, once: corners pasted at their own scale, edges
    stretched to meet them, middle dropped. What ships is an ordinary picture
    stretched over a square box, which has no compatibility question left.

    The dead black margin is cropped first, or that padding lands inside the
    photo and the flame frames nothing. Luminance becomes alpha so the black
    drops out with no blend mode — both avatars have overflow:hidden, and
    mix-blend-mode inside a clipped box is a fight with the stacking context
    nobody wins.
    """
    # fireframebackup.jpg, not fireframe.png. The latter's fire is thick
    # relative to its opening — squared off it ate a third of the box from
    # every edge and left a letterbox for the face. This one is a thin neon
    # line with corner ornaments and a wide clear middle, which is what a
    # frame around a portrait wants to be.
    im = Image.open(ROOT / 'fireframebackup.jpg').convert('RGB')
    im = im.crop(im.convert('L').point(lambda p: 255 if p > 34 else 0).getbbox())
    W, H = im.size
    S, dc = 256, 72                      # dc must stay under S/2 or the edges invert
    scw, sch = int(W * 0.20), int(H * 0.32)
    out = Image.new('RGB', (S, S), (0, 0, 0))

    def put(src, dst):
        w, h = dst[2] - dst[0], dst[3] - dst[1]
        if w > 0 and h > 0:
            out.paste(im.crop(src).resize((w, h), Image.LANCZOS), dst[:2])

    put((0, 0, scw, sch),             (0, 0, dc, dc))
    put((W - scw, 0, W, sch),         (S - dc, 0, S, dc))
    put((0, H - sch, scw, H),         (0, S - dc, dc, S))
    put((W - scw, H - sch, W, H),     (S - dc, S - dc, S, S))
    put((scw, 0, W - scw, sch),       (dc, 0, S - dc, dc))
    put((scw, H - sch, W - scw, H),   (dc, S - dc, S - dc, S))
    put((0, sch, scw, H - sch),       (0, dc, dc, S - dc))
    put((W - scw, sch, W, H - sch),   (S - dc, dc, S, S - dc))

    # A floor before the boost: this source has dim smoke inside its opening,
    # and without the floor that haze survives as alpha and greys the face.
    out.putalpha(out.convert('L').point(
        lambda p: 0 if p < 46 else min(255, int((p - 46) * 1.9))))
    path = OUT / 'fire-frame.webp'
    out.save(path, 'WEBP', quality=84, method=6)
    print(f'{path.name}: {S}x{S} square, {path.stat().st_size / 1024:.0f} KB')


for name, (src, count, height) in JOBS.items():
    build(name, src, count, height)
build_frame()
