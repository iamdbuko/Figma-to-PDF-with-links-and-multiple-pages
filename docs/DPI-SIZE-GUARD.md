# RGB Vector JPEG size guard — v9.0.2 candidate

**Status:** implementation and independent patch review are complete. Local tests, a clean install/build/test rerun, implementation-commit CI, a rendered local 148-page PDF-processing audit and independent checks of the actual built-UI replay all pass. The replay's coordinate tolerance is recorded below. Live Figma verification is pending uninterrupted desktop access and source-version confirmation. Publication remains requested and outstanding. Implementation candidate `ee498e20414a043af4eb635a120087163e448b1a` is pushed. This document records candidate behavior, not a completed Figma release.

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
| Clean install/build/full-suite rerun of `ee498e2` | Bundle and license files reproduced exactly; 304/304 tests passed again |
| Generated `ui.html` SHA-256 | `4e5de515aee4330c0c87b3ced519ee87858f2cd305ca13b3edcaba5a1ee0ec5d` |
| Independent patch review | Shared-mask accounting corrected; no remaining blocking finding in the reviewed scope |
| Local 148-page PDF-processing audit | Structural, image, profile and exact-link checks passed; details below |
| Rendered inspection of local diagnostic output | All 148 pages compared at 72 DPI; four changed pages reviewed at 150 DPI without visible defects |
| Actual built-UI replay | Completed; independent structural, link and rendered checks passed with the coordinate tolerance below |
| Implementation-commit CI | Succeeded for `ee498e2`: [run 43496175311](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43496175311) |
| Live Figma high-DPI export | **Pending uninterrupted desktop access and source-version confirmation**; saved-PDF processing does not perform fresh Figma rendering |
| GitHub/Figma publication | **Requested; outstanding** |

`tests/pdf-image-resolution.test.js` uses valid encoded JPEGs to cover inflation, beneficial resizing, exact-size equality, mask savings/growth, exact ICC/image/mask preservation, warning deduplication, saved-output shared-mask behavior, nested direct references, bounded ownership analysis and cancellation before commit. Existing non-JPEG/default-false paths remain covered.

`tests/pdf-assembly.test.js` exercises the actual RGB and CMYK assembly paths at 300 DPI. A 512-pixel JPEG placed at 100 points retains its exact original JPEG in RGB when the 417-pixel candidate expands. CMYK still produces the 417-pixel four-channel image. Another smaller placement on the same page still downsizes to 50 pixels. Saved/reloaded output preserves page dimensions and the fixture's exact native link records.

Run the focused suites from the repository root:

```sh
node --test tests/pdf-image-resolution.test.js tests/pdf-assembly.test.js
```

## Local 148-page processing evidence

An existing PDF was processed locally at 300 DPI and compared with its Original-resolution output. This tests the PDF-processing path on a large document; it is **not** evidence of a completed live Figma export. Only aggregate results are recorded here.

| Comparison | Verified result |
| --- | --- |
| Pages and geometry | All 148 pages retained; all page boxes exact |
| Links | All 301 annotations exact: 193 external URI and 108 internal |
| Non-image content and color | Decoded non-image streams and ICC profiles exact |
| Retained original images | 93 original JPEG/mask pairs byte-identical |
| Successful image resizing | Seven images resized to independently checked 300-DPI dimensions |
| Expanding replacements avoided | 72 attempted resizes retained their originals because encoded size would grow |
| Compressed stream integrity | All 653 output Flate streams validated |
| Original-resolution output | 119,490,186 bytes |
| Candidate 300-DPI output | 116,689,727 bytes |
| Rendered visual inspection | All 148 pages compared at 72 DPI: 144 pixel-identical; pages 11, 61, 139 and 140 reviewed at 150 DPI with no visible defects |

## Actual built-UI replay

The saved 148-page native PDF was replayed through the actual generated UI bundle identified above, including its assembly, budgeting and download flow. This exercises more of the shipped runtime than the local diagnostic, but supplies already exported page data: it does **not** rerun Figma's renderer or establish successful desktop interaction.

| Runtime measurement | Result |
| --- | --- |
| Completed pages | 148 |
| Saved PDF | 116,682,827 bytes |
| Peak retained PDF data | 118,479,434 bytes, below the unchanged 128 MiB limit |
| Replay duration | 54.2 seconds |
| Fallbacks, network requests and browser errors | None |
| User warning | Intended original-JPEG retention warning shown |
| Independent geometry/content/profile comparison | All 148 page boxes, decoded non-image streams and ICC bytes exact |
| Independent image comparison | 93 original JPEG/mask pairs byte-identical; seven resized images at the independently expected 300-DPI dimensions |
| Independent link comparison | All 301 targets, types and multiplicities exact (193 URI, 108 internal); rectangles within 1e-9 point, as detailed below |
| Independent stream integrity | All 653 output Flate streams valid |
| Rendered comparison | All 148 pages rendered at 72 DPI: 144 pixel-identical to Original; differences confined to the same four resized-image pages; all 148 pixel-identical to the visually reviewed local diagnostic output |
| Detailed changed-page rendering | Actual replay pages 11, 61, 139 and 140 also rendered at 150 DPI and matched the reviewed local diagnostic details pixel-for-pixel; no new visible defect |

The replay harness converts internal annotation rectangles through top-left coordinates. That round trip introduced differences in 27 internal rectangles, at most 5.684e-14 point. All rectangles matched within 1e-9 point and targets matched exactly. The replay therefore passes a precise tolerance check, not a claim of bit-exact annotation rectangles. Its rendered output is pixel-identical to the local diagnostic output whose changed pages were visually inspected at 150 DPI.

The measured retained-data budget is not total process memory. Neither replay nor diagnostic establishes universal viewer compatibility or printer output. The earlier 77-page benchmark tests a different resource-retention defect and must not be presented as new 300-DPI evidence. Live Figma verification is pending uninterrupted desktop access and source-version confirmation because concurrent desktop activity and source changes prevented a reliable fresh-export comparison. Publication remains requested and outstanding; no fresh native completion or publication is claimed. Later documentation/publication commits require their own CI verification.

For whole-plugin review context, see [AI-REVIEW-HANDOFF.md](AI-REVIEW-HANDOFF.md). For publication, follow [RELEASING.md](RELEASING.md); match the final commit and generated bundle to their recorded evidence.
