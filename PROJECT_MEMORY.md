# PDF Export with Links — project memory

This is persistent project context for future work. Read this file, `README.md` and `docs/AI-REVIEW-HANDOFF.md` before changing the exporter. Historical validation documents describe their recorded builds; do not treat them all as current results.

## Source and release identity

- Repository: https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages
- Community: https://www.figma.com/community/plugin/1535371360850075397
- Preserve plugin ID `1535371360850075397`, offline permissions and dependency/profile licenses.
- Last verified published baseline at preparation: GitHub `v9.0.1`, Figma Community Version 10, source `bf065061b55e06d8e1041b3253264977af6c5419`.
- Current work: publish validated `v9.0.2` from `fix/vector-dpi-size-growth` / PR #3. Implementation `ee498e2` and documentation checkpoint `244c34a` passed CI; final release-documentation commits need exact-head checks. Automated tests, saved-source replay and fresh paired native validation passed. GitHub/Figma publication remains authorized and outstanding until verified. GitHub semantic versions and Figma's sequential version numbers are different.
- Recovery checkpoints: `v8-recovered`, `v9.0.0`, `v9.0.1`. Do not move published tags or modify recovered source/provenance.

## Product decisions to retain

- Simple two-screen flow: frame list, then export settings. Help belongs in hover/focus tooltips; actual progress, errors and quality exceptions remain visible.
- Every listed frame exports. Drag to reorder; right-click/keyboard Remove; Clear list; stable numeric sorting. Track frames and link targets by IDs, not names.
- Defaults: Vector, As file, 72 DPI, PNG, Lower resolution: Don't allow, Single PDF.
- Vector image resolution and Rasterized page resolution are independent remembered settings. Original is available for Vector. Resolution never adds source detail.
- Keep Vector/Rasterized independent of color choice: As file, sRGB, Display P3, CMYK beta. Custom printer ICC is optional because the licensed built-in profile is provided; offline help explains where to find profiles.
- Do not rewrite, hide, move or flatten Figma source layers during export.
- Competitor analysis remains deferred. It is not part of this fix or release.

## Latest defect and agreed fix

v9.0.1 removed rejected-import resource leaks, unused native images and shared-mask interference with downsizing. Its 128 MiB per-output allowance remains an intentional guard, separate from per-page transport and image-pixel limits.

A real report subsequently failed at page 135 of 148 with Vector RGB / 300 DPI, while Original succeeded. JPEG-to-lossless-Flate reencoding can increase compressed data despite reducing pixel dimensions. The new fix compares encoded cost before replacing supported JPEG images in RGB Vector exports. Keep the original image and matching mask, with an explicit warning, if replacement would increase retained image data. Account conservatively for shared masks whose old bytes remain needed elsewhere. Beneficial/equal-size resampling follows the existing path. Do not apply this shortcut to CMYK; it has subsequent conversion/pixel constraints.

Retained originals may be above the requested DPI. Do not describe this as enforcing an exact maximum DPI, adding detail, a generic PDF compressor, or removing memory limits. PNG/JPEG in the interface still controls raster pages and RGB fallbacks, not a new lossy encode for vector images.

## Development and verification

- Edit `src/` and `code.js`; generate committed `ui.html` with `npm run build`.
- Use Node.js 22+, `npm ci --ignore-scripts`, Chromium installed through Playwright, `node --check code.js`, `npm test`, and `git diff --check`.
- Test the actual built UI. Do not replace its bundle during an active development-plugin run; use `PDF_EXPORT_UI_OUTPUT` and `PDF_EXPORT_TEST_UI` for isolated previews when necessary.
- High-DPI validation must check both branches (keep original and downsize), equality, shared masks, source ICC/alpha bytes, cancellation, RGB/CMYK isolation, exact PDF link rectangles/targets, unchanged vectors/text and page geometry.
- A download alone is insufficient. Compare saved PDFs and render pages; record the number and scope inspected. Physical print proof, Windows and arbitrary PDF viewers are separate from macOS/native/browser test evidence.
- Customer PDFs, detailed results, screenshots and file identifiers stay local under ignored `test-results/`. Share only synthetic fixtures and anonymized aggregate evidence in GitHub/source archives.

Latest candidate verification: 304/304 full automated tests and 55/55 focused image/assembly tests passed. Runtime UI SHA-256 is `4e5de515aee4330c0c87b3ced519ee87858f2cd305ca13b3edcaba5a1ee0ec5d`. A clean committed-candidate install/build and second 304-test run also passed, as did implementation and `244c34a` candidate CI. Keep the following evidence distinct:

- **Saved-source built-UI replay:** 148 pages at 300 DPI; 116,682,827 output bytes; peak retained 118,479,434 bytes below the unchanged 128 MiB limit; no fallback/network/browser error. Independent checks preserved all 301 logical links (193 URI, 108 internal; rectangle tolerance 1e-9 pt), geometry, vector/text streams, ICC, 93 original JPEG/mask pairs and seven intended resizes. All 148 renders matched the separately reviewed local diagnostic. This route did not perform fresh Figma rendering/backend scanning.
- **Fresh paired live Figma exports:** the same 148 main frames/order from an intact preceding source revision, Original versus 300 DPI, Vector / As file / PNG / Lower resolution: Don't allow / Single PDF. Original 119,503,661 bytes; 300 DPI 117,104,328 bytes. All 304 annotations (193 URI, 111 internal), page geometry, decoded vector/text streams and ICC were exact. Of 101 JPEGs, 94 image/mask pairs stayed byte-identical and seven resized to verified 300-DPI dimensions; all encoded pair costs were nonincreasing. All 1,264 checked Flate streams were valid. All 148 pages rendered at 72 DPI: 144 pixel-identical; four changed pages reviewed at 150 DPI with no new visible defect. Only the intended JPEG warning appeared at 300 DPI, none at Original. The source section retained its 152-frame count after both exports.

Fresh native validation is complete; publication remains requested and outstanding. Do not substitute the saved-source 301-link counts for the fresh native 304-link counts or claim a calibrated print proof. Preserve unrelated design changes and private source artifacts; publish aggregate evidence only.

## Publishing and handoff

Follow `docs/RELEASING.md`: finish validation and review, run checks on the exact candidate commit, merge, tag, create a source archive/checksum, release on GitHub, then publish through Figma Desktop for the existing Community ID. Verify both destinations and run the Community-installed version. Record any incomplete destination honestly.

Never equate a local development import, Git push and Community publication. Runtime hashes identify the local build unless a published bundle was independently downloaded and compared. Do not claim the original reporter's unavailable file is fixed solely from synthetic tests.

`docs/AI-REVIEW-HANDOFF.md` is the shareable whole-project review guide. Release notes and aggregate evidence live under `docs/releases/`; the release's publication JSON asset records the final commit, archive, CI, Community version and post-publication check. Preserve prior source archives for recovery.
