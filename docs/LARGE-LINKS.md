# Large files with mixed links — dev.6

Tested October 27, 2026 against unchanged `9.0.0-dev.6`. Built UI SHA-256: `b1bf36eb43cb92fe5c39b739106af2f58e8e4150bf89f83fd7e6a37a65e0fabe`.

All completed combined workloads passed structural validation: 86 output pages and 688 link annotations across browser stress tests and native Figma exports. No production-code change was needed. Oversized jobs failed explicitly instead of producing incomplete downloads. Preview followed an in-file link, but blocked a cross-file link with a permission error.

## Browser stress tests

The actual built plugin UI, pdf-lib and CMYK converter ran in isolated Chromium 141. Pages were supplied sequentially by the harness. These tests exercise assembly, conversion, download and resource lifecycle; they do not run Figma's renderer or document scanner.

| Workload | Raster pixels per page | Output | Annotations | Result / elapsed time |
| --- | --- | --- | --- | --- |
| 30 JPEG pages, one PDF | 5760 × 3240 | 10.90 MiB | 240 | Passed, 22.64 s |
| 30 PNG pages, three 10-page PDFs | 5760 × 3240 | 234.40 MiB | 240, including 42 cross-part | Passed, 117.76 s |
| 8 CMYK pages, four 2-page PDFs | 2800 × 2800 | 53.39 MiB | 64, including 24 cross-part | Passed, 27.36 s |
| Same PNG workload, one PDF | 5760 × 3240 | No download | No incomplete output | Expected retained-data refusal on page 17 |

Each page combines an external prototype URL, a wrapped text URL with two rectangles, forward/back/jump prototype destinations, and next/previous text NODE links. Duplicate scanner records and repeated frame names are intentional. Every saved PDF was reloaded to check exact URLs, rectangles, page references, relative filenames and zero-based destination page indexes. No missing, extra or duplicate annotations were accepted.

The PNG job processed 371.6 MiB of compressed input. JPEG retained every original supplied compressed image stream, and all 30 source-pixel fingerprints matched between PNG and JPEG. Exact RGB ICC bytes were verified across all 60 saved RGB images: canonical sRGB for PNG, original embedded source sRGB for JPEG. The CMYK run verified 62.72 million actual four-channel pixels, the exact built-in ICC once per part, dimensions, opaque images without soft masks and conversion-session cleanup.

A second single-PDF refusal run checked terminal cleanup: 16 pages acknowledged, page 17 refused, active job released, zero live Blob URLs, zero anchor download starts, zero downloads and no false success message. The 128 MiB retained-PDF allowance is not a total process-memory limit. Splitting the same workload into parts passed with the production allowance unchanged.

Fixtures are distinct, compressible synthetic landscapes with gradients and enlarged noise, not a real photograph corpus or worst-case random data. JPEG uses browser quality 0.9, not Figma's native encoder. Timings include fixture generation and are machine-specific. Memory samples exclude whole-browser/Figma/native/GPU memory and can miss transient peaks. Native-style annotation PDFs in the harness model Figma's format; their geometry is synthetic.

Evidence: [RGB results](large-links-dev6-results.json), [CMYK results](cmyk-links-dev6-results.json). Exact RGB profile verification is recorded separately under `supplementalSrgbVerification`, because it was added after the successful heavy runs. The final PNG refusal scenario includes the stronger cleanup proof. Historical reports remain unchanged. Append now rejects incompatible fixture versions before launching Chromium or changing a report.

## Native Figma exports

Created a dedicated **Combined large + links — dev.6** page in the [Booko Studio test file](https://www.figma.com/design/yKf6bZSYBB3tZoWz5qMmen?node-id=30-2). It contains six 3840 × 2880 frames with repeated names, an image background, multiple URLs in one text node, a URL wrapping over three lines, circular next/previous text links and next-page prototype links. The background repeats one synthetic color-chart image; this complements, rather than duplicates, the distinct-image browser workload.

| Export | Files | Output bytes | Annotations | Result |
| --- | ---: | ---: | ---: | --- |
| Vector, Same as Figma file | 1 | 2,427,930 | 48 | Passed; vector painting retained |
| Rasterized JPEG, Same as Figma file | 1 | 13,483,376 | 48 | Passed; page image retained |
| Rasterized CMYK, built-in ICC, Fit enabled | 3 | 13,200,613 | 48, including 9 cross-part | Passed; actual four-channel images |

With fitting off, the 3840 × 2880 CMYK request was rejected before download because it exceeded 8 million pixels. With fitting on, all six images became 3266 × 2449 at a reported 0.8503× scale. PDF dimensions stayed 3840 × 2880. Every raster/CMYK annotation rectangle and target matched the vector PDF within 0.01 points. This is comparison to the plugin's vector export, not an independent raw native-PDF oracle.

The validator checks duplicate annotations, page boxes, rotation, all URLs and local/remote destinations, wrapped fragments, prototype bounds, raster image counts and CMYK profile/channel data. Two tiny negative fixtures confirmed duplicate URL and internal-link annotations are rejected even without a reference PDF.

Poppler previews of vector and JPEG first pages and the final CMYK page were visually reviewed: image, wrapped text, labels and controls remained present. Figma's vector PDF emitted Type 3 glyph-bounding-box warnings during rendering; no missing content was observed. Source frame positions/sizes, image hashes, text content/geometry/links and prototype geometry/destinations were checked after export and matched the fixture.

In macOS Preview, clicking **Next page** on page 1 of CMYK part 1 correctly displayed page 2. Clicking it again tried the correct part-2 filename but Preview refused access with “you don't have permission to view it.” All three parts existed together under unchanged filenames. Cross-part destination structures passed validation; successful cross-file navigation in another compatible reader is still unverified. Keep all parts together with their original names. No physical-printer, Windows or Acrobat validation is claimed.

Evidence: [fixture](large-links-live-fixture.json), [post-export source inspection](large-links-live-source-after.json), [native results and PDF hashes](large-links-live-results.json).

## Reproduce

Close the development plugin before rebuilding, because rebuilding hot-reloads Figma. Run from the repository root:

```sh
npm run build
node scripts/stress-large.mjs jpeg parts png --output=test-results/combined-large/rgb-new-results.json
node scripts/stress-cmyk.mjs --bundled --output=test-results/combined-large/cmyk-new-results.json
```

`scripts/validate-combined-live.py --help` documents the native PDF validator (Python with `pypdf`). Pass the six frame IDs in export order: `30:3 30:5 30:7 30:9 30:11 30:13`. Validate vector first, then use it as `--oracle-kind vector --oracle <vector.pdf>` for raster and CMYK. Pass all multipart PDFs in order after `--`.

Saved test PDFs and preview PNGs are local, ignored artifacts under `test-results/combined-large/`; they are not added to Git. The existing dev.6 importable snapshot still contains the tested, unchanged engine. These results increase confidence in the covered combinations; they do not guarantee every possible Figma document or PDF reader.
