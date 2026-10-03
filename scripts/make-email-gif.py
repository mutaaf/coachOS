#!/usr/bin/env python3
# Remake the festive email header:  pip install pillow && python3 scripts/make-email-gif.py
# Decorative header for festive emails: a basketball arcs across a hardwood
# court and swishes through the hoop, under falling confetti. Text stays in
# the HTML (readable, accessible); this is only the party. Deterministic:
# the same file every run.
import math, random, sys
from PIL import Image, ImageDraw

W, H, FRAMES, SCALE = 560, 150, 32, 2
random.seed(11)
ORANGE = (234, 88, 12)
BALL = (232, 106, 23)
SEAM = (60, 30, 10)
INK = (15, 23, 42)
BG = (255, 247, 237)
WOOD = (233, 196, 140)
WOOD_DARK = (214, 172, 112)
LINE = (255, 255, 255)
COLORS = [ORANGE, (250, 204, 21), (16, 185, 129), (56, 189, 248), (236, 72, 153), (139, 92, 246)]
FLOOR = H - 30
RIM_X, RIM_Y = W - 92, 58  # the rim's left edge, in base pixels

pieces = [dict(x=random.uniform(0, W), y=random.uniform(-H, H), vy=random.uniform(2.2, 4.2), sway=random.uniform(6, 16),
               ph=random.uniform(0, 6.28), c=random.choice(COLORS), w=random.uniform(5, 9), h=random.uniform(9, 14),
               spin=random.uniform(.2, .5)) for _ in range(60)]

def court(d):
    d.rectangle([0, FLOOR * SCALE, W * SCALE, H * SCALE], fill=WOOD)
    for i in range(0, W, 46):  # floorboards
        d.line([i * SCALE, FLOOR * SCALE, (i - 18) * SCALE, H * SCALE], fill=WOOD_DARK, width=SCALE)
    d.line([0, FLOOR * SCALE, W * SCALE, FLOOR * SCALE], fill=LINE, width=2 * SCALE)
    # the key and free-throw arc, foreshortened
    d.arc([(RIM_X - 120) * SCALE, (FLOOR + 4) * SCALE, (RIM_X - 20) * SCALE, (FLOOR + 30) * SCALE], 90, 270, fill=LINE, width=2 * SCALE)

def hoop(d, front):
    pole_x = W - 34
    if not front:
        d.rectangle([pole_x * SCALE, (RIM_Y - 30) * SCALE, (pole_x + 8) * SCALE, FLOOR * SCALE], fill=(100, 116, 139))
        d.rectangle([(RIM_X + 44) * SCALE, (RIM_Y - 44) * SCALE, (RIM_X + 50) * SCALE, (RIM_Y + 8) * SCALE], fill=(255, 255, 255), outline=INK, width=SCALE)
        d.rectangle([(RIM_X + 50) * SCALE, (RIM_Y - 34) * SCALE, pole_x * SCALE, (RIM_Y - 28) * SCALE], fill=(100, 116, 139))
        # net
        for k in range(6):
            x0 = RIM_X + 4 + k * 7
            d.line([x0 * SCALE, RIM_Y * SCALE, (x0 + 3) * SCALE, (RIM_Y + 22) * SCALE], fill=(226, 232, 240), width=SCALE)
            d.line([(x0 + 7) * SCALE, RIM_Y * SCALE, (x0 + 3) * SCALE, (RIM_Y + 22) * SCALE], fill=(226, 232, 240), width=SCALE)
    else:
        d.line([RIM_X * SCALE, RIM_Y * SCALE, (RIM_X + 44) * SCALE, RIM_Y * SCALE], fill=ORANGE, width=3 * SCALE)

def ball(im, cx, cy, r, rot):
    size = int(r * 2) + 4
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    d.ellipse([2, 2, size - 2, size - 2], fill=BALL, outline=SEAM, width=max(2, int(r * .1)))
    w = max(2, int(r * .09))
    # seams: one straight through, one across, two curved
    for a in (rot, rot + math.pi / 2):
        d.line([c + math.cos(a) * r, c + math.sin(a) * r, c - math.cos(a) * r, c - math.sin(a) * r], fill=SEAM, width=w)
    for side in (-1, 1):
        ox = c + math.cos(rot) * r * 1.05 * side
        oy = c + math.sin(rot) * r * 1.05 * side
        d.ellipse([ox - r * .78, oy - r * .78, ox + r * .78, oy + r * .78], outline=SEAM, width=w)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([2, 2, size - 2, size - 2], fill=255)
    im.paste(layer, (int(cx - c), int(cy - c)), mask)

def ball_at(t):
    """Dribble, then a shot that arcs into the rim and drops through the net."""
    if t < .4:  # dribbling in from the left
        u = t / .4
        x = 40 + u * 150
        y = FLOOR - 15 - abs(math.sin(u * math.pi * 3)) * 50
        return x, y, u * 9
    if t < .8:  # the shot: a parabola to the middle of the rim
        u = (t - .4) / .4
        x0, y0 = 190, FLOOR - 40
        x1, y1 = RIM_X + 22, RIM_Y - 14
        x = x0 + (x1 - x0) * u
        y = y0 + (y1 - y0) * u - math.sin(u * math.pi) * 38
        return x, y, 9 + u * 10
    u = (t - .8) / .2  # through the net, to the floor
    return RIM_X + 22, RIM_Y - 14 + u * (FLOOR - 15 - RIM_Y + 14), 19 + u * 3

frames = []
for f in range(FRAMES):
    t = f / FRAMES
    im = Image.new("RGB", (W * SCALE, H * SCALE), BG)
    d = ImageDraw.Draw(im)
    court(d)
    hoop(d, front=False)
    for p in pieces:
        y = (p["y"] + p["vy"] * f * H / (FRAMES * 3.2) * 3) % (H + 30) - 20
        x = p["x"] + math.sin(p["ph"] + t * 2 * math.pi) * p["sway"]
        a = p["ph"] + t * 2 * math.pi * p["spin"] * 4
        w = abs(math.cos(a)) * p["w"] + 1.5
        d.rectangle([(x - w / 2) * SCALE, (y - p["h"] / 2) * SCALE, (x + w / 2) * SCALE, (y + p["h"] / 2) * SCALE], fill=p["c"])
    bx, by, rot = ball_at(t)
    ball(im, bx * SCALE, by * SCALE, 15 * SCALE, rot)
    hoop(ImageDraw.Draw(im), front=True)  # the rim in front of the ball as it drops through
    frames.append(im.resize((W, H), Image.LANCZOS))

pal = Image.new("P", (1, 1))
base = [BG, WOOD, WOOD_DARK, LINE, INK, (100, 116, 139), (226, 232, 240), BALL, SEAM, (148, 163, 184)] + COLORS
flat = [v for c in base for v in c]
flat += [255] * (768 - len(flat))
pal.putpalette(flat)
frames = [fr.quantize(palette=pal, dither=Image.Dither.NONE) for fr in frames]
out = sys.argv[1] if len(sys.argv) > 1 else "apps/web/public/email/celebrate.gif"
frames[0].save(out, save_all=True, append_images=frames[1:], duration=70, loop=0, optimize=True, disposal=2)
print(out)
