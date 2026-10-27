# Figma to PDF with links and multiple pages

Export selected Figma frames into one PDF with individual page sizes, internal navigation and external hyperlinks.

[Published Community plugin](https://www.figma.com/community/plugin/1535371360850075397) · [Recovered v8 baseline](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/tree/v8-recovered)

## Development version

This branch is **v9.0.0-dev.5**. The Community release is still v8. Importing or running this development copy does not publish an update.

The v9 exporter uses Figma's native whole-frame PDF export, preserving native text-link rectangles. Raster pages recover the same text-link geometry from an auxiliary native PDF. Prototype hotspots are added using transformed, clipped bounds and stable frame IDs. Every page is acknowledged before the next is rendered. PNG buffers are released after embedding; optional JPEG pages keep their compressed image data.

Other changes include cancellation, detection of edits during export, fresh frame dimensions, explicit failures instead of blank placeholder pages, stable sorting and selection, and an offline bundled PDF library. Original layers are never hidden or rewritten during export.

**Color profile** defaults to **Same as Figma file**, including older files. Explicit sRGB and Display P3 remain available. The chosen profile applies to vector pages, raster pages, and fallbacks; raster profiles are embedded in the PDF, including compressed JPEGs. See [color-profile behavior and validation](docs/COLOR-PROFILES.md).

**CMYK (beta)** works immediately using the built-in basICColor ISO Coated v2 300% profile (FOGRA39 coated paper). An optional custom printer ICC profile can replace it. Conversion stays entirely offline. Links and page dimensions remain intact; text becomes pixels and transparency is flattened onto white. This is not a vector CMYK or PDF/X exporter. See [CMYK setup, limits and validation](docs/CMYK.md), or [where to find profiles on Mac and Windows](docs/ICC-PROFILES.md).

## Run and develop

Requires Node.js 22 or later for the development tools and Figma Desktop for importing a local plugin.

```sh
npm ci --ignore-scripts
npm run build
```

1. Open a test design file in Figma Desktop using an account with editing access.
2. Choose **Plugins → Development → Import plugin from manifest** and select `manifest.json`.
3. Run **PDF Export with Links — v9 Dev**.
4. Select frames, arrange the export order, choose Vector or Rasterized, then export.

Edit `code.js` for the Figma-side logic and `src/ui.html` for the interface and PDF assembly. Color helpers are in `src/color-profiles.js` and `src/cmyk.js`. `ui.html` is generated and committed so a checkout can also be imported immediately. Build after UI changes. `manifest.json` declares no network access; PDF and color-conversion libraries are bundled locally with their notices in `licenses/`.

## Checks

```sh
npx playwright install chromium
npm run build
npm test
npm run test:stress
```

The normal suite checks the export protocol, link extraction, real PDF assembly and browser lifecycle. The separate stress benchmark compares PNG and JPEG on the same large synthetic images and checks multipart exports; it takes longer. GitHub Actions runs the normal checks and verifies the committed UI matches its source.

See [large-file export options and validation](docs/LARGE-EXPORTS.md), [initial v9 validation](docs/VALIDATION.md), [Community report triage](docs/COMMUNITY-BUGS.md), and [measured browser stress results](docs/stress-results.json). Passing synthetic tests does not guarantee every design, font, effect, PDF viewer or permission configuration.

## Current limits

- Raster rendering: at most **32 million scaled pixels** and **16,384 pixels per side**. Lower the quality or export a smaller frame when a request exceeds these limits.
- CMYK beta: at most **8 million scaled pixels** per page because decoding and conversion need additional memory. Fit oversized pages uses this lower limit. The built-in profile describes FOGRA39 coated printing; use a custom profile when your printer specifies another condition.
- Transport budget: **128 MiB per page**, including temporary text-link data. Earlier pages and discarded retries do not consume this allowance.
- PDF data budget: **128 MiB per output document**, estimated from retained PDF objects and streams. This is not a total-memory measurement; final serialization needs additional memory. Split into smaller parts or use JPEG when a document exceeds it.
- Vector mode rasterizes whole frames containing Figma's unsupported Plus lighter/darker blend modes, or when native export/import fails. The UI identifies fallback pages.
- Text links require native PDF annotation geometry. Missing or ambiguous geometry is omitted with a warning rather than guessed. Desktop Figma node URLs identify distinct internal targets; an empty native URI cannot distinguish multiple internal targets in one text layer.
- Internal destinations must be included in the same export. Selected sources must be frames. Prototype actions are represented as static PDF hyperlinks, not interactive animations, overlays or conditional flows.
- Optional **Fit oversized pages** lowers raster resolution to the pixel limits and reports the actual scale; it preserves PDF page dimensions.
- **Split into parts** saves one document at a time. Keep the original filenames together for links between parts; these links need a compatible desktop PDF viewer. Save each part before continuing within 15 minutes. Stopping midway leaves earlier files intact, with links to unfinished parts unavailable.
- JPEG can help image-heavy pages but is lossy, may soften small text, and turns transparent areas white. It does not always produce a smaller file. PNG remains the default.
- Keep source pages unchanged while rendering and between parts. Edits cancel the export to prevent mismatched visuals and links.

## Recovery provenance

Tag `v8-recovered` preserves the actual JavaScript and HTML published on February 17, 2026 (Figma release ID `188025`), recovered on October 27, 2026. Its main code matches v7; its UI adds stable numeric-aware name sorting. The supporting manifest came from repository v7 and was not independently recovered.

`recovery/` contains the unchanged downloaded bundle, provenance, checksums and v7-to-v8 comparison. Those checksums describe the recovered baseline, not this modified development version.
