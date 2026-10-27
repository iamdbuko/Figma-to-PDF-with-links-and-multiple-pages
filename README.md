# Figma to PDF with links and multiple pages

Export selected Figma frames into one PDF with individual page sizes, internal navigation and external hyperlinks.

[Published Community plugin](https://www.figma.com/community/plugin/1535371360850075397) · [Recovered v8 baseline](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/tree/v8-recovered)

## Development version

This branch is **v9.0.0-dev.1**. The Community release is still v8. Importing or running this development copy does not publish an update.

The v9 exporter uses Figma's native whole-frame PDF export, preserving native text-link rectangles. PNG pages recover the same text-link geometry from an auxiliary native PDF. Prototype hotspots are added using transformed, clipped bounds and stable frame IDs. Every page is acknowledged before the next is rendered, and decoded PNG pixels are compressed before that acknowledgment.

Other changes include cancellation, detection of edits during export, fresh frame dimensions, explicit failures instead of blank placeholder pages, stable sorting and selection, and an offline bundled PDF library. Original layers are never hidden or rewritten during export.

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

Edit `code.js` for the Figma-side logic and `src/ui.html` for the interface and PDF assembly. `ui.html` is generated and committed so a checkout can also be imported immediately. Build after UI changes. `manifest.json` declares no network access; `pdf-lib` 1.17.1 is bundled locally with its MIT notice in `licenses/`.

## Checks

```sh
npx playwright install chromium
npm run build
npm test
npm run test:stress
```

The normal suite checks the export protocol, link extraction, real PDF assembly and browser lifecycle. The separate stress benchmark generates large synthetic images and takes longer. GitHub Actions runs the normal checks and verifies the committed UI matches its source.

See [validation and limits](docs/VALIDATION.md), [Community report triage](docs/COMMUNITY-BUGS.md), and [measured browser stress results](docs/stress-results.json). Passing synthetic tests does not guarantee every design, font, effect, PDF viewer or permission configuration.

## Current limits

- Raster rendering: at most **32 million scaled pixels** and **16,384 pixels per side**. Lower the quality or export a smaller frame when a request exceeds these limits.
- Exported input budget: **128 MiB** per job, including auxiliary annotation PDFs and retries. This is a provisional guard, not a total-memory measurement. Final PDF assembly still holds document resources in memory.
- Vector mode rasterizes whole frames containing Figma's unsupported Plus lighter/darker blend modes, or when native export/import fails. The UI identifies fallback pages.
- Text links require native PDF annotation geometry. Missing or ambiguous geometry is omitted with a warning rather than guessed. Desktop Figma node URLs identify distinct internal targets; an empty native URI cannot distinguish multiple internal targets in one text layer.
- Internal destinations must be included in the same export. Selected sources must be frames. Prototype actions are represented as static PDF hyperlinks, not interactive animations, overlays or conditional flows.
- Keep source pages unchanged while rendering. Edits cancel the export to prevent mismatched visuals and links.

## Recovery provenance

Tag `v8-recovered` preserves the actual JavaScript and HTML published on February 17, 2026 (Figma release ID `188025`), recovered on October 27, 2026. Its main code matches v7; its UI adds stable numeric-aware name sorting. The supporting manifest came from repository v7 and was not independently recovered.

`recovery/` contains the unchanged downloaded bundle, provenance, checksums and v7-to-v8 comparison. Those checksums describe the recovered baseline, not this modified development version.
