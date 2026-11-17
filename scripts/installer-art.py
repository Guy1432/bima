"""Draws the NSIS installer artwork from the Bima mark geometry (same as BimaMark / app-icon.svg).

    python scripts/installer-art.py   →  src-tauri/installer/{sidebar,header}.bmp

sidebar.bmp 164×314 (welcome / finish pages), header.bmp 150×57 (inner pages).
Rendered at 4× and downsampled for clean edges. Hebrew is drawn visually (RTL reversed),
since Pillow without libraqm has no bidi.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "installer"
OUT.mkdir(parents=True, exist_ok=True)
S = 4  # supersampling

TOP = (122, 118, 245)
BOTTOM = (93, 88, 230)
BG_TOP = (26, 26, 34)
BG_BOTTOM = (14, 14, 19)
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT = "C:/Windows/Fonts/segoeui.ttf"


def vgrad(w, h, a, b):
    img = Image.new("RGB", (w, h), a)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def mark(size):
    """The mark on a transparent square of `size` px (drawn on the 32-unit grid)."""
    k = size / 32
    m = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg = vgrad(size, size, TOP, BOTTOM).convert("RGBA")
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=7.25 * k, fill=255)
    m.paste(bg, (0, 0), mask)
    beam = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(beam).polygon([(13.2 * k, 6 * k), (18.8 * k, 6 * k), (24.2 * k, 20 * k), (7.8 * k, 20 * k)], fill=(255, 255, 255, 97))
    m = Image.alpha_composite(m, beam)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([12.4 * k, 4.6 * k, 19.6 * k, 7.2 * k], radius=1.3 * k, fill="white")
    d.rounded_rectangle([5.5 * k, 21 * k, 26.5 * k, 25.6 * k], radius=1.6 * k, fill="white")
    return m


def heb(text):
    return text[::-1]  # visual order for plain Hebrew (no digits / latin runs)


def sidebar():
    w, h = 164 * S, 314 * S
    img = vgrad(w, h, BG_TOP, BG_BOTTOM).convert("RGBA")
    # soft stage light from above, very subtle
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.polygon([(w * 0.40, 0), (w * 0.60, 0), (w * 0.90, h * 0.42), (w * 0.10, h * 0.42)], fill=(122, 118, 245, 34))
    glow = glow.filter(ImageFilter.GaussianBlur(14 * S))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)

    m = mark(58 * S)
    img.alpha_composite(m, ((w - m.width) // 2, int(h * 0.27)))

    f1 = ImageFont.truetype(FONT_BOLD, 26 * S)
    f2 = ImageFont.truetype(FONT, 11 * S)
    t1 = heb("בימה")
    t2 = heb("מערכת הקרנה")
    for text, font, y, col in ((t1, f1, h * 0.27 + 70 * S, (250, 250, 252)), (t2, f2, h * 0.27 + 106 * S, (160, 160, 176))):
        tw = d.textlength(text, font=font)
        d.text(((w - tw) / 2, y), text, font=font, fill=col)
    out = img.convert("RGB").resize((164, 314), Image.LANCZOS)
    out.save(OUT / "sidebar.bmp")


def header():
    w, h = 150 * S, 57 * S
    img = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    m = mark(36 * S)
    img.alpha_composite(m, ((w - m.width) // 2, (h - m.height) // 2))
    out = img.convert("RGB").resize((150, 57), Image.LANCZOS)
    out.save(OUT / "header.bmp")


if __name__ == "__main__":
    sidebar()
    header()
    print("wrote", OUT / "sidebar.bmp", OUT / "header.bmp")
