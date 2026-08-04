#!/usr/bin/env python3
"""
Cuts the eight category icons out of icon-source.png.

Kept in the repo because the icons are derived art, not authored art: if the
source image is ever redrawn, re-running this reproduces the set exactly rather
than leaving someone to re-guess crop boxes and colour thresholds.

    python3 tools/slice-icons.py

Writes public/icons/ex/*.png at 128px with transparent backgrounds.
"""
from PIL import Image
from collections import deque
import os

SRC_PATH = 'icon-source.png'
OUT_DIR = 'public/icons/ex'
CELL_W = 384
ROWS = {0: (72, 400), 1: (578, 872)}   # art only: above the label, inside the card
INSET = 34                              # clears the card's rounded border stroke
SIZE = 128

NAMES = [('chest', 0, 0), ('back', 1, 0), ('arms', 2, 0), ('legs', 3, 0),
         ('abs', 0, 1), ('dip-bar', 1, 1), ('pull-up-bar', 2, 1), ('cardio', 3, 1)]

# These two enclose card background inside a closed shape that a border flood can
# never reach. Their outlines are green rather than black, so a blanket dark-key
# is safe here and only here — on the muscle icons it would eat the black
# linework that defines them.
ENCLOSED = {'dip-bar', 'pull-up-bar'}

# Near-black bodies that vanish against a dark app tile. Lifted until they read.
LIFT_BODY = {'dip-bar', 'pull-up-bar'}

ACCENT = (62, 224, 127)   # --accent, so the icons speak the app's one colour


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


def main():
    src = Image.open(SRC_PATH).convert('RGBA')
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for name, col, row in NAMES:
        y1, y2 = ROWS[row]
        cell = src.crop((col*CELL_W + INSET, y1, col*CELL_W + CELL_W - INSET, y2))
        cell = key_out(cell, 30)
        if name in ENCLOSED:
            cell = dark_key(cell, 34)
        cell = emphasise(cell, lift_body=name in LIFT_BODY)
        bb = cell.getbbox()
        if bb:
            cell = cell.crop(bb)
        side = max(cell.size)
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(cell, ((side - cell.width)//2, (side - cell.height)//2))
        canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
        canvas = canvas.quantize(colors=128, method=Image.FASTOCTREE).convert('RGBA')
        path = f'{OUT_DIR}/{name}.png'
        canvas.save(path, optimize=True)
        size = os.path.getsize(path)
        total += size
        print(f'{name:14} {size/1024:5.1f} KB')
    print(f'{"total":14} {total/1024:5.1f} KB')


if __name__ == '__main__':
    main()
