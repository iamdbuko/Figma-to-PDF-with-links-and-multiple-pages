# Figma to PDF with links and multiple pages

Export Figma frames into a multi-page PDF with internal navigation and external hyperlinks.

[Open the published Figma plugin](https://www.figma.com/community/plugin/1535371360850075397)

## Published v8 baseline

This repository now preserves the actual Version 8 JavaScript and HTML published on February 17, 2026 (Figma release ID `188025`). The code was recovered on October 27, 2026 from the package Figma loaded when running that published release.

The main plugin code is identical to v7. The v8 interface adds stable, numeric-aware A-Z/Z-A frame sorting. The supporting manifest is retained from the repository's v7 baseline; it was not independently recovered from Figma.

Recovery evidence, the unchanged downloaded bundle, source checksums, and the v7-to-v8 comparison are in `recovery/`.

## Local development

1. Open a test design file in Figma Desktop.
2. Choose Plugins > Development > Import plugin from manifest.
3. Select this repository's `manifest.json`.
4. Run the development plugin and select frames to add them to the export list.

There is no build step: Figma loads `code.js` and `ui.html` directly. The interface currently loads PDF libraries from the network.

Importing a development plugin does not publish an update to the Community. Publishing is a separate action.

## Validation of the recovered baseline

The downloaded bundle, extracted plugin code, and inline interface scripts passed syntax checks. The published plugin was observed running with its v8 sorting control. This establishes source provenance; it does not claim complete PDF export or performance coverage.

Use the `v8-recovered` tag to return to this baseline. Future development takes place separately from this snapshot.
