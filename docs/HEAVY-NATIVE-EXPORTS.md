# Heavy native PDF exports: November 2026 investigation

Status: development fix based on v9.0.0; not published to Figma Community.

## Report and scope

A Community user reported that 77 screenshot-heavy frames which exported before v9 now stop at the **128 MiB retained-data allowance**, even at 36/72 DPI, JPEG, Lower resolution Allow and 15 pages per part. Their file is unavailable. The reproductions below establish bugs in the released implementation; they do not establish which condition exists in that file.

The quoted message comes from the output PDF assembler. It is separate from the per-page transfer limit and is checked after each imported page, before completing a part. Fifteen pages per part is not a guarantee that the first part fits.

The retained-data allowance was introduced during v9 development. It estimates serialized PDF objects, not total Figma/browser memory. It remains at 128 MiB per PDF, with the existing final-size and per-page safeguards.

## Confirmed defects and fixes

1. **Rejected native imports retained copied streams.** `copyPages` registers resources before the page is accepted. A later error (reproduced with a document-wide output color profile) caused an RGB raster retry but left those resources in the output. Removing a page alone did not remove them. Failed native imports now remove objects allocated by that attempt, preserving previously accepted pages.
2. **Unused images were copied and counted.** Native page Resources can contain images that no drawing command uses. DPI reduction examines painted images, while `copyPages` copies the whole resource dictionary. A synthetic page with an unused 9 MiB image exceeded the production budget in a 15-page part despite successfully reducing its visible image. A bounded, conservative analysis now removes proven-unused XObject entries before resizing, CMYK conversion and import, including at Original resolution.
3. **Shared mask resources blocked unrelated image resizing.** A path-only transparency mask sharing a page's resource dictionary caused ordinary page images to be treated as mask images. Protection now follows actual mask/pattern drawing instructions. Images genuinely used by masks remain protected; unsupported content retains its original data with a warning.

Resource analysis includes nested/inherited Forms, transparency groups, tiling patterns, Type3 glyphs and annotation appearances. Shared dictionaries combine uses across contexts. Unknown structures skip pruning; indirect objects are not globally deleted. These choices favor preserving appearance over reducing size.

If a real output still exceeds the limit, its failure identifies the page/part and retains image-resolution warnings. The message explains that selecting JPEG alone does not recompress images inside successful vector pages.

## Settings and immediate workaround

- **Vector + JPEG** uses JPEG for whole-page RGB fallbacks only. It does not change the encoding of images inside an accepted native PDF.
- **Lower resolution: Allow** fits raster renders to pixel/side limits. It does not dynamically reduce a PDF to the 128 MiB budget.
- **36/72 DPI in Vector** reduces supported painted images. Unsupported or excessively large source images can remain original, with a warning.
- For a heavy RGB file, explicitly select **Rasterized**, then **JPEG**, 72 or 36 DPI, and a small number of pages per part. A particularly heavy single page may still need simplification. This workaround has not been tested on the unavailable reported file.

Keep split filenames together. Same-part links use local destinations and cross-part links use remote PDF destinations; viewer support for remote links is unchanged.

## Validation

All **294 automated tests passed**, including 30 new regressions. Coverage includes rollback after partial imports, exact link geometry and targets, repeated names, cancellation, multipart continuation, masks/patterns, color profiles, RGB/CMYK and the existing controls. Independent code review found no remaining actionable correctness issue in these changes.

The [77-page browser benchmark](heavy-native-results.json) uses the actual built UI with the unchanged production allowance. Each synthetic native page includes an unused 9 MiB image, one painted image, five native URI annotations and two internal links.

| Build and settings | Result | Peak sampled retained PDF data |
| --- | --- | ---: |
| Released v9, 36 DPI, JPEG, Allow, split 15 | Stopped on page 15; zero downloads | 135.69 MiB |
| Fixed, Original, single PDF | 77 pages | 13.85 MiB |
| Fixed, 72 DPI, single PDF | 77 pages | 5.50 MiB |
| Fixed, 36 DPI, single PDF | 77 pages | 3.56 MiB |
| Fixed, 36 DPI, split 15 | 77 pages in six parts | 0.695 MiB |

Every successful run retained all **385 external and 154 internal links**. The split run includes 12 cross-part destinations; filenames, page indexes and rectangles are exact. All saved page dimensions, decoded drawing commands and used-image dimensions were checked after reloading. No raster fallback, network request or browser error occurred. The harness supplies native PDF messages; it does not run Figma's renderer or measure whole-process/peak memory. These synthetic reductions are not promised compression ratios for real files.

A [native Figma Desktop smoke test](heavy-native-live-results.json) also exported eight existing synthetic frames at Vector / As file / 36 DPI / JPEG fallback / Allow. All eight dimensions and ten exact links match the previous native fixture. The saved PDF is 213,907 bytes. All eight pages were rendered and visually inspected, covering wrapped links, rotated text, shadow, blur, effect layers, overflow and the expected Plus lighter fallback. Poppler still reports the earlier native Type3 glyph bounding-box warnings; no missing content was observed.

Tested UI SHA-256: `d88c565d0ee67c2c28280cb7c126f30168c7e5e2f8e52d1af841a1226981e938`. The canonical build exactly matches the temporary tested bundle; backend syntax validation passed. Package version and the published v9 tag remain unchanged.

GitHub's `ubuntu-latest` runner resolved to Ubuntu 26.04, which the pinned Playwright 1.56.1 cannot install on. CI is now pinned to supported Ubuntu 24.04; no plugin runtime dependency was changed.

Reproduce from the repository:

```sh
npm run build
npm test
node scripts/stress-native-resources.mjs
```

The benchmark reads the unchanged `v9.0.0:ui.html` for its baseline. It also accepts `PDF_EXPORT_TEST_UI` and `--baseline-ui=/path/to/released-ui.html`. Generated PDFs and detailed local artifacts stay under ignored `test-results/`; only synthetic evidence belongs in Git. The reported user's exact file, Windows, physical printing and cross-file viewer navigation remain unverified in this investigation.
