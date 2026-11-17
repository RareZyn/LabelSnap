# LabelSnap — logo draft

Round 1. Three concepts, built black-first, tested, not yet a kit.

| Path | What it is |
| ---- | ---- |
| `BRIEF.md` | Brief, category clichés ruled out, word map, 12-concept longlist with scores |
| `concepts-round1.png` / `.svg` | **The concept overview — start here** |
| `concepts/` | Source SVGs, versioned `v1` → `v4` so iterations stay comparable |
| `renders/` | PNG renders used to check the work by eye |
| `tests/preview.html` / `preview.png` | Full test sheet: size ladder, 16/32/48 px pixel test, backgrounds, one-colour, reversed, squint, mirror, rotate, favicon / app-icon / header / card contexts |
| `tests/px16/`, `tests/px32/` | True small-size renders |

## Concepts

- **A — Snap Bracket** (`a-snap-bracket-v3.svg`) — recommended. Plus `a-symbol-color.svg`,
  `a-symbol-dark.svg`, `a-appicon.svg`, `a-lockup.svg`.
- **B — Corner Handles** (`b-corner-handles-v4.svg`) — v3 carried a caption bar that turned to mush at 32 px;
  v4 drops it.
- **C — Shutter** (`c-shutter-v3.svg`) — v1 collided into a blob, v2 was too small in the frame, v3 is the keeper.
- `c-rectify-v2.svg` — a dropped fourth idea (skewed slab, upright window). It read as a cinema screen and the
  idea died at a glance. Kept for the record.

## Test results

All three: 1 colour, no gradients, no live text in the symbols, square aspect, even margins,
`svg_audit.py` 100/100.

Decisive finding is in the 16 px row of the overview: **A is the only one still legible at favicon size.**
B and C collapse into an indistinct cluster, which matters because the app icon and the 16 px favicon are a
stated requirement (FR-118, NFR-18).

## Not done yet (this is the kit, built only after a direction is chosen)

Final optical corrections and a small-size cut · colour palette with one-colour and reversed versions ·
stacked lockup · favicon + app-icon + web-icon set · presentation board with mockups · usage guide.

## Caveats

- The wordmark in the lockups is **placeholder type** (Segoe UI, `<text>` not outlines). Real letterforms get
  drawn as paths in the kit; no font licence has been assessed.
- No trademark clearance has been done. That needs a professional search before you commit.
