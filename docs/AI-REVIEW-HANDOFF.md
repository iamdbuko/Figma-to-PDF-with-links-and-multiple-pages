# Independent AI review handoff — PDF Export with Links

## Purpose and current status

Perform an independent **whole-plugin review of functionality, correctness and performance**, with particular attention to the **v9.0.2** fix for oversized RGB Vector exports at high image resolution, including 300 DPI. Review the existing interface, rendering, links, colors, large-file behavior, cancellation and resource safeguards as well as the recent patch. Start read-only; identify reproducible problems and evidence gaps before proposing implementation changes.

**v9.0.2 is published on GitHub and as Figma Community Version 11; the Community-installed 148-page export check passed.** The full local suite passed 304 tests, including 55 focused image-resolution and PDF-assembly tests, and passed again after a clean install/build. Final candidate and exact merge-commit CI succeeded. Two fresh native exports of the same 148-frame selection, at Original and 300 DPI, passed exact structural/link comparisons and visual review before publication. The installed Community plugin then produced matching page content, links, profiles and images. Earlier saved-PDF diagnostics and built-UI replay remain separate evidence with their own counts and limitations.

- Repository: [iamdbuko/Figma-to-PDF-with-links-and-multiple-pages](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages).
- Community plugin: [PDF Export with Links](https://www.figma.com/community/plugin/1535371360850075397).
- Existing plugin ID: `1535371360850075397`. Preserve it when publishing an update.
- Current release: [v9.0.2](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/releases/tag/v9.0.2), tag commit `2fef2bc5ff82e7fffd3b208b32d1314f78cdf4ca`. Its tree matches final candidate `ad71a152bec8b83727a8947aa90cbdbb9ee715d3`. Previous release: `v9.0.1` at `bf065061b55e06d8e1041b3253264977af6c5419`.
- [PR #3](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/pull/3) merged on November 13, 2026 at 20:24:29 UTC. The GitHub release was published at 20:25:41 UTC; Figma confirmed publication at approximately 20:26 UTC, and its public listing shows Version 11 dated November 13 with the matching high-DPI notes. Existing plugin identity, metadata and offline permissions were retained.
- Final candidate CI passed: [run 43500776388](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43500776388), [run 43500785221](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43500785221). [Exact merge-commit CI](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43501271774) also passed.
- Runtime is offline: `manifest.json` declares `allowedDomains: ["none"]`. Conversion does not upload designs or ICC profiles.

No private design, customer identity, file key or personal filesystem path is needed to review this change. Committed fixtures are synthetic; locally generated PDFs and screenshots belong in ignored `test-results/`.

The [source archive](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/releases/download/v9.0.2/pdf-export-v9.0.2-2026-11-13.zip) contains 136 entries, is 2,772,885 bytes, and has SHA-256 `cdfde6a0ba68a33374c8ddb941fe28a938c5de006fa17f6617b10bcc83e76d69`; the remote asset digest matches. The [verified publication record](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/releases/download/v9.0.2/pdf-export-v9.0.2-publication.json) is uploaded and verified (3,976 bytes; SHA-256 `40de51be35e9b13516a9a2c6a506b459ea30facee5a54f1bddd6f309eefc1f43`). This post-publication documentation update does not move the release tag or replace its archive.

## History and evidence boundaries

| Checkpoint | Meaning and recorded evidence |
| --- | --- |
| `v8-recovered` — `eed873decc55939083887c95300d117419afd18a` | Recovered JavaScript/HTML from the actual February 2026 Community version. The supporting manifest came from the older repository. Preserve the tag, original bundle and checksums in `recovery/`; they are historical evidence, not current sources. |
| `v9.0.0` — `1efa1217c0d4976fc7e57744a648f287711361b6` | Native whole-frame PDF pipeline, offline libraries, accurate link geometry, color options, bounded CMYK conversion, multipart exports and the simplified interface. Final packaging records 264 passing tests. |
| `v9.0.1` — `bf065061b55e06d8e1041b3253264977af6c5419` | Fixes rejected-import resource leaks, proven-unused native XObjects and shared-mask resources blocking unrelated image resizing. Records 294 passing tests, an eight-frame native smoke test and the 77-page resource benchmark. |
| `v9.0.2` — current release above | Guards against JPEG-to-Flate size inflation during RGB Vector image downsizing. Independent review, 304 tests, the clean rerun, release CI and fresh paired native 148-page validation passed. Published on GitHub and as Community Version 11; the installed Community plugin passed the 148-page export comparison. |

Read [v9.0.0 notes](releases/v9.0.0.md), [v9.0.1 notes](releases/v9.0.1.md), [v9.0.1 validation](releases/v9.0.1-validation.json) and the [heavy-export investigation](HEAVY-NATIVE-EXPORTS.md). Historical development documents retain their original dates and test counts; do not treat all of them as measurements of the current patch.

The v9.0.1 77-page synthetic benchmark reproduced the old limit failure on page 15, then completed Original/72/36-DPI single files and six split parts with the fix. Each successful run checked 385 external and 154 internal links. It tests unused-resource retention, **not** the new high-DPI JPEG inflation case. Browser benchmarks supply exported pages to the UI; they do not run Figma's renderer or measure total process memory. Native smoke tests and rendered inspection are separate evidence. No existing result guarantees every source design, Windows installation, PDF viewer or printing condition.

### Release validation

| Evidence | Status |
| --- | --- |
| Focused resizing and assembly suites | 55/55 passed locally; included in the full-suite count below |
| Full `npm test` | 304/304 passed locally; browser launch required the local environment's permission, with no code-test failure |
| Clean full-suite rerun of implementation candidate `ee498e2` | 304/304 passed; canonical UI and license files reproduced exactly |
| Tested generated `ui.html` SHA-256 | `4e5de515aee4330c0c87b3ced519ee87858f2cd305ca13b3edcaba5a1ee0ec5d` |
| Independent patch review | Shared-mask accounting defect found and fixed; no remaining blocking finding in the reviewed scope |
| Local processing of an existing 148-page PDF at 300 DPI | Structural/link checks passed; output 116,689,727 bytes versus 119,490,186 bytes at Original |
| Rendered inspection of that local diagnostic output | All 148 pages compared at 72 DPI: 144 pixel-identical; four changed pages reviewed at 150 DPI with no visible defects |
| Actual built-UI replay of the saved 148-page native PDF | Completed in 54.2 seconds; saved 116,682,827 bytes; peak retained PDF data 118,479,434 bytes, below the unchanged 128 MiB limit; no fallback, network request or browser error; intended JPEG warning shown |
| Independent comparison/rendering of the built-UI replay output | Passed: targets/types/multiplicities exact; internal rectangles within 1e-9 point; all 148 rendered pages pixel-identical to the visually reviewed local diagnostic output |
| Implementation-commit CI | Succeeded for `ee498e2`: [run 43496175311](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43496175311) |
| Documentation-checkpoint CI | Succeeded for `244c34a`: [PR run 43497883930](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43497883930), [push run 43497870895](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43497870895) |
| Fresh paired live Figma exports | Passed on the same 148 main frames in an intact preceding source revision: Original 119,503,661 bytes; 300 DPI 117,104,328 bytes; all 304 annotations exact |
| Independent native render review | All 148 pages rendered at 72 DPI: 144 pixel-identical; four changed pages reviewed at 150 DPI with no new visible defect |
| Final candidate and merge CI | Passed: candidate runs [43500776388](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43500776388) / [43500785221](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43500785221); merge run [43501271774](https://github.com/iamdbuko/Figma-to-PDF-with-links-and-multiple-pages/actions/runs/43501271774) |
| GitHub release and Figma publication | Verified: v9.0.2 / Community Version 11, November 13, 2026 |
| Community-installed post-publication test | Passed: 148 pages, 117,104,328 bytes; all geometry, 304 annotation rectangles/targets, non-image streams, ICC bytes and 101 image/mask pairs match the validated development output |

See [DPI-SIZE-GUARD.md](DPI-SIZE-GUARD.md) for the mechanism, focused evidence and remaining limits. The runtime hash identifies the tested build included in the release archive; no independently downloaded Community bundle comparison is claimed here.

The local 148-page diagnostic preserved all 301 annotations exactly (193 external URI and 108 internal), all page boxes, decoded non-image streams and ICC profiles. It retained 93 original JPEG/mask pairs byte-for-byte and resized seven images to independently checked 300-DPI dimensions. The size guard avoided 72 attempted replacements whose encoded size would grow; all 653 output Flate streams validated. Its rendered review passed.

Independent verification of the built-UI replay confirmed the same page, image and stream results. All 301 link targets, types and multiplicities matched. Its harness's coordinate round trip changed 27 internal rectangles by at most 5.684e-14 point; every rectangle was within 1e-9 point, so this is a tolerance comparison, not a bit-exact rectangle claim. All 148 replay renders at 72 DPI and the four changed-page renders at 150 DPI were pixel-identical to the visually reviewed local diagnostic output, with no new visible defect.

The later live test freshly exported the same 148 main frames and order twice from an intact preceding source revision: Vector / As file / Original versus 300 DPI, PNG, Lower resolution: Don't allow, Single PDF. Unlike the saved-source replay, this pair has **304 exactly matching annotations** (193 URI, 111 internal), with no coordinate-roundoff exception. All page geometry, decoded non-image vector/text streams and ICC bytes match. Of 101 source JPEGs, 94 original image/mask pairs remain byte-identical and seven have independently verified 300-DPI dimensions; all 101 encoded pair costs are nonincreasing. All 1,264 Flate streams in the fresh 300-DPI output are valid. The fresh 300-DPI file is 2,399,333 bytes smaller than fresh Original. Only the intended JPEG-retention warning appeared at 300 DPI; Original had none. The source section retained its 152-frame count after both exports. All 148 pages were rendered, and detailed review of the four changed pages found no new visible defect. Only aggregate results are committed; no calibrated print proof is implied.

After publication, the actual installed Community Version 11 exported the same 148-page selection at RGB Vector / As file / 300 DPI / PNG / Lower resolution: Don't allow / Single PDF. Its 117,104,328-byte output exactly matches the validated development output's page geometry, all 304 annotation rectangles/targets (193 URI, 111 internal), decoded non-image streams and ICC bytes. All 101 image/mask pairs are byte-identical, and all 1,264 Flate streams validate. Only creation/modification date metadata differs. The prior full visual review applies to identical page content; all pages were not rendered again. This verifies installed-plugin behavior, not a separately downloaded Community runtime-bundle hash.

## Runtime map

| File | Responsibility and review boundary |
| --- | --- |
| `code.js` | Figma sandbox: frame collection, refreshed bounds and links, source-edit checks, native PDF/PNG/JPG export, per-page guards, acknowledgments, cancellation and timeout state. Does not hide or rewrite source layers. |
| `src/ui.html` | Two-screen interface, immutable export settings, import/assembly, budget checks, links, downloads, multipart planning and cleanup. `appendExportPage` invokes the image resampler before copying native pages. Failed copy attempts roll back newly registered PDF objects. |
| `src/pdf-image-resolution.js` | Follows used image placements through drawing instructions; downsizes supported images without changing page geometry or vector/text instructions. Stages changes and protects actual mask/pattern images. Primary implementation area for this fix. |
| `src/pdf-resource-pruning.js` | Conservative, bounded analysis removes proven-unused XObject entries before resampling/import, including at Original quality. Unknown structures retain resources with a warning. Do not replace this with unrestricted graph deletion. |
| `src/pdf-loader.js` | Pinned-library import adapter preserves exact declared stream bytes where pdf-lib can trim a terminal CR/LF. It is not a generic PDF repair engine. |
| `src/color-profiles.js` | RGB ICC extraction, validation and embedding; native color-resource preservation. No unverified relabeling of pixels. |
| `src/cmyk.js`, `src/vector-cmyk.js`, `src/pdf-functions.js` | Offline LittleCMS transforms, supported vector-PDF conversion and bounded gradient-function evaluation. CMYK behavior is outside the intended size-preservation change. |
| `src/cooperative-yield.js` | Posted-message scheduling for processing and cancellation. The build adapts the pinned PDF library's waits to the same scheduler; positive timeout/download-cleanup timers remain separate. |
| `scripts/build.mjs` | Generates committed `ui.html` from sources, pinned libraries, WASM and the licensed ICC asset. Preserves runtime dependency notices and checks pinned adapter/profile hashes. |

Dependencies are pinned in `package-lock.json`: pdf-lib 1.17.1, jpeg-js 0.4.4, lcms-wasm 1.0.5; build/test tools include esbuild and Playwright. Review the lockfile rather than assuming newer APIs. Edit source files, not generated `ui.html`.

## Behavior that must remain intact

**Interface.** The frame list precedes settings. Every listed frame exports; there are no inclusion checkboxes. Preserve drag ordering, stable numeric A–Z/Z–A sorting, right-click/keyboard removal, clear/re-add and repeated-name handling by stable frame ID. Defaults are Vector, As file, 72 DPI, PNG, Lower resolution: Don't allow, Single PDF. More exposes Original for Vector and the higher resolutions through 300 DPI. Vector image DPI and Rasterized page DPI retain separate values when switching modes. Both screens remain mounted so custom ICC bytes/settings survive navigation. Help supports hover and keyboard focus; actual progress/errors/warnings stay visible. See [interface requirements](INTERFACE.md).

**Rendering and colors.** RGB Vector first uses Figma's native PDF. Unsupported blending or native export/import failure can retry the whole page in the selected raster format, with a warning. The PNG/JPEG selector affects Rasterized pages and these fallbacks; it does not recompress images inside a successful native PDF. Original preserves native image resolution; selected DPI only downsizes supported images and never adds detail.

As file preserves the exported RGB profile. Assigned sRGB/P3 is resolved at job start. Legacy files use `DOCUMENT`; a small PNG profile probe can supply missing JPEG color metadata. Explicit sRGB and Display P3 are supported. Keep source ICC bytes, channel interpretation and grayscale alpha intact; do not assume all RGB means sRGB. See [color behavior](COLOR-PROFILES.md).

CMYK remains a beta using a built-in ISO Coated v2 300% (basICColor, FOGRA39 coated-paper) profile or a bounded custom printer ICC. It performs real color conversion. Vector CMYK preserves its supported native PDF subset and fails on unsupported content without silently rasterizing it. Rasterized CMYK flattens onto white. Transparency and sampled gradients can differ in appearance; there is no PDF/X, spot-color, overprint, pure-K text or physical-proof guarantee. See [CMYK setup](CMYK.md) and [Vector CMYK limits](VECTOR-CMYK.md).

**Links and lifecycle.** Native PDF annotation rectangles provide precise text-link geometry, including auxiliary PDFs for raster output. Prototype hotspots use transformed/clipped bounds. Preserve external URLs, distinct internal NODE targets, duplicate suppression and page dimensions. Ambiguous text geometry is warned and omitted rather than guessed.

Only one rendered page is in flight. A failed page cannot become a successful blank page. Cancel must prevent late downloads and wait for pending work to settle before unlocking. Splitting uses a known page-count plan and relative filenames for cross-part destinations. Save each part before Continue; a 15-minute pause limit applies. Earlier downloaded parts remain when a later part fails. Keep filenames together; cross-file navigation depends on the PDF viewer. Source edits cancel the active export. See [large exports](LARGE-EXPORTS.md).

| Guard | Baseline limit |
| --- | --- |
| RGB raster page | 32 million scaled pixels; 16,384 pixels per side |
| Rasterized CMYK page | 8 million scaled pixels; same side limit |
| Vector image resizing | 20 million source pixels/image, 80 million decoded source pixels/page, 16 million output pixels/image |
| Vector CMYK conversion | 16 million pixels/image; 32 million converted image pixels/page, plus content/recursion limits |
| Page transfer | 128 MiB including annotation/profile auxiliary data |
| Retained PDF data and saved output | 128 MiB per output document/part |

These are distinct limits, not a total-memory bound. Lower resolution: Allow fits raster pixels to their limits; it does not automatically make a PDF fit the byte budget. A 15-page part can exceed the allowance before it is saved. Do not raise limits to hide the inflation bug.

## The 300 DPI issue and v9.0.2 change

In the baseline, an embedded JPEG that needs downsizing is decoded, resized and written as a lossless Flate image. Near its original effective resolution, 300 DPI may remove relatively few pixels while losing JPEG's compression advantage. The replacement can therefore contain more encoded bytes than the source, grow the PDF and trigger the retained-data limit. This is separate from the unused-resource/import-leak defects fixed in v9.0.1.

The implemented narrow fix is for **JPEG images in RGB Vector output**: after producing a valid resized candidate, compare its encoded image data and corresponding soft-mask cost with the original. If the candidate would be larger, retain the original image/mask and explicitly warn that original resolution was kept to avoid increasing PDF size. Beneficial downsizing, equal encoded costs and non-JPEG images retain the existing behavior. The helper option `preserveSmallerJpeg` defaults to false, and the UI enables it for RGB native pages only. Retaining the original preserves its JPEG bytes, profile references and masks; it introduces no new lossy encode or color conversion.

Mask ownership matters in that comparison. An original soft mask shared by another retained resource does not disappear when this image is replaced. Its bytes are credited as savings only when a bounded whole-source-context scan proves exclusive ownership, including indirect references and direct dictionaries/arrays. Shared, uncertain or oversized graphs receive no original-mask credit. Saved-output regressions cover both another painted image and a nested metadata reference that keeps the mask reachable.

Retaining the original can leave that image above the requested DPI. The warning and help must make this exception understandable; do not claim every exported image exactly meets the chosen resolution. Page dimensions, vectors, text instructions and links must remain unchanged.

**Do not apply this shortcut to CMYK.** Its subsequent RGB-to-CMYK conversion changes encoding, pixel requirements and size behavior. CMYK continues through its established resampling/conversion guards. Original mode and whole-page PNG/JPEG raster exports are unchanged. Review these boundaries independently rather than extending the RGB shortcut to other paths.

## Review and verification plan

### Whole-plugin priorities

1. **Rendering and feature parity.** Compare the recovered v8 behavior with the current native pipeline using [FUNCTIONALITY-AUDIT.md](FUNCTIONALITY-AUDIT.md). Separate intentional changes from regressions: whole-frame native export replaces visibility mutation and segmented assembly, while the simplified list deliberately removes inclusion checkboxes. Investigate missing or shifted content, clipping, rotation, masks, inherited/shared resources, gradients and unsupported-effect handling. Original quality should preserve native image resolution, not restore the old exporter.
2. **Large files and performance.** Trace transferred bytes, reachable/retained PDF objects, decoded buffers and saved output separately. Look for duplicated/orphaned streams, ineffective DPI controls, compression expansion, oversized individual pages, cleanup failures and work that blocks cancellation. Test the actual production guard and acknowledge that browser heap samples exclude other memory. Splitting should release completed part state without corrupting cross-part links.
3. **Color and print expectations.** Verify actual profile bytes and sample-channel interpretation through RGB, Display P3, legacy DOCUMENT, JPEG/PNG and both CMYK paths. Check source/destination ICC references, alpha semantics and retained transparency. Unsupported content must not be silently mislabeled or presented as certified print output. Preserve the documented CMYK beta boundaries.
4. **Links and page identity.** Cover exact native text rectangles, wrapped links, multiple internal targets, prototype transforms/clipping, hidden elements, duplicate names, reorder/removal, local and cross-file destinations. Inspect saved and reloaded PDFs; a count of annotations alone cannot establish correct targets or clickable regions.
5. **Interface and asynchronous lifecycle.** Check visible controls and keyboard access, all-listed-frame behavior, independent Vector/Raster quality, settings/custom-file races, deferred selection updates, retries and stale job messages. Cancellation during render/import/resize/convert/save and between parts must not cause late downloads or unlock controls before cleanup. Preserve prior completed files and explain unfinished links honestly.
6. **Privacy, packaging and notices.** Confirm the runtime remains offline, source layers are not mutated and private artifacts do not enter commits or reports. Match source to generated `ui.html`, retain dependency/profile licenses and provenance, preserve plugin identity and verify the exact reviewed/released build. Do not omit required notices as a file-size optimization.

Report remaining coverage gaps explicitly, including native Windows behavior, additional viewers, actual cross-file navigation and physical printing. Passing synthetic fixtures is useful evidence with a defined scope, not proof of universal compatibility.

### Recent JPEG-size fix

First identify the exact reviewed revision and any uncommitted changes:

```sh
git status --short
git log -1 --format='%H %s'
git diff v9.0.1...HEAD -- src scripts tests docs package.json package-lock.json
git diff HEAD -- src scripts tests docs package.json package-lock.json
```

Read source and focused tests before drawing conclusions from the generated bundle. Useful suites include `tests/pdf-image-resolution.test.js`, `tests/pdf-assembly.test.js`, `tests/ui-lifecycle.test.js`, `tests/ui-controls.test.js`, `tests/export-protocol.test.js`, `tests/color-profiles.test.js`, `tests/cmyk.test.js` and `tests/vector-cmyk.test.js`. Verify current filenames in the checkout. The existing `scripts/stress-native-resources.mjs` and `docs/heavy-native-results.json` cover v9.0.1's different resource-retention case.

The focused suites cover encoded-size decisions, references/masks, cancellation and actual RGB/CMYK assembly. Use the following list to assess those tests and the remaining native/large-file evidence; it is a review plan, not a claim that every scenario has been completed:

- A valid photo/texture JPEG where a near-original 300-DPI Flate candidate is larger: compare saved stream bytes/filter, source dimensions, profile/mask references, warning and final PDF size against v9.0.1.
- A case where resizing is beneficial and still happens, plus Original/no-resize cases. Cover multiple placements, grayscale/RGB ICC sources and a supported alpha mask without modifying a shared original mask.
- RGB/CMYK separation: RGB retains an expanding candidate's original; CMYK still follows its existing resolution and color-conversion path. Verify actual saved four-channel output, not only a mode flag.
- Repeated image-heavy pages with the production budget unchanged, single and split output, exact external/local/cross-part links, and no orphan candidate streams. Report source encoding and fixture scope; do not substitute the old unused-image benchmark for this case.
- Cancellation during candidate generation and before commit; rejected candidate buffers are released, no late download occurs, prior pages/parts survive, and a later export starts cleanly. Confirm size-preservation warnings remain visible on success and subsequent budget failure.

Questions for the reviewer: Is the byte comparison made on encoded data, including applicable masks, without registering rejected candidates? Does it preserve color interpretation and all shared references? Can skipping a candidate accidentally bypass a resource guard or alter CMYK? Are observed size improvements real after save/reload? Is the reported evidence sufficient for the exact release commit, and does user-facing text describe any retained-original DPI exception honestly?

Return actionable findings with severity, source location, concrete trigger and expected/actual behavior, covering both the whole plugin and the recent fix. Distinguish verified defects from hypotheses and test gaps; prioritize user-visible loss, corrupted colors/links, export failures and resource leaks. Do not change the design, replace dependencies, relax guards or publish as part of an independent review.

## Build, test and publication workflow

Use Node.js 22 or later. Commands run from the repository root:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run build
node --check code.js
npm test
git diff --check
```

For testing while a native development plugin is open, build to a separate temporary HTML using `PDF_EXPORT_UI_OUTPUT`, then point browser tests to it with `PDF_EXPORT_TEST_UI`. The build still refreshes license files. Do not replace the canonical bundle underneath an active native export. Run larger benchmarks sequentially and keep their detailed outputs in ignored `test-results/`.

Before release, synchronize package/lock versions, release notes and generated `ui.html`; repeat the build to verify its output and notices are reproducible. CI is pinned to Ubuntu 24.04/Node 22 for the installed Playwright version. It installs dependencies/Chromium, rebuilds, checks `ui.html` and `licenses/`, validates backend syntax and runs tests.

Follow [RELEASING.md](RELEASING.md). Confirm checks for the exact final commit, tag it without moving earlier tags, and verify GitHub and Figma publication separately. Keep the existing Community plugin ID. A local import, a pushed commit and a published Community update are different states. For v9.0.2, publication, the Community-installed export check and the publication-record asset are verified. Preserve this evidence in the documentation-only follow-up without retagging or replacing the released source archive.
