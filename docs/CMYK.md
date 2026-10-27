# CMYK beta — v9.0.0-dev.4

Choose **CMYK (beta)** and load the `.icc` or `.icm` output profile supplied for your printer and paper. The profile stays in the plugin UI; no design or profile is uploaded to a conversion service. The normal default remains **Same as Figma file**.

This first version creates image-based CMYK PDF pages. It preserves page dimensions, prototype links and native text-link rectangles when Figma can export those rectangles. Text is no longer selectable or resolution-independent. Transparent areas are composited onto white before conversion. Existing quality, fitting and multipart controls still apply.

## Conversion

Figma renders each page as an explicit sRGB PNG. The exporter reads its actual RGB ICC metadata, then uses bundled LittleCMS through `lcms-wasm` 1.0.5 to transform pixels into the uploaded printer profile. The rendering intent is relative colorimetric with black-point compensation. The resulting image is losslessly compressed and uses PDF `ICCBased` with four components and the exact uploaded profile; changing a label alone would not convert RGB into CMYK.

The destination must be a structurally valid CMYK printer profile that LittleCMS can use for conversion. Profiles are limited to 16 MiB. Invalid, RGB, device-link and incompatible profiles fail before Figma starts exporting. The test suite's synthetic CMYK profile exercises the engine; it is not a real printing condition and must never be offered as a production preset.

## Limits

- CMYK beta is raster-only. The source PNG is lossless; there is no CMYK JPEG encoder in this version.
- The provisional page limit is 8 million pixels and 16,384 pixels per side. **Fit oversized pages** lowers resolution to those limits without changing the PDF page size. Normal RGB exports keep their existing 32-million-pixel allowance.
- Conversion runs in chunks with cancellation opportunities and releases its transform handles. PNG decoding and PDF compression still require additional full-page buffers; the pixel limit and existing 128 MiB transport/PDF-data budgets are not guarantees about total memory.
- Printer profiles control gamut mapping, ink separation and total ink. This version offers no ink-coverage preview, soft proofing, spot colors, overprint controls, pure-black preservation or printer-specific preset selection. Black text can use multiple inks according to the selected profile.
- This is not PDF/X or a certified press-ready workflow. It does not add an output-intent declaration or claim print conformance. Check the resulting PDF with the printer before production use.

## Validation

The [checkpoint results](cmyk-results.json) record **125 passing automated tests**. Independent native LittleCMS 2.19 produced byte-identical CMYK values for the 300×200 Figma swatch image and a local macOS Generic CMYK profile, compared with bundled LittleCMS 2.16. The assembled PDF preserved the exact profile, dimensions and link, and was rendered for visual inspection. That system profile is not redistributed or offered as a printer preset.

The [CMYK browser stress test](cmyk-stress-results.json) processed eight distinct 2800×2800 PNG pages into four PDFs in 29.33 seconds, including fixture generation. Input totaled 67.98 MiB and PDFs totaled 45.30 MiB. Four-channel image data, one exact profile per part, white alpha flattening, dimensions and four local/four cross-file destinations were checked. This uses compressible synthetic landscapes and the test-only ICC, not arbitrary Figma exports or physical printing. Recorded memory samples are partial and may miss peaks.

Live Figma tests verified the new default for vector and JPEG exports. The first native CMYK attempt was interrupted by a computer-use file-picker limitation; CMYK upload, conversion and download are covered by real isolated Chromium tests. Reproduce those with `npm test`, and the larger workload with `node scripts/stress-cmyk.mjs`.

For an independent local comparison with an ICC profile you may use for testing, run `node scripts/validate-cmyk.mjs /path/to/profile.icc`, then `python scripts/compare-cmyk.py /path/to/profile.icc` using Python with Pillow/ImageCms installed. Outputs stay in the ignored `test-results/cmyk/` directory. These checks do not measure a physical printer.

Implementation references: [LittleCMS engine](https://littlecms.com/color-engine/), [lcms-wasm source](https://github.com/mattdesl/lcms-wasm), [Figma export settings](https://developers.figma.com/docs/plugins/api/ExportSettings/).
