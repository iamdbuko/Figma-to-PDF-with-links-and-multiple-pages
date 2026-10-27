# v9 development validation

Validation date: 2026-10-27. This is a development checkpoint, not a Community release approval.

## Scope

The recovered v8 has been preserved separately. v9 replaces the custom segment export and multiple PDF-engine paths with native whole-frame rendering, one acknowledged page at a time, and pdf-lib assembly. The tests target the confirmed failure mechanisms and likely regression areas.

The synthetic Figma file is [PDF Export v9 — Regression & Stress Tests](https://www.figma.com/design/yKf6bZSYBB3tZoWz5qMmen) in Booko Studio. It contains no customer design content. Local live output PDFs and rendered previews are under ignored `test-results/live-figma/`.

## Automated checks

All 55 tests passed locally on the final build.

- Export protocol: stable IDs/duplicate names, refreshed dimensions, sequential acknowledgment, stale and duplicate messages, PDF-to-PNG retry, cancellation across awaits, budgets, errors/timeouts, source edit cancellation and watcher cleanup.
- Link extraction: current and legacy reactions, hidden ancestors, transforms, root rotation, clipping, descendant destinations, isolated scan sinks and precise-text metadata.
- PDF assembly: actual Figma-exported text annotations; wrapped links; raster annotation transfer; internal destinations from both empty native URIs and Desktop Figma node URLs; multiple internal targets in one text node; external URL preservation; invalid data rejection; mixed dimensions and rejecting offset MediaBox/CropBox annotation geometry.
- Browser lifecycle: cancellation during delayed save prevents a download; late messages do not affect a restarted job; duplicate pages are consumed once; invalid PDF retries once; failed PNG recovers controls without a blank download; ordering and checkboxes persist; frame names are treated as text; Figma sandbox relay messages are accepted.

## Live Figma fixtures

| Fixture | Coverage |
| --- | --- |
| 600×400 text page | Three web URLs in one text layer; third spans three lines, producing five independent annotations |
| 800×300 landscape page | Internal whole-text link, prototype rectangle, and two different internal targets within one text layer |
| 300×650 portrait page | Shadow and hidden linked node |
| 360×120 auto-layout frame | Red/green/blue children at x=20/130/240; middle child blurred |
| 400×300 blend page | Plus lighter requires raster fallback |
| 1200×900 effect page | 200 layers, 100 with blur |
| 600×800 rotated 90° | Native PDF and PNG are correctly 800×600, with corresponding link geometry |
| 600×400 unclipped frame | Child extends outside all edges with shadow; absolute export bounds remain 600×400 |
| 10000×10000 frame | Deliberate raster preflight refusal |
| Separate 250-frame page | Repeated frame names, alternating page dimensions, unique labels/URLs and navigation to the next frame |

After the first live export, all three auto-layout child positions and visibility remained unchanged. The heavy frame still had all 200 children visible and all 100 blur effects. Native PDF and PNG bounds were inspected independently for rotation and overflow. Rendered pages were visually checked for layout and missing content.

The final eight-page vector and raster exports passed with identical dimensions and annotation rectangles: six web-link rectangles and four internal destinations each. The live 250-page export passed with 250 unique web URLs, 250 correct circular next-page destinations, repeated names and mixed page sizes. The 100-megapixel frame failed preflight cleanly, and cancelling a separate 250-page run during rendering restored controls without downloading. See `live-results.json` for output checksums and geometry.

Poppler preview rendering reported Type 3 glyph bounding-box warnings from native Figma vector text. The inspected pages had no missing content; wider PDF-viewer checks remain outstanding.

## Browser stress measurements

See `stress-results.json` for inputs, timings, byte counts and memory sample definitions. These tests drive the built UI and PDF library in isolated Chromium; they do **not** include Figma's renderer or measure whole-process memory.

- 250 native pages: passed; 1,250 native URI annotations and 250 ID-based internal destinations checked.
- 30 large raster pages at 5760×3240 rendered pixels (3840×2160 pages at 1.5×): the lower-texture synthetic control passed.
- More detailed images at the same dimensions reached the 128 MiB input budget after ten pages. The harness stopped before page eleven and verified no partial download. Backend enforcement is covered separately by protocol tests.

The lower-texture control is not representative of every photograph. Compressed bytes, pixel dimensions, effects and total page count all matter. Reported V8 heap/backing-storage samples exclude browser/GPU/native/Figma memory and are not a complete peak-memory bound.

## Release checks still outstanding

- Reproduce the original Community reporters' exact files; they have not been supplied.
- Check Windows Figma and a range of Acrobat versions. Current live tests use macOS Figma; PDF structure and rendered output are checked locally.
- Expand visual fixtures for masks, complex clipping, transparency/blending combinations, missing fonts and library instances, multilingual/RTL text, video/GIF frames and unusual prototype actions.
- Check shared-file permissions and inaccessible external library assets using representative files.
- Benchmark additional real image-heavy designs. Consider optional JPEG compression for photographic raster pages and a future PDF writer with stronger total-memory control.
- Test failure behavior if Figma's own `exportAsync` never settles. Cancellation prevents delivery after the promise returns, but cannot forcibly stop the native renderer; closing the plugin is the escape route.

The provisional limits are deliberate. No promise of unlimited export size, universally correct masks/hotspots, print prepress suitability or compatibility with every viewer is made.
