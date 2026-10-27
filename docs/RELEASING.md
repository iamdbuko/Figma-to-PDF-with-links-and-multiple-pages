# Development and release checklist

This is the repeatable workflow for developing, verifying and publishing the plugin. A local development import, a GitHub push and a Figma Community update are separate operations. Record each result; do not describe a Community release as published until its update is visible there.

## Source and build

- `code.js` runs inside Figma. `src/ui.html` owns the interface and PDF assembly; the other `src/` modules handle PDF import, image resolution, color conversion and cooperative scheduling.
- `ui.html` is generated, committed and loaded by `manifest.json`. Edit the sources, then build; do not edit the generated file directly.
- `package-lock.json` pins the tools and runtime libraries. `scripts/build.mjs` bundles them, the offline color engine and the licensed CMYK profile, and copies dependency notices into `licenses/`.
- Keep the existing plugin ID, `1535371360850075397`, when updating the Community plugin. Keep the `v8-recovered` tag and recovery evidence unchanged.
- The manifest declares no network access. Do not introduce remote runtime dependencies or remove their redistribution notices. Dependency updates also require review of the pinned PDF parser and scheduler adapters, color profiles and build checksums.

Use Node.js 22 or later. From the repository root:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run build
node --check code.js
npm test
git diff --check
```

Linux CI installs Chromium with `npx playwright install --with-deps chromium`. The full test suite uses the built `ui.html`; building first is essential.

During an active native Figma test, avoid replacing its loaded bundle. Build and test a separate preview instead:

```sh
PDF_EXPORT_UI_OUTPUT=/tmp/figma-pdf-preview.html npm run build
PDF_EXPORT_TEST_UI=/tmp/figma-pdf-preview.html npm test
```

The alternate output protects `ui.html`, but the build still refreshes `licenses/`. Review any resulting changes. Close the development plugin before replacing the canonical bundle and reopen it for the next native test.

## Verification before a release

1. Review the intended changes and their limits. Update user-facing help, the README, release notes and relevant validation records together. Keep historical results labeled with the build and scenario they actually tested.
2. Run the build and normal suite above. For UI changes, exercise visible controls, keyboard focus/help, frame updates, settings persistence, Cancel, failure/retry and multipart Continue. For export changes, include real PDF assertions for page bounds, links, color profiles and supported vector content.
3. Import the local manifest in Figma Desktop with editing access to a synthetic test design. Check repeated frame names, drag/sort/remove, mixed page sizes, external and internal links, and wrapped text links. Exercise the changed export modes and inspect the saved PDF with a renderer/viewer; a successful download alone is insufficient.
4. For size, memory or scheduling changes, run the relevant larger benchmarks sequentially. Keep new reports separate from historical evidence. Browser runners do not measure Figma rendering or total process memory. The vector-CMYK stress runner needs its specific synthetic native-PDF fixture; it is not an arbitrary-file validator. See [large exports](LARGE-EXPORTS.md), [combined link tests](LARGE-LINKS.md) and [Vector CMYK validation](VECTOR-CMYK.md).
5. Keep source designs unchanged during an export and while waiting between parts. Test cancellation without allowing a late download, and verify earlier completed parts remain available when a later part fails.
6. Keep private designs, exported PDFs, screenshots and detailed inspection artifacts out of Git. Use ignored `test-results/` for local evidence; commit only safe synthetic fixtures and aggregate results without customer content or identifying paths.

The v9 release preparation baseline is `cb28b49d8494ee28383037a80ccd331864b722cc` (dev.9): **262 automated tests and GitHub Actions passed**. The [interface record](INTERFACE.md) includes its native macOS smoke test and a 250-page browser run. Earlier 156-page RGB/CMYK evidence is recorded in the [functionality audit](FUNCTIONALITY-AUDIT.md). These are scoped checkpoints, not a claim that every design, platform, viewer or printer is supported. [Initial validation](VALIDATION.md) is historical and must not be mistaken for the latest test count.

## Prepare the release commit

1. Set the intended release version consistently in `package.json` and `package-lock.json`. Set the public manifest name and update README instructions that still refer to the development name. Preserve the plugin ID and permissions unless an intentional, reviewed change requires otherwise.
2. Finish the public notes in `docs/releases/<version>.md`. State changed defaults and meaningful limitations; distinguish CMYK beta from a certified print workflow.
3. Build the canonical `ui.html`, run the full checks, and review the complete diff including generated output and licenses. Record the source commit, bundle hash, test count and native-test scope. If executable sources change after testing, rebuild and repeat the affected verification before release.
4. Commit the release inputs and generated bundle together. From that clean candidate commit, verify reproducibility:

   ```sh
   npm ci --ignore-scripts
   npm run build
   git diff --exit-code -- ui.html licenses/
   node --check code.js
   npm test
   git diff --check
   ```

5. Push the candidate through the repository's review workflow. Confirm **Plugin checks** passes for the exact final commit; a green check on an earlier development commit is insufficient. The workflow checks regenerated files, backend syntax and the full test suite.

## Publish and verify

1. Tag the tested final commit with the release version and create the GitHub release using the prepared notes. Verify that its tag resolves to that commit and its linked source contains the tested manifest, `code.js` and generated `ui.html`. Do not move an existing published tag to new code.
2. In Figma Desktop, use the publishing account's update flow for the existing Community plugin, with the release checkout's manifest and built files. Confirm the existing plugin ID and review the version notes before publishing. A development import alone does not update Community.
3. Verify the new version on the [existing Community listing](https://www.figma.com/community/plugin/1535371360850075397). Run the Community-installed version in a synthetic file and confirm its new interface/defaults and a saved PDF. Record any pending review state separately from publication.
4. Record the GitHub release URL/tag/commit, the Figma version or release identifier and publication time when available, and the tested bundle hash. Update release-status text only after each destination is verified. If a downloadable published bundle is available, compare it with the intended build; otherwise record the verification limit.

If one destination succeeds and the other fails, report the split state accurately and finish the remaining step. Preserve the tested release checkout and previous tags for recovery. Correct a bad release with a new reviewed commit/version and repeat the applicable checks; do not overwrite recovery evidence or silently retarget a release tag.

