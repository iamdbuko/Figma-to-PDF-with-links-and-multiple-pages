# Large-file exports in v9.0.0-dev.2

This development update offers two ways to handle large designs: reduce raster image costs inside one PDF, or save a long export as separate PDFs. It does not promise arbitrary-size output or constant process memory.

## Choosing an output

Start with **Vector**. Figma's native PDF can keep text, shapes and existing images more efficiently than rasterizing an entire frame. A frame containing a photograph does not automatically benefit from full-page rasterization.

For raster output or vector fallbacks, **Lossless PNG** remains the default. **JPEG** embeds Figma's compressed JPEG directly without expanding it into RGB/alpha buffers in the PDF library. It can help photo-heavy designs, but can soften text, turns transparent regions white and can be larger than PNG for flat artwork. Resolution is controlled separately. Figma's plugin API does not expose a JPEG quality percentage, so this UI does not claim one.

Enable **Fit oversized pages** only when reduced raster resolution is acceptable. The exporter reports requested and actual scale, respecting 32 million pixels and 16,384 pixels per side. The PDF page dimensions remain unchanged. This is a plugin safeguard, not a claim about Figma's own maximum rendering capability.

For long documents, choose **Split into parts** and a page count. The exporter knows every part's page range before rendering, so repeated names and forward/backward internal destinations remain identifiable. It finishes one PDF, starts its download, releases its document resources, and pauses for the user to save before continuing. It does not retain all finished PDFs or assemble a ZIP in memory. A 15-minute continuation timeout releases an abandoned job.

Keep all parts in one folder with their original filenames. Links across parts use PDF remote destinations (`GoToR`); actual support depends on the PDF viewer and its security settings. Browser viewers may not follow them. Same-part links remain ordinary PDF destinations. Cancelling after earlier parts were downloaded cannot recall those files; links into unfinished parts will not work.

## What the limits measure

The previous 128 MiB cumulative-transfer counter charged every byte ever sent, including discarded fallback PDFs and temporary full-page PDFs used only to recover text-link rectangles. This could reject a job even when the retained output was small.

The new controls are separate:

- One page plus temporary annotation PDF: at most 128 MiB in a transfer.
- One output document: at most 128 MiB of estimated serialized PDF objects/streams retained by the assembler.
- One raster render: at most 32 million scaled pixels and 16,384 pixels per side.

The object-size estimate is not a complete memory measurement. Figma's renderer, parsers, browser overhead and the final serialization buffer use additional memory. Even splitting cannot make a single pathological page harmless; lower its resolution or simplify it if it exceeds the per-page budget. Extremely large native annotation PDFs remain a possible bottleneck.

## Native Figma comparison

An image-filled 3840×2880 synthetic fixture, exported at 1.5× raster scale, produced:

| Format | Bytes | Measured export duration |
| --- | ---: | ---: |
| PNG | 4,486,377 | 6.717 s |
| JPEG | 3,843,660 | 2.007 s |
| Native PDF | 917,455 | 0.912 s |

This is one remote Figma execution on synthetic blurred artwork, not a representative photograph corpus or a controlled speed benchmark. The native PDF keeps its own image/vector representation; it is not equivalent to the 1.5× raster resolution.

On a transparent 600×400 fixture with 12 px text, PNG preserved alpha (3,836 bytes). JPEG flattened empty regions to white (18,468 bytes), illustrating why JPEG is optional.

## Evidence and release scope

All **73 automated tests passed** on the final implementation. [Live results](large-file-live-results.json) record an eight-page JPEG export including the fitted oversized frame, plus six large image pages exported in three two-page parts with exact local and remote destinations verified. A same-file link worked in macOS Preview; its cross-file link was blocked by Preview file-access permissions. No permissions were changed. Cross-file navigation remains a viewer-compatibility limitation, not a fully verified user flow.

The [current browser benchmark](large-file-results.json) uses 30 distinct synthetic landscape pages at 5760×3240 pixels, with matching source pixels for the PNG and JPEG runs:

| Output | Result | Output size |
| --- | --- | ---: |
| JPEG, one PDF | All 30 pages passed | 10.9 MiB |
| PNG, one PDF | Stopped at the document budget on page 17; no download | — |
| PNG, three 10-page PDFs | All 30 pages passed | 234.4 MiB combined |
| PNG, fifteen 2-page PDFs with a test-only 32 MiB budget | All 30 pages passed | 234.4 MiB combined |

The production multipart run processed 371.6 MiB of input while keeping each estimated serialized document below 78.6 MiB. Every output page size and all local/remote link destinations were checked. Each completed document was released before continuing; the harness also verified download URL cleanup. These measurements do not establish a bound on total process memory.

The JPEG benchmark uses browser canvas encoding at quality 0.9, not Figma's native JPEG encoder. Its size advantage applies to this synthetic workload and is not a promised compression ratio for user files. The single-PNG stop is an expected safeguard result, not a successful export.

The previous [stress report](stress-results.json) remains an unchanged historical checkpoint; `scripts/stress.mjs` reproduces that old cumulative-budget experiment. The current command `npm run test:stress` runs `scripts/stress-large.mjs`.

The Booko Studio [regression file](https://www.figma.com/design/yKf6bZSYBB3tZoWz5qMmen) contains a separate **Large raster & multipart** page with six large image-filled frames, linked text, a transparency fixture and a 10000×10000 image frame. It contains synthetic artwork only.

Real failing user files, Windows, varied PDF viewers, unusual image profiles and pathological single-page complexity remain release checks. No Community publication is part of this development update.

References: [Figma export settings](https://developers.figma.com/docs/plugins/api/ExportSettings/), [pdf-lib save](https://pdf-lib.js.org/docs/api/classes/pdfdocument#save), [PDF 1.7 remote destinations](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf).
