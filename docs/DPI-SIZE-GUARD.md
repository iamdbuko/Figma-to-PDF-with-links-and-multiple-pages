# RGB Vector JPEG size guard — v9.0.2 candidate

**Status:** implementation and independent patch review are complete; local tests pass. Native high-DPI verification, final-commit CI and publication remain pending. This document records the candidate behavior, not a completed Figma release.

## Why a smaller image can make a larger PDF

Vector image resizing decodes a supported native image, reduces its pixels and stores the result with lossless Flate compression. An original JPEG may already be much smaller than that lossless replacement. At a resolution close to the source's effective DPI, including some 300-DPI exports, removing a few pixels can therefore increase encoded bytes substantially and hit the existing PDF-data limit.

This is a compression issue, not a universal 300-DPI failure or a new limit. The JPEG option in export settings controls whole-page RGB raster exports and fallbacks; it does not recompress images inside a successfully imported native PDF. Earlier unused-resource and failed-import fixes in v9.0.1 address separate causes of large output.

## Decision and scope

`src/pdf-image-resolution.js` accepts `preserveSmallerJpeg`, defaulting to `false`. `src/ui.html` enables it only for native RGB Vector pages. After creating a resized JPEG candidate, the helper compares **encoded** image and applicable soft-mask bytes before registering or staging the replacement.

- If the candidate costs strictly more than the available original-image/mask savings, retain the original image and mask.
- If it costs the same or less, retain the existing resizing behavior.
- Non-JPEG images, Original quality and whole-page PNG/JPEG raster exports are unchanged.
- CMYK does not enable this option. Its established downsizing, conversion and resource guards remain intact.

Keeping an original preserves its exact JPEG bytes, dimensions, ICC/color-space references and mask. Page dimensions, vector/text instructions and link annotations are unchanged. It adds no JPEG recompression or color conversion. The visible warning is:

> An embedded JPEG was kept at its original resolution because resizing it would increase the PDF size.

That image may remain **above the requested DPI**. The setting remains a downsizing target, not a guarantee that every source image will have exactly that resolution. Beneficial resizing still occurs elsewhere on the same page.

## Shared masks and bounded work

An old soft mask is not a saving if another retained resource still references it. The guard credits its bytes only when a lazy whole-source-context scan proves one incoming reference. The scan includes indirect references, direct dictionaries/arrays and metadata references, rather than considering only painted image placements. It is bounded to 100,000 inspected/pending items and yields cooperatively. Shared, unknown or oversized graphs receive no mask-savings credit.

For those conservative cases, the comparison is the candidate's **image plus new mask** against the original **image bytes only**. For a proven exclusive mask, both original image and mask bytes may be credited. Original masks are never mutated. The source pipeline operates on freshly loaded native PDF objects; this is not a general optimizer for arbitrary manually constructed PDF object aliases.

Rejected candidates are not registered in the PDF context. Changes stay staged until asynchronous work completes and cancellation is checked, so cancellation cannot commit an earlier partial resize. Statistics distinguish actual decoding work from the retained image dimensions and record the requested dimensions and conservative replacement budget.

Existing pixel, decoding, staging, transfer and retained/saved PDF limits are unchanged. Creating the candidate still requires decoding/resizing work; this is not a peak-memory reduction or a guarantee that an entire file will fit. The comparison covers encoded image streams, not every byte of PDF serialization overhead. Large originals can still require smaller parts or a different export mode.

## Verified candidate evidence

| Check | Result |
| --- | --- |
| Focused image-resolution and PDF-assembly suites | 55/55 passed locally |
| Full `npm test` | 304/304 passed locally, including those focused tests |
| Generated `ui.html` SHA-256 | `4e5de515aee4330c0c87b3ced519ee87858f2cd305ca13b3edcaba5a1ee0ec5d` |
| Independent patch review | Shared-mask accounting corrected; no remaining blocking finding in the reviewed scope |
| Native high-DPI export and rendered inspection | **Pending** |
| Exact final-commit CI and GitHub/Figma publication | **Pending** |

`tests/pdf-image-resolution.test.js` uses valid encoded JPEGs to cover inflation, beneficial resizing, exact-size equality, mask savings/growth, exact ICC/image/mask preservation, warning deduplication, saved-output shared-mask behavior, nested direct references, bounded ownership analysis and cancellation before commit. Existing non-JPEG/default-false paths remain covered.

`tests/pdf-assembly.test.js` exercises the actual RGB and CMYK assembly paths at 300 DPI. A 512-pixel JPEG placed at 100 points retains its exact original JPEG in RGB when the 417-pixel candidate expands. CMYK still produces the 417-pixel four-channel image. Another smaller placement on the same page still downsizes to 50 pixels. Saved/reloaded output preserves page dimensions and the fixture's exact native link records.

Run the focused suites from the repository root:

```sh
node --test tests/pdf-image-resolution.test.js tests/pdf-assembly.test.js
```

These tests do not establish native Figma behavior on every design, total process memory, viewer compatibility or printer output. The earlier 77-page benchmark tests a different resource-retention defect and must not be presented as new 300-DPI evidence. Record native candidate measurements and rendered inspection here only after verification.

For whole-plugin review context, see [AI-REVIEW-HANDOFF.md](AI-REVIEW-HANDOFF.md). For publication, follow [RELEASING.md](RELEASING.md); match the final commit and generated bundle to their recorded evidence.
