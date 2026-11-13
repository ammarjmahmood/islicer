"""Draws the iSlicer icon: a model cut into print layers. Run: python3 scripts/make_icon.py"""
from PIL import Image, ImageDraw, ImageFilter

S = 4096

def lerp(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

# Deep charcoal background with a faint lift toward the top
bg = Image.new("RGB", (S, S))
d = ImageDraw.Draw(bg)
for y in range(S):
    d.line([(0, y), (S, y)], fill=lerp((28, 32, 40), (10, 11, 14), y / S))

# Soft teal glow behind the stack
glow = Image.new("L", (S, S), 0)
ImageDraw.Draw(glow).ellipse((S * 0.18, S * 0.22, S * 0.82, S * 0.86), fill=90)
glow = glow.filter(ImageFilter.GaussianBlur(S * 0.09))
bg.paste((0, 212, 170), mask=glow)

def slab(cx, cy, w, h, t):
    """An isometric slab: top diamond plus two side faces. Returns (top, left, right) polygons."""
    top = [(cx, cy - h), (cx + w, cy), (cx, cy + h), (cx - w, cy)]
    left = [(cx - w, cy), (cx, cy + h), (cx, cy + h + t), (cx - w, cy + t)]
    right = [(cx + w, cy), (cx, cy + h), (cx, cy + h + t), (cx + w, cy + t)]
    return top, left, right

cx = S / 2
w, h, t, gap = 1180, 620, 250, 190
layers = 4
total = (layers - 1) * (t + gap)
y0 = S / 2 + total / 2 - 40
top_c, bot_c = (0, 232, 186), (0, 150, 214)   # teal at the top layer, blue at the bottom

art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
a = ImageDraw.Draw(art)
for i in range(layers):                      # bottom layer first
    k = 1 - i / (layers - 1)                 # 1 at the bottom
    base = lerp(top_c, bot_c, k)
    cy = y0 - i * (t + gap)
    top, left, right = slab(cx, cy, w, h, t)
    a.polygon(left, fill=lerp(base, (0, 0, 0), 0.38) + (255,))
    a.polygon(right, fill=lerp(base, (0, 0, 0), 0.55) + (255,))
    a.polygon(top, fill=lerp(base, (255, 255, 255), 0.10 if i < layers - 1 else 0.22) + (255,))

# Contact shadow under the stack
shadow = Image.new("L", (S, S), 0)
ImageDraw.Draw(shadow).ellipse((cx - w * 0.95, y0 + h * 0.75, cx + w * 0.95, y0 + h * 1.75), fill=170)
shadow = shadow.filter(ImageFilter.GaussianBlur(90))
bg.paste((0, 0, 0), mask=shadow)
bg.paste(art, mask=art)

icon = bg.resize((1024, 1024), Image.LANCZOS).convert("RGB")
icon.save("assets/icon.png")
icon.save("assets/splash-icon.png")
icon.resize((48, 48), Image.LANCZOS).save("assets/favicon.png")
# Android adaptive: artwork alone on transparent, plus a flat background
fg = Image.new("RGBA", (S, S), (0, 0, 0, 0)); fg.paste(art, mask=art)
fg.resize((1024, 1024), Image.LANCZOS).resize((680, 680), Image.LANCZOS)
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
small = fg.resize((700, 700), Image.LANCZOS); canvas.paste(small, (162, 162), small)
canvas.save("assets/android-icon-foreground.png")
Image.new("RGB", (1024, 1024), (16, 18, 22)).save("assets/android-icon-background.png")
canvas.convert("L").point(lambda v: 255 if v > 20 else 0).convert("RGBA").save("assets/android-icon-monochrome.png")
print("wrote icons")
