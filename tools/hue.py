#!/usr/bin/env python3
"""
The one hue rotation the whole app shares.

Lives on its own because both generators need it and a second copy is a second
thing to drift. TARGET is the floor ring's own hue, which is the reference the
palette was decided against.

Only saturated pixels move. The arena is mostly desaturated stone, and rotating
grey only tints it — the guard is what keeps the room stone rather than turning
it green. Saturation and value are never touched: this changes WHICH green, not
how bright or how vivid, so nothing tuned by eye needs tuning again.
"""
import colorsys

TARGET = 156.0
MIN_SAT = 0.18

# what each source measures at, before rotation
FROM = {
    'arena': 80.0,
    'fire1': 129.0,
    'fire3': 97.0,
    'frame': 137.0,
    'ring': 158.0,
    'icon': 85.0,
}


def rotate_to_target(img, from_hue):
    """Rotate an RGB(A) image's saturated pixels onto TARGET."""
    delta = ((TARGET - from_hue) / 360.0) % 1.0
    has_alpha = 'A' in img.getbands()
    alpha = img.getchannel('A') if has_alpha else None
    rgb = img.convert('RGB')
    out = []
    for r, g, b in rgb.getdata():
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s >= MIN_SAT:
            r, g, b = colorsys.hsv_to_rgb((h + delta) % 1.0, s, v)
            r, g, b = int(r * 255 + .5), int(g * 255 + .5), int(b * 255 + .5)
        out.append((r, g, b))
    rgb.putdata(out)
    if has_alpha:
        rgb = rgb.convert('RGBA')
        rgb.putalpha(alpha)
    return rgb
