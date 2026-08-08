#!/usr/bin/env python3
"""Generate the Satzbau macOS app icon (Apple-style): blue gradient rounded
square, soft top sheen, and a white "ß" glyph in SF Pro. Produces build/icon.png
(1024x1024) plus an .iconset, and compiles build/icon.icns via iconutil."""

import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 1024
RADIUS = 190

FONT_PATH = "/System/Library/Fonts/SFNS.ttf"
if not os.path.exists(FONT_PATH):
    FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

GLYPH = "ß"


def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def build_base():
    # vertical-then-light blue gradient (Apple blue family)
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad = Image.new("RGBA", (SIZE, SIZE))
    px = grad.load()
    top = (82, 173, 255)   # #52adff
    mid = (0, 122, 255)    # #007aff
    bot = (0, 78, 175)     # #004eaf
    for y in range(SIZE):
        t = y / (SIZE - 1)
        c = lerp(top, mid, min(1.0, t * 2)) if t < 0.5 else lerp(mid, bot, (t - 0.5) * 2)
        for x in range(SIZE):
            px[x, y] = (*c, 255)
    # rounded-rect mask
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)
    img = Image.alpha_composite(img, grad)
    # soft top sheen (subtle radial highlight)
    sheen = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.ellipse([-SIZE * 0.35, -SIZE * 0.45, SIZE * 1.35, SIZE * 0.55], fill=(255, 255, 255, 46))
    sheen = sheen.filter(ImageFilter.GaussianBlur(90))
    img = Image.alpha_composite(img, sheen)
    # inner top highlight line
    hl = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.rounded_rectangle([6, 6, SIZE - 7, SIZE - 7], radius=RADIUS - 6, outline=(255, 255, 255, 70), width=4)
    img = Image.alpha_composite(img, hl)
    # apply mask
    img.putalpha(mask)
    return img


def build_glyph_layer():
    font = ImageFont.truetype(FONT_PATH, 540)
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bbox = d.textbbox((0, 0), GLYPH, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (SIZE - w) / 2 - bbox[0]
    y = (SIZE - h) / 2 - bbox[1] + 8  # optical centering nudge
    d.text((x, y), GLYPH, font=font, fill=(255, 255, 255, 255))
    return layer


def main():
    base = build_base()
    glyph = build_glyph_layer()

    # soft drop shadow under the glyph
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    bbox = sd.textbbox((0, 0), GLYPH, font=ImageFont.truetype(FONT_PATH, 540))
    sd.text((bbox[0], bbox[1] + 26), GLYPH, font=ImageFont.truetype(FONT_PATH, 540), fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    base = Image.alpha_composite(base, shadow)
    base = Image.alpha_composite(base, glyph)

    png = os.path.join(HERE, "icon.png")
    base.save(png, "PNG")
    print("wrote", png)

    iconset = os.path.join(HERE, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    for name, px in [
        ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
    ]:
        base.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name), "PNG")

    icns = os.path.join(HERE, "icon.icns")
    if os.path.exists(icns):
        os.remove(icns)
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)
    print("wrote", icns)


if __name__ == "__main__":
    main()
