#!/usr/bin/env python3
# Remake the festive email header:  pip install pillow && python3 scripts/make-email-gif.py
# Decorative header for festive emails: confetti drifting over a soccer ball
# that bounces across a pitch line. Text stays in the HTML (readable,
# accessible); this is only the party. Deterministic: same file every run.
import math, random, sys
from PIL import Image, ImageDraw
W, H, FRAMES, SCALE = 560, 150, 28, 2
random.seed(7)
COLORS = [(234,88,12),(250,204,21),(16,185,129),(56,189,248),(236,72,153),(139,92,246)]
BG = (255,247,237)
pieces = [dict(x=random.uniform(0,W), y=random.uniform(-H,H), vy=random.uniform(2.2,4.2), sway=random.uniform(6,16),
               ph=random.uniform(0,6.28), c=random.choice(COLORS), w=random.uniform(5,9), h=random.uniform(9,14), spin=random.uniform(.2,.5))
          for _ in range(70)]
def ball(im, cx, cy, r, rot):
    # A classic ball: black centre pentagon, five more cut off by the edge,
    # seams between — drawn on its own layer and masked to a circle.
    size = int(r*2)+4
    layer = Image.new("RGB", (size, size), (255,255,255))
    d = ImageDraw.Draw(layer)
    c = size/2
    d.regular_polygon((c, c, r*.34), 5, rotation=math.degrees(rot), fill=(15,23,42))
    for k in range(5):
        a = rot + math.pi/2 + k*2*math.pi/5
        px, py = c + math.cos(a)*r*.98, c - math.sin(a)*r*.98
        d.regular_polygon((px, py, r*.34), 5, rotation=math.degrees(rot)+36, fill=(15,23,42))
        sx, sy = c + math.cos(a)*r*.34, c - math.sin(a)*r*.34
        d.line([sx, sy, c + math.cos(a)*r*.66, c - math.sin(a)*r*.66], fill=(15,23,42), width=max(2, int(r*.08)))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([2, 2, size-2, size-2], fill=255)
    im.paste(layer, (int(cx-c), int(cy-c)), mask)
    ImageDraw.Draw(im).ellipse([cx-c+2, cy-c+2, cx+c-2, cy+c-2], outline=(15,23,42), width=max(2, int(r*.09)))

frames = []
for f in range(FRAMES):
    t = f / FRAMES
    im = Image.new("RGB", (W*SCALE, H*SCALE), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, (H-26)*SCALE, W*SCALE, H*SCALE], 0, fill=(220,252,231))
    d.line([0,(H-26)*SCALE, W*SCALE,(H-26)*SCALE], fill=(16,185,129), width=2*SCALE)
    for p in pieces:
        y = (p["y"] + p["vy"]*f*H/ (FRAMES*3.2) * 3) % (H+30) - 20
        x = p["x"] + math.sin(p["ph"] + t*2*math.pi)*p["sway"]
        a = p["ph"] + t*2*math.pi*p["spin"]*4
        w = abs(math.cos(a))*p["w"]+1.5
        d.rectangle([(x-w/2)*SCALE,(y-p["h"]/2)*SCALE,(x+w/2)*SCALE,(y+p["h"]/2)*SCALE], fill=p["c"])
    # the ball: bounces twice per loop, rolling left to right and back
    bx = W/2 + math.sin(t*2*math.pi)*170
    by = (H-26-18) - abs(math.sin(t*2*math.pi*2))*62
    ball(im, bx*SCALE, by*SCALE, 19*SCALE, t*2*math.pi*2)
    frames.append(im.resize((W,H), Image.LANCZOS))
pal = Image.new("P", (1, 1))
base = [BG, (220,252,231), (16,185,129), (15,23,42), (255,255,255), (148,163,184)] + COLORS
flat = [v for c in base for v in c]
flat += [255] * (768 - len(flat))
pal.putpalette(flat)
frames = [fr.quantize(palette=pal, dither=Image.Dither.NONE) for fr in frames]
out = sys.argv[1] if len(sys.argv) > 1 else 'apps/web/public/email/celebrate.gif'
frames[0].save(out, save_all=True, append_images=frames[1:], duration=70, loop=0, optimize=True, disposal=2)
print(out)
