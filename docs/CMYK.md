# CMYK beta — v9.0.0-dev.7

Choose **Vector** or **Rasterized**, then **CMYK (beta)** under **Color profile**, and export with **Built-in profile**. No file upload is required. This uses basICColor’s ISO Coated v2 300% profile for FOGRA39 coated-paper printing. It is a specific printing condition, not a universal printer profile. If your printer supplies a profile, select **Custom printer profile** and load its `.icc` or `.icm` file. The normal color default remains **Same as Figma file**. Vector / Rasterized stays visible above Color profile, and changing profiles preserves the selected format.

The **Where can I find ICC profiles?** link inside the plugin opens offline instructions for Mac and Windows. The same instructions are in [Finding a printer ICC profile](ICC-PROFILES.md). Profiles can be selected directly from Downloads; OS installation is unnecessary. No design or profile is uploaded to a conversion service.

Vector CMYK preserves supported paths, text, gradients, images and links. It stops on unsupported effects instead of silently rasterizing the page. See [Vector CMYK behavior, limits and validation](VECTOR-CMYK.md).

Rasterized CMYK creates image-based pages. It preserves page dimensions, prototype links and native text-link rectangles when Figma can export those rectangles. Text becomes pixels, and transparent areas are composited onto white before conversion. Existing quality, fitting and multipart controls still apply. The raster pipeline described below remains available.

## Conversion

Rasterized CMYK asks Figma for an explicit sRGB PNG; Vector CMYK asks for an explicit sRGB PDF. The exporter reads actual RGB ICC metadata, then uses bundled LittleCMS through `lcms-wasm` 1.0.5 to transform colors into the selected CMYK profile. The rendering intent is relative colorimetric with black-point compensation. Converted paints and images use PDF `ICCBased` with four components and the exact selected profile; changing a label alone would not convert RGB into CMYK.

The built-in production profile is redistributed unchanged under its basICColor zlib/libpng license, with [provenance and notices](../licenses/basICColor-profile-provenance.md) included in the repository. A custom destination must be a structurally valid CMYK printer profile that LittleCMS can use for conversion. Custom files are limited to 16 MiB. Invalid, RGB, device-link and incompatible profiles fail before Figma starts exporting. The test suite's synthetic CMYK profile exercises the engine; it is not a real printing condition and must never be offered as a production preset.

## Limits

- Rasterized CMYK uses lossless PNG input and Flate output; there is no CMYK JPEG encoder in this version. Vector CMYK decodes embedded JPEG images and converts them to lossless CMYK image streams while retaining surrounding vectors.
- Rasterized CMYK has an 8-million-pixel page limit and 16,384 pixels per side. **Fit oversized pages** lowers resolution to those limits without changing the PDF page size. Vector CMYK allows 16 million pixels per image and 32 million converted image pixels per page, with drawing-content limits. It does not automatically downsample images. Normal RGB exports keep their existing 32-million-pixel raster allowance.
- Conversion runs in chunks with cancellation opportunities and releases its transform handles. PNG decoding and PDF compression still require additional full-page buffers; the pixel limit and existing 128 MiB transport/PDF-data budgets are not guarantees about total memory.
- Printer profiles control gamut mapping, ink separation and total ink. This version offers no ink-coverage preview, soft proofing, spot colors, overprint controls or pure-black preservation. Black text can use multiple inks according to the selected profile.
- This is not PDF/X or a certified press-ready workflow. It does not add an output-intent declaration or claim print conformance. Check the resulting PDF with the printer before production use.

## Validation

Dev.7 passes all **194 automated tests**, including Vector CMYK with native Figma links, custom and built-in profiles, retained text/paths, gradients, embedded images, cancellation and explicit unsupported-content failures. The final focused vector/function suites contribute 57 tests. The [browser stress run](vector-cmyk-stress-results.json) converted six 3840×2880 image-heavy pages both as one PDF and as three parts; each run verified all 48 links, 66,355,200 CMYK image pixels, retained vectors and one exact ICC per output. The native Figma color fixture also exported successfully as Vector CMYK. See [the vector validation notes](VECTOR-CMYK.md) for scope and limitations.

### Earlier raster-only UX checkpoint

Dev.6 restores the always-visible **Vector / Rasterized** selector, followed by **Color profile**. The 130-test suite passes, including rejection of Vector + CMYK before rendering and explicit format selection in the CMYK lifecycle tests. After the final layout/accessibility adjustment, all 28 browser lifecycle tests passed again; hidden compatibility text is empty for supported settings. The build is reproducible. Native macOS Figma verified both controls, the inline incompatibility message, preserved format selection when switching profiles, and a successful Rasterized CMYK export with no upload: 844,158 bytes, 600×400 dimensions, exact built-in ICC, 960,000 decoded CMYK bytes, and the exact web-link rectangle. Poppler rendering preserved all fixture content. The conversion engine is unchanged; the larger workloads below are historical checkpoints, not dev.6 reruns.

The [dev.5 built-in profile results](cmyk-default-results.json) record **128 passing automated tests**, including no-upload export, exact profile embedding, custom-file races, and keyboard-operated offline help. Independent native LittleCMS produces byte-identical CMYK samples for the built-in profile. Live macOS Figma exported a 600×400 CMYK page without a profile upload; the exact built-in ICC and web-link rectangle survived, and Poppler rendering preserved all fixture content. The help disclosure also opened successfully inside Figma.

The [dev.5 built-in profile stress run](cmyk-default-stress-results.json) converted eight 2800×2800 pages into four PDFs in 27.91 seconds including fixture generation, with 67.98 MiB input and 53.39 MiB output. It checked the actual built-in ICC once per part, four-channel pixels, dimensions and all local/cross-file links. Run it with `node scripts/stress-cmyk.mjs --bundled --output=docs/cmyk-default-stress-results.json`. The same synthetic-content and partial-memory limits below apply.

### Earlier upload-only checkpoint

The [dev.4 checkpoint results](cmyk-results.json) record **125 passing automated tests** on the previous upload-only version. Independent native LittleCMS 2.19 produced byte-identical CMYK values for the 300×200 Figma swatch image and a local macOS Generic CMYK profile, compared with bundled LittleCMS 2.16. The assembled PDF preserved the exact profile, dimensions and link, and was rendered for visual inspection. That system profile is not redistributed or offered as a printer preset.

The [dev.4 CMYK browser stress test](cmyk-stress-results.json) processed eight distinct 2800×2800 PNG pages into four PDFs in 29.33 seconds, including fixture generation. Input totaled 67.98 MiB and PDFs totaled 45.30 MiB. Four-channel image data, one exact profile per part, white alpha flattening, dimensions and four local/four cross-file destinations were checked. This uses compressible synthetic landscapes and the test-only ICC, not arbitrary Figma exports or physical printing. Recorded memory samples are partial and may miss peaks.

Live dev.4 Figma tests verified the new default for vector and JPEG exports. After the user selected the local test ICC profile, native macOS Figma also completed a CMYK export: one 600×400 page and image, 103,381 bytes, four-channel ICCBased image data, the exact uploaded profile, no transparency mask, and the exact web-link rectangle. Poppler rendering preserved the swatches, gradient, raster image and composited alpha region. CMYK upload, conversion, download and cancellation are also covered by real isolated Chromium tests. Reproduce those with `npm test`, and the larger workload with `node scripts/stress-cmyk.mjs`.

For an independent local comparison with an ICC profile you may use for testing, run `node scripts/validate-cmyk.mjs /path/to/profile.icc`, then `python scripts/compare-cmyk.py /path/to/profile.icc` using Python with Pillow/ImageCms installed. Outputs stay in the ignored `test-results/cmyk/` directory. These checks do not measure a physical printer.

Implementation references: [LittleCMS engine](https://littlecms.com/color-engine/), [lcms-wasm source](https://github.com/mattdesl/lcms-wasm), [Figma export settings](https://developers.figma.com/docs/plugins/api/ExportSettings/).
