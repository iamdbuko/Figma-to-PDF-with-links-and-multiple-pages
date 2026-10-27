# Vector CMYK beta

Choose **Vector** and **CMYK (beta)** to convert the colors in Figma's native PDF while retaining supported vector drawing and text. Use the built-in **ISO Coated v2 300% (basICColor)** profile, or choose a custom profile supplied by your printer. The built-in profile describes FOGRA39 coated-paper printing; it is not a universal printer preset. Conversion runs locally with the bundled engine and profile, without a conversion service.

This is a bounded converter for the PDF features found in the tested Figma exports. An unsupported page stops the export with an explanation and a suggestion to choose **Rasterized**. Vector CMYK does not silently replace the whole page with a bitmap. Previously downloaded parts remain downloaded if a later part fails.

## What stays intact

- Supported paths, strokes, clipping, transforms, text instructions, font resources and Form XObjects remain in the PDF. Figma sometimes exports visible text as outlines with a separate invisible text layer; the converter preserves that structure. It cannot restore editable text or fonts that Figma omitted.
- Page dimensions and supported link annotations are retained. The normal assembly step adds prototype links and resolves text links, including local and cross-part destinations. Cross-part links still require the original part filenames and a PDF viewer that supports them; see [large exports](LARGE-EXPORTS.md).
- Existing images remain images at their native PDF dimensions. Their colors are converted, rather than turning all surrounding vectors into an image. Grayscale image soft masks and supported normal opacity are preserved.
- Linear and radial gradients remain PDF vector shadings, including shading patterns. Their color functions change to describe CMYK output.

## Color conversion

The plugin asks Figma for an explicit sRGB PDF for CMYK conversion, as the raster mode already does for PNG. The converter uses LittleCMS with relative colorimetric rendering intent and black-point compensation. Actual RGB `ICCBased` source profiles are read from the PDF and used for conversion. Device RGB uses sRGB unless the resource scope supplies a supported `DefaultRGB` override. Device Gray values are converted as neutral sRGB values. The standalone converter is also tested with native P3 fixtures; the current Figma CMYK export request still uses sRGB. Grayscale ICC profiles, already-CMYK source colors and unusual source color spaces are outside this beta's scope.

Solid vector colors and gradient samples use 16-bit RGB-to-CMYK transforms. Output colors refer to the exact selected printer profile through four-component PDF `ICCBased` color spaces. This converts the color values; it does not merely attach a CMYK label.

Supported embedded images have 8-bit RGB or grayscale samples and uncompressed, Flate or RGB JPEG data. JPEGs are decoded locally with the bundled decoder. Their converted CMYK samples use 8 bits per component and lossless Flate compression. Existing JPEG compression is therefore not retained, and the resulting PDF can be larger. Soft-mask samples remain grayscale alpha and are not color-converted or flattened to white in Vector mode.

Gradient conversion is a sampled approximation of the nonlinear ICC transform. Dense 16-bit sampled functions retain the gradient as a vector shading. Type 3 stitching-function boundaries, including mapped nested boundaries, split the conversion into separate intervals so a narrow stop or hard transition is not erased by a single uniform sampling grid. Type 4 calculator functions expose numeric constants as candidate boundaries, but arbitrary calculations can create additional discontinuities. These gradients carry an approximation warning; inspect very narrow color features before printing. This is not a promise of exact evaluation of every possible PDF color function.

## Transparency and print expectations

Normal transparency is valid PDF and is retained where supported. Its appearance can differ from Rasterized CMYK: Rasterized mode composites the RGB page onto white before conversion, while Vector mode converts individual objects and retains their transparency for the viewer or print renderer to composite. A difference was observed in the transparent-overlap test fixture. The export warns when it preserves transparency so this difference can be checked deliberately.

There is no guarantee of identical appearance across RGB and CMYK modes, monitors, PDF viewers, papers or printers. Out-of-gamut colors depend on the selected profile. Review the exported PDF and use the printer's proofing process for production work.

The beta does not produce PDF/X, add a print-conformance claim, or provide spot-color handling, overprint controls, pure-K text preservation, ink-coverage inspection or a certified soft proof. Black text can use multiple inks according to the printer profile. No document-wide output-intent declaration is invented.

## Limits and refusal behavior

| Item | Current limit or behavior |
| --- | --- |
| Embedded color image | 16 million pixels each; at most 16,384 pixels per side |
| Embedded color images converted on one page | 32 million pixels in total; masks require additional memory |
| Drawing content | 16 MiB cumulative decoded page, Form and glyph instructions, with additional instruction and nesting limits |
| Decoded streams | Bounded; the general maximum is 64 MiB, with smaller limits for content, profiles, functions and image dimensions |
| Retained PDF data | Existing 128 MiB budget applies to PDF objects retained for the current output or part |
| Rasterized CMYK | Separate 8-million-pixel whole-page limit; fitting oversized pages lowers raster resolution without changing PDF dimensions |

The PDF-data budget is **not a process-memory limit**. Source PDFs, JPEG decoding, image masks, CMYK buffers, compression, saved output, JavaScript objects and the WebAssembly heap also consume memory. Conversion yields between chunks and checks cancellation, but decoding and compression still need larger temporary buffers. Splitting the export releases completed part data after download and Continue; it does not make an individual over-limit page supported.

Vector mode does not silently downsample embedded images to satisfy its limits. If a page is refused, use a smaller source image or explicitly choose Rasterized with an appropriate quality/fitting setting.

The converter rejects unsupported constructs rather than guessing their colors. These include non-normal blend modes, transparency groups, graphics-state soft masks such as luminosity masks, tiling patterns, mesh shadings, spot/DeviceN/indexed/calibrated color spaces, painted Type 3 glyphs, inline images, transfer functions, image Matte values, custom image decode ranges, and unsupported compression or image formats. Figma's empty Type 3 glyphs used for an invisible text layer are accepted. Non-link annotation appearances and document-wide output profiles are also refused because they need additional conversion. Recursive Forms and resource graphs, malformed data and exceeded budgets stop conversion before replacing the page's content and resources.

## Validation and reproduction

The complete project suite passes **194 tests**; the final focused converter and function suites pass **57 tests**. Coverage includes native sRGB and Display P3 swatch PDFs, native outlined/searchable text and link rectangles, preserved paths and Forms, normal opacity, JPEG and Flate images, nonopaque grayscale masks, narrow gradient bands, and exact destination-profile embedding after save/reload. Separate LittleCMS transforms provide the expected 16-bit solid/gradient values and 8-bit image samples; these checks do not reuse the converter's color methods as their reference.

Regression checks cover numeric RGB operators, direct and mutual Form recursion, an image shared by Forms with different source profiles, cancellation, and early cumulative stream limits. In the stream-limit test, a later stream is never decoded once earlier streams exhaust the content budget. Gradient function evaluation has its own focused suite. These tests establish the covered PDF behavior, not physical printer accuracy or universal PDF support.

Run from the repository root:

```sh
node --test tests/vector-cmyk.test.js tests/pdf-functions.test.js
npm test
```

The larger isolated-browser runner exercises the built UI and actual offline conversion engine using the prior [combined large-and-linked Figma fixture](LARGE-LINKS.md). Its default input is an ignored local artifact, so it is not available in a fresh checkout. The runner expects that specific six-page, 3840×2880-per-page fixture and its known links; `--input` is not a general-purpose PDF benchmark interface.

```sh
npm run build
node scripts/stress-vector-cmyk.mjs \
  --input=test-results/combined-large/live/combined-dev6-vector.pdf \
  --output=docs/vector-cmyk-stress-results.json
```

An alternate built HTML file can be supplied through `PDF_EXPORT_TEST_UI`. The runner checks saved page/image dimensions, text and path counts, exact ICC bytes, four-channel image samples, preserved masks, and all external/local/cross-part link rectangles and destinations. Its [report](vector-cmyk-stress-results.json) records the build hash, scenario status and measurement scope. The measured scenarios and final project-wide test count are summarized below.

The recorded browser run passed both single-PDF and three-part export: six 3840×2880 pages, 66,355,200 converted image pixels, 60 text-show instructions, 18 path paints and all 48 annotations per scenario. Outputs totaled 5,707,747 bytes for one PDF and 7,278,269 bytes for three parts. The multipart run had nine cross-file links; cancellation during actual image conversion produced no download or page acknowledgment. Times of 18.26 and 18.84 seconds include harness setup and output inspection, not Figma rendering, and are measurements of this fixture only.

The browser runner reuses prior Figma-rendered pages and supplies harness-generated backend/scanner messages. It does not exercise a fresh Figma render, native plugin scanning, viewer navigation or a physical printer. Its V8 and backing-store samples exclude parts of browser/Figma/native/GPU memory and can miss temporary peaks; the WebAssembly heap measurement can overlap backing storage.

Live Figma Desktop separately exported the color swatch fixture and the same six large report frames as Vector CMYK with the built-in profile. All seven output pages were rendered with Poppler and visually inspected; the transparent color-overlap difference described above remains a limitation. Structural evidence is recorded in [the swatch inspection](vector-cmyk-swatch-results.json) and [the large-file inspection](vector-cmyk-live-results.json). Poppler reported Type 3 glyph bounding-box warnings, also reproduced on the prior RGB vector source; inspected visible content was present. No physical print proof or additional cross-file viewer navigation was performed.
