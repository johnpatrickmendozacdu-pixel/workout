#!/usr/bin/env python3
"""
Cuts every icon the app ships out of its source artwork.

Kept in the repo because the icons are derived art, not authored art: if a
source image is redrawn, re-running this reproduces the whole set exactly
rather than leaving someone to re-guess crop boxes and colour thresholds.

    python3 tools/slice-icons.py

Writes:
    public/icons/ex/*.png     the ten exercise categories, 128px
    public/icons/crew/*.png   crew roles and classes, 128px
    public/icons/icon-*.png   the app icon, from the Sets mark

The three grids all share one layout idea — a card, art above, a label below —
so one crop table drives the lot. Boxes are padded around the art and the alpha
trim in write_icon finds the real edges, which is why a few pixels of drift in
a hand-measured box costs nothing.
"""
from PIL import Image
from collections import deque
import os

OUT_DIR = 'public/icons/ex'
CREW_DIR = 'public/icons/crew'
SIZE = 128
ACCENT = (62, 224, 127)   # --accent, so the icons speak the app's one colour

# ---- the ten categories, one grid ----------------------------------------
# Replaced the original three-source arrangement (a 4x2 grid plus two singles)
# on 2026-08-12: one image, one table, no per-file special cases.
CATEGORY_SRC = 'Updated Category Icons.png'
CAT_COLS = [(32, 374), (388, 736), (749, 1113), (1126, 1497)]
CAT_ART = {0: (30, 322), 1: (425, 668), 2: (762, 940)}   # row -> art band
CATEGORIES = [
    ('chest', 0, 0), ('back', 1, 0), ('arms', 2, 0), ('legs', 3, 0),
    ('abs', 0, 1), ('dip-bar', 1, 1), ('pull-up-bar', 2, 1), ('cardio', 3, 1),
    ('skateboard', 1, 2), ('badminton', 2, 2),
]

# ---- crew roles and classes ----------------------------------------------
CREW_SRC = 'Roles and Classes.png'
CREW_ICONS = [
    ('role-leader', (238, 115, 556, 385)),
    ('role-vice', (651, 115, 904, 385)),
    ('role-member', (1000, 115, 1280, 385)),
    ('class-fighter', (49, 628, 282, 876)),
    ('class-artist', (355, 628, 530, 876)),
    ('class-tank', (630, 628, 878, 876)),
    ('class-tech', (938, 628, 1172, 876)),
    ('class-tycoon', (1230, 628, 1485, 876)),
]

# ---- the app mark ---------------------------------------------------------
LOGO_SRC = 'Updated Sets Icon.png'
LOGO_BOX = (360, 80, 1180, 900)

# These two enclose card background inside a closed shape that a border flood can
# never reach. Their outlines are green rather than black, so a blanket dark-key
# is safe here and only here — on the muscle icons it would eat the black
# linework that defines them.
ENCLOSED = {'dip-bar', 'pull-up-bar'}

# Near-black bodies that vanish against a dark app tile. Lifted until they read.
LIFT_BODY = {'dip-bar', 'pull-up-bar'}


def key_out(img, tol):
    """Flood inward from the border only, so interior black survives."""
    img = img.copy()
    px = img.load()
    w, h = img.size
    seen = [[False]*w for _ in range(h)]
    q = deque()

    def seed(x, y):
        if not seen[y][x]:
            seen[y][x] = True
            q.append((x, y))

    for x in range(w):
        seed(x, 0); seed(x, h-1)
    for y in range(h):
        seed(0, y); seed(w-1, y)
    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        if max(r, g, b) >= tol:
            continue
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                seen[ny][nx] = True
                q.append((nx, ny))
    return img


def dark_key(img, tol):
    img = img.copy()
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and max(r, g, b) < tol:
                px[x, y] = (0, 0, 0, 0)
    return img


def emphasise(img, lift_body=False):
    """Pull every green toward the app accent and brighten it; optionally lift
    near-black bodies so they read against a dark tile instead of dissolving."""
    img = img.copy()
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            if g > 30 and g > r * 1.12 and g > b * 1.12:
                # how green it already is decides how far it moves
                k = min(1.0, (g - max(r, b)) / 70.0 + 0.62)
                r = int(r + (ACCENT[0] - r) * k)
                g = int(g + (ACCENT[1] - g) * k)
                b = int(b + (ACCENT[2] - b) * k)
                px[x, y] = (r, g, b, a)
            elif lift_body and max(r, g, b) < 110:
                # floor the darkest pixels; keeps relative shading, kills the void
                f = 104
                s = (255 - f) / 255.0
                px[x, y] = (int(f + r*s), int(f + g*s), int(f + b*s), a)
    return img


def write_icon(cell, path, lift_body=False, size=SIZE):
    """Shared tail: emphasise, trim to the art, square it so every icon shares one
    optical size, downscale, quantise."""
    cell = emphasise(cell, lift_body=lift_body)
    bb = cell.getbbox()
    if bb:
        cell = cell.crop(bb)
    side = max(cell.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(cell, ((side - cell.width)//2, (side - cell.height)//2))
    canvas = canvas.resize((size, size), Image.LANCZOS)
    canvas = canvas.quantize(colors=128, method=Image.FASTOCTREE).convert('RGBA')
    canvas.save(path, optimize=True)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(CREW_DIR, exist_ok=True)
    total = 0

    src = Image.open(CATEGORY_SRC).convert('RGBA')
    for name, col, row in CATEGORIES:
        x0, x1 = CAT_COLS[col]
        y0, y1 = CAT_ART[row]
        cell = src.crop((x0 + 14, y0, x1 - 14, y1))
        # 48, not 30: the new source's card panel is a lighter grey than the old
        # one, and at 30 the flood stopped at the card edge and left every icon
        # sitting on a dark rectangle. Interior black is unreachable from the
        # border, so raising this cannot eat the linework.
        cell = key_out(cell, 48)
        if name in ENCLOSED:
            cell = dark_key(cell, 34)
        total += write_icon(cell, f'{OUT_DIR}/{name}.png', lift_body=name in LIFT_BODY)
        print(f'{name:16} {os.path.getsize(f"{OUT_DIR}/{name}.png")/1024:5.1f} KB')

    crew = Image.open(CREW_SRC).convert('RGBA')
    for name, box in CREW_ICONS:
        cell = key_out(crew.crop(box), 48)
        total += write_icon(cell, f'{CREW_DIR}/{name}.png')
        print(f'{name:16} {os.path.getsize(f"{CREW_DIR}/{name}.png")/1024:5.1f} KB')

    # The app mark keeps its ring, so it is not keyed out — only trimmed and
    # sized. A maskable icon needs its own padding, which is why it is drawn
    # onto a square of the app's ink rather than left transparent.
    logo = Image.open(LOGO_SRC).convert('RGBA').crop(LOGO_BOX)
    for px, path in ((192, 'public/icons/icon-192.png'), (512, 'public/icons/icon-512.png')):
        # Quantised like every other icon here: the mark is three colours and a
        # texture, and a true-colour PNG of it was 400 KB in the precache.
        out = logo.resize((px, px), Image.LANCZOS).quantize(colors=192, method=Image.FASTOCTREE).convert('RGBA')
        out.save(path, optimize=True)
        print(f'{os.path.basename(path):16} {os.path.getsize(path)/1024:5.1f} KB')
    mask = Image.new('RGBA', (512, 512), (10, 12, 11, 255))
    inner = logo.resize((360, 360), Image.LANCZOS)
    mask.paste(inner, (76, 76), inner)
    mask.save('public/icons/icon-maskable-512.png', optimize=True)
    logo.resize((180, 180), Image.LANCZOS).save('public/favicon.png', optimize=True)

    print(f'{"total":16} {total/1024:5.1f} KB')


if __name__ == '__main__':
    main()
