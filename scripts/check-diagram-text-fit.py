#!/usr/bin/env python3
"""Deterministic text-fit check for .drawio.svg diagrams — no fonts, no deps.

Why this exists (2026-10-09): three diagrams reached the user with text
spilling out of its box (#1079's template diagram, #1081's rework, #1084's
hook-migration). Two of those lanes had been told, in their brief, to render
the image and look at it first. It still happened. That is the signature of a
rule sitting at level 4 (prose) with nothing to enforce it.

The drawio skill already says why prose cannot work here: "Vision is the
secondary gate: it both misses geometry defects and hallucinates new ones. The
primary gate is deterministic." And validate.py hands the rest to "the visual
review step" — which is exactly the step that gets skipped. Text overflow is
the defect that falls through that gap: not a structural error, and reliably
invisible to the eye when it is a few pixels.

So the check is arithmetic: for every HTML label, measure the text and compare
against the box the diagram declares. Widths come from a static advance table
(per-character fractions of the font size) rather than a real font file — the
gate runs on CI runners with no fonts installed, and a table that errs wide
keeps the check deterministic everywhere.

Calibration (2026-10-09), against every diagram this repo has, with each
verdict confirmed by rendering the SVG and looking at it:

    OK   docs/verify/1054/mechanism.drawio.svg        (in #1086)
    OK   docs/verify/1065/zombie-claim.drawio.svg
    OK   docs/verify/1079/template-sections.drawio.svg (after its fix)
    FAIL docs/verify/1084/hook-migration.drawio.svg    (3 labels, all real)

Ticket #1087 lands this as scripts/check-diagram-text-fit.py plus the
advisory workflow diagram-text-fit.yml, which sweeps every
docs/verify/**/*.drawio.svg in the tree. The reference implementation the
calibration ran against is scratch/check-diagram-text-fit.py (outside this
repo). Change one, change the other.

The same verdicts came out of an earlier real-font implementation (Helvetica +
Hiragino Sans GB via PIL), label for label — the table only has to be
directionally right, because the margin between "fits" and "spills" is a whole
line, not a pixel. Four for four, no false positive and no false negative.

Two bugs this check had to lose first, both worth remembering: a 0-byte input
(a failed fetch) reported "OK", and matching the containing shape on y alone
grabbed a same-band shape two columns over and invented an overflow. Both are
the same failure this whole file exists to prevent — a confident answer from a
state that was never actually checked.

A second, independent check lives here since #1107: every `.drawio.svg` handed
to this script must ship its editable `.drawio` source next to it (same name
minus the `.svg` suffix). This is the drawio skill's artifact contract — an
export and its source are delivered as a pair — and three diagrams had reached
main as exports only, with the source recoverable solely by unescaping the
`content` attribute the exporter embeds.

What this second check judges is EDITABILITY, not quality, and the distinction
is the point. Quality cannot be machine-judged here: five candidate quality
metrics were tried against this repo's diagram corpus and all five failed for
lack of variance — the corpus is homogeneous (same author, same skill, same
template vocabulary), so no metric separated the good diagrams from the bad.
Editability is the one axis that is deterministic: the source either ships or
it does not. Two of the three source-less diagrams are good diagrams; the gate
does not care, and neither should its output be read as a verdict on them.

The text-fit check above is untouched by this addition; it stays calibrated
4/4 against the diagrams listed earlier.

Usage:
  python3 check-diagram-text-fit.py <file.drawio.svg|file.drawio> [--json]
  python3 check-diagram-text-fit.py 'docs/verify/**/*.drawio'   # globs ok

Exit 0 when every label fits and every source ships, 1 when any overflows or
any source is missing, 3 on a read error.
"""
import argparse
import glob
import html
import json
import os
import re
import subprocess
import sys
import tempfile

DEFAULT_FONT_SIZE = 12.0  # drawio's default when the cell style omits fontSize
LINE_HEIGHT = 1.2         # drawio HTML labels: 1.2 x font-size per line

# Per-character advance as a fraction of font size, bracket-checked against
# Helvetica (Latin) and Hiragino Sans GB (Han) via PIL on this repo's three
# diagrams: the verdicts (which labels overflow, and by how many lines) are
# identical. Latin 0.55 em is Helvetica's average for lowercase; uppercase,
# digits and CJK-heavy strings are pushed higher so the estimate never
# under-reports. A false positive costs one layout tweak; a false negative
# ships the bug this script exists to catch.
LATIN_EM = 0.55
CJK_EM = 1.00
WIDE_LATIN = set('ABCDEFGHIJKLMNOPQRSTUVWXYZ@%&WMmw')
NARROW = set(" .,:;'|!iljt()[]{}")

# A `.drawio.svg` label: the div's width IS the wrap width, its height is a
# sentinel 1px (the real height lives on the sibling rect), and padding-top is
# the label's anchor y inside the shape.
DIV = re.compile(
    r'<div[^>]*style="([^"]*width:\s*(?P<w>[\d.]+)px[^"]*)"[^>]*>(?P<text>.*?)</div>',
    re.S)
FS = re.compile(r'font-size:\s*([\d.]+)')
PAD_TOP = re.compile(r'padding-top:\s*([\d.]+)')
MARGIN_LEFT = re.compile(r'margin-left:\s*([\d.]+)')
RECT = re.compile(
    r'<rect[^>]*\bx="(?P<x>[-\d.]+)"[^>]*\by="(?P<y>[-\d.]+)"'
    r'[^>]*\bwidth="(?P<w>[\d.]+)"[^>]*\bheight="(?P<h>[\d.]+)"'
    r'(?P<rest>[^>]*)/>')
FILL = re.compile(r'fill="(?P<fill>[^"]*)"')


def width_of(text, size):
    total = 0.0
    for ch in text:
        if ord(ch) > 0x2E80:            # CJK, kana, full-width punctuation
            total += CJK_EM * size
        elif ch in WIDE_LATIN:
            total += 0.72 * size
        elif ch in NARROW:
            total += 0.30 * size
        else:
            total += LATIN_EM * size
    return total


def wrapped_lines(text, size, wrap_w):
    """Greedy word wrap, the way a browser would; hard breaks count too."""
    total = 0
    for para in text.split('\n'):
        words = re.findall(r'\S+\s*|\s+', para)
        if not words:
            total += 1
            continue
        cur, n = 0.0, 1
        for w in words:
            ww = width_of(w, size)
            if cur > 0 and cur + ww > wrap_w:
                n += 1
                cur = ww
            else:
                cur += ww
        total += n
    return total


def labels_in(svg):
    out = []
    for m in DIV.finditer(svg):
        text = html.unescape(re.sub(r'<[^>]+>', '', m.group('text'))).strip()
        if not text:
            continue
        style = m.group(1)
        fs = float(FS.search(style).group(1)) if FS.search(style) else DEFAULT_FONT_SIZE
        pt = float(PAD_TOP.search(style).group(1)) if PAD_TOP.search(style) else 0.0
        ml = float(MARGIN_LEFT.search(style).group(1)) if MARGIN_LEFT.search(style) else 0.0
        out.append((text, float(m.group('w')), fs, ml, pt))
    return out


def shape_boxes(svg):
    """Filled rects big enough to be shapes, not legend swatches."""
    boxes = []
    for m in RECT.finditer(svg):
        f = FILL.search(m.group('rest'))
        if not f or f.group('fill') in ('none', '#ffffff'):
            continue
        w, h = float(m.group('w')), float(m.group('h'))
        if w < 40 or h < 24:
            continue
        boxes.append((float(m.group('x')), float(m.group('y')), w, h))
    return boxes


def check_svg(svg):
    boxes = shape_boxes(svg)
    findings = []
    labels = labels_in(svg)
    # An empty input is not a pass. Caught live on 2026-10-09: a failed fetch
    # left a 0-byte file and this script reported "OK" — the same family of bug
    # as the empty check set read as green, or `agent_status == done` read as
    # "the lane finished". Never let an unchecked thing report as checked.
    if not labels:
        raise ValueError('no HTML labels found — empty, truncated, or not a drawio SVG')
    for text, box_w, fs, ml, pad_top in labels:
        lines = wrapped_lines(text, fs, max(box_w - 6, 1))
        need_h = lines * fs * LINE_HEIGHT
        # Match the shape on BOTH axes. Matching on y alone is wrong the moment
        # two shapes share a row band: it picked the blue box (h=70) for a label
        # that lives in the red box (h=90) two columns over, and reported an
        # overflow that does not exist (docs/verify/1054/mechanism.drawio.svg,
        # 2026-10-09). The label div's margin-left is the shape's left edge + 1.
        avail = next((h - 6 for (x, y, w, h) in boxes
                      if x - 32 <= ml <= x + w + 2 and y <= pad_top <= y + h + 2), None)
        if avail is None:
            # A label with no shape behind it is a free-floating canvas
            # annotation (a title, an edge label, a footnote) and is meant to
            # be unbounded — skipping it is correct. Flagging these as overflow
            # was tried on 2026-10-09 and immediately produced three false
            # positives on docs/verify/1084/hook-migration.drawio.svg.
            continue
        if need_h > avail:
            findings.append({
                'text': text[:70], 'box_w': box_w, 'box_h': avail,
                'need_h': round(need_h, 1), 'lines': lines, 'font_size': fs,
            })
    return findings


def missing_source(path):
    """Editability gate (#1107): an export must ship its editable source.

    The drawio skill delivers a pair — `<name>.drawio` plus the
    `<name>.drawio.svg` export — and the export alone is not editable: the
    source survives inside it only as an escaped `content` attribute. Returns
    the expected source path when it is absent, else None. Applies to exports
    only; a `.drawio` input IS its own source.
    """
    if not path.endswith('.drawio.svg'):
        return None
    src = path[:-len('.svg')]
    return None if os.path.exists(src) else src


def to_svg(path):
    if path.endswith('.svg'):
        with open(path, encoding='utf-8') as fh:
            return fh.read()
    out = os.path.join(tempfile.mkdtemp(), 'out.drawio.svg')
    subprocess.run(['drawio', '-x', '-f', 'svg', '-e', '--embed-svg-images',
                    '-o', out, path], check=True, capture_output=True)
    with open(out, encoding='utf-8') as fh:
        return fh.read()


def expand(patterns):
    files = []
    for p in patterns:
        hits = sorted(glob.glob(p, recursive=True))
        files.extend(hits or [p])
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    results, bad, errors = {}, 0, 0
    for p in expand(args.files):
        src = missing_source(p)
        found = [{'missing_source': src}] if src else []
        try:
            found += check_svg(to_svg(p))
        except Exception as e:
            print(f'check-diagram-text-fit: {p}: {e}', file=sys.stderr)
            errors += 1
            continue
        results[p] = found
        if found:
            bad += 1
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for p, found in results.items():
            if not found:
                print(f'OK   {p}')
            for x in found:
                if 'missing_source' in x:
                    print(f'FAIL {p}: no editable source — {x["missing_source"]} '
                          f'does not exist (the drawio skill ships the export '
                          f'and its .drawio source as a pair)')
                else:
                    print(f'FAIL {p}: needs {x["need_h"]}px in a {x["box_h"]}px box '
                          f'({x["lines"]} lines @ {x["font_size"]}px): {x["text"]!r}')
    # A read error outranks findings: an input that could not be checked must
    # not exit 1, which reads as "checked and overflowing" to a caller that
    # only distinguishes zero from nonzero.
    if errors:
        return 3
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
