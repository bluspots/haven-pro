#!/usr/bin/env python3
"""
Generate Haven Pro PWA icons scaled to visually match the Customer app.

Inputs (existing in the repository workspace):
- Reference Customer icon (for scale): workspace/haven-icon-ref/customer-apple-touch-icon.png
- Approved Pro artwork (house+wrench on black): workspace/haven-icon-ref/haven-pro-logo-mark.png

Outputs (written to repository root):
- apple-touch-icon.png  (180x180)
- icon-192.png          (192x192)
- icon-512.png          (512x512)

Method:
1) Measure the visible mark bounding box on the Customer apple-touch icon
   by detecting pixels that differ from the background color (sampled
   from the 4 corners).
2) Extract the Pro mark by removing near-black background from the
   approved artwork (keeps mint mark and soft edges).
3) Compose a solid black square canvas and scale the Pro mark so that
   its fitted bounding-box occupies approximately the same width/height
   proportions as the Customer mark. Center optically by geometry.
"""
from __future__ import annotations

import os
from typing import Tuple
from PIL import Image
import math

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REF_DIR = os.path.join(ROOT, "haven-icon-ref")
# Primary expected paths (preferred)
CUSTOMER_REF = os.path.join(REF_DIR, "customer-apple-touch-icon.png")
PRO_ART = os.path.join(REF_DIR, "haven-pro-logo-mark.png")
# Fallback to uploads (agent attachments) when preferred refs are missing
UPLOADS_DIR = os.path.join(os.path.expanduser("~"), ".cursor", "projects", "workspace", "uploads")
if not os.path.exists(CUSTOMER_REF):
    # Pick the first filename that starts with the expected base
    for name in os.listdir(UPLOADS_DIR):
        if name.startswith("customer-apple-touch-icon_") and name.endswith(".png"):
            CUSTOMER_REF = os.path.join(UPLOADS_DIR, name)
            break
if not os.path.exists(PRO_ART):
    for name in os.listdir(UPLOADS_DIR):
        if name.startswith("haven-pro-logo-mark_") and name.endswith(".png"):
            PRO_ART = os.path.join(UPLOADS_DIR, name)
            break

OUT_180 = os.path.join(ROOT, "apple-touch-icon.png")
OUT_192 = os.path.join(ROOT, "icon-192.png")
OUT_512 = os.path.join(ROOT, "icon-512.png")


def _to_rgba(img: Image.Image) -> Image.Image:
    if img.mode != "RGBA":
        return img.convert("RGBA")
    return img


def _avg_color_at_corners(im: Image.Image) -> Tuple[int, int, int]:
    w, h = im.size
    pixels = im.load()
    points = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]
    rs, gs, bs = 0, 0, 0
    for (x, y) in points:
        r, g, b, a = pixels[x, y]
        rs += r
        gs += g
        bs += b
    n = len(points)
    return (rs // n, gs // n, bs // n)


def _color_distance(c1: Tuple[int, int, int], c2: Tuple[int, int, int]) -> float:
    # Simple Euclidean distance in sRGB
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))


def measure_customer_mark_bbox(im: Image.Image) -> Tuple[int, int, int, int]:
    """Return bbox (left, top, right, bottom) of visible mark on customer icon."""
    im = _to_rgba(im)
    bg = _avg_color_at_corners(im)
    w, h = im.size
    px = im.load()

    # Threshold relative to background distance; robust to slight color drift
    # Pick a dynamic threshold: 15% of max distance from bg to white
    max_dist = _color_distance(bg, (255, 255, 255))
    base_thresh = max(28.0, max_dist * 0.18)  # ensure >= ~28

    min_x, min_y = w, h
    max_x, max_y = -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                # Transparent (shouldn't happen on customer), ignore
                continue
            if _color_distance((r, g, b), bg) >= base_thresh:
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
    if max_x < 0 or max_y < 0:
        # Fallback to central 70% if detection failed
        margin_x = int(w * 0.15)
        margin_y = int(h * 0.15)
        return (margin_x, margin_y, w - margin_x, h - margin_y)
    # Add a tiny contraction to ignore anti-aliased fringe
    pad_x = max(0, int(round(min(w, h) * 0.002)))
    pad_y = pad_x
    return (
        max(0, min_x + pad_x),
        max(0, min_y + pad_y),
        min(w, max_x - pad_x),
        min(h, max_y - pad_y),
    )


def extract_pro_mark_rgba(im: Image.Image) -> Image.Image:
    """
    Return an RGBA image containing only the mint mark (alpha-matted),
    with black background removed. Keeps anti-aliased edges.
    """
    im = _to_rgba(im)
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()

    # Determine background reference near-black (use corners)
    bg = _avg_color_at_corners(im)

    # Distance threshold from black-ish background; mint is far brighter/greener.
    # Be conservative to avoid holes inside the mint shape.
    thresh = 32.0
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a <= 4:
                continue
            d_bg = _color_distance((r, g, b), bg)
            if d_bg > thresh:
                # Keep, retain original color and alpha
                dst[x, y] = (r, g, b, a)
            else:
                # Drop to transparent
                dst[x, y] = (0, 0, 0, 0)
    return out


def fit_size_within(src_w: int, src_h: int, max_w: int, max_h: int) -> Tuple[int, int]:
    """Return (w, h) that fits source inside max box keeping aspect."""
    scale = min(max_w / src_w, max_h / src_h)
    return max(1, int(round(src_w * scale))), max(1, int(round(src_h * scale)))


def compose_icons():
    # Load references
    cust = Image.open(CUSTOMER_REF)
    pro = Image.open(PRO_ART)

    # Measure customer mark bbox
    cx0, cy0, cx1, cy1 = measure_customer_mark_bbox(cust)
    cw, ch = cust.size
    cust_bbox_w = max(1, cx1 - cx0)
    cust_bbox_h = max(1, cy1 - cy0)
    # Target proportion of canvas for width/height
    target_w_ratio = cust_bbox_w / cw
    target_h_ratio = cust_bbox_h / ch

    # Prepare Pro mark without black background
    pro_mark = extract_pro_mark_rgba(pro)
    pm_w, pm_h = pro_mark.size
    # Tight bbox of non-transparent pixels
    bbox = pro_mark.getbbox()  # type: ignore[attr-defined]
    if bbox:
        pro_mark = pro_mark.crop(bbox)
        pm_w, pm_h = pro_mark.size

    # Compose at high-res then downscale
    base_sizes = [512, 192, 180]
    outputs = {
        512: OUT_512,
        192: OUT_192,
        180: OUT_180,
    }

    for size in base_sizes:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255))  # solid black bg
        # Compute target inner box
        target_w = int(round(size * target_w_ratio))
        target_h = int(round(size * target_h_ratio))

        # Safety bounds
        target_w = min(size, max(1, target_w))
        target_h = min(size, max(1, target_h))

        fit_w, fit_h = fit_size_within(pm_w, pm_h, target_w, target_h)
        mark_resized = pro_mark.resize((fit_w, fit_h), Image.LANCZOS)

        # Center paste
        off_x = (size - fit_w) // 2
        off_y = (size - fit_h) // 2
        canvas.alpha_composite(mark_resized, (off_x, off_y))

        # Save as opaque PNG (iOS is happier with no alpha)
        out_path = outputs[size]
        canvas_noalpha = Image.new("RGB", (size, size), (0, 0, 0))
        canvas_noalpha.paste(canvas, mask=canvas.split()[-1])
        canvas_noalpha.save(out_path, format="PNG", optimize=True)
        print(f"Wrote {out_path} ({size}x{size}) – target ratios "
              f"{target_w_ratio:.3f}w, {target_h_ratio:.3f}h; placed {fit_w}x{fit_h}")


if __name__ == "__main__":
    compose_icons()

