# Simplified interface — dev.9

The interface follows the two supplied reference screens. The default window is 520 × 650, with a white background, quiet gray selections, and a fixed two-button footer.

## Frame list

- Select frames in Figma to add them. Every listed frame is exported; there are no inclusion checkboxes.
- Drag rows to set the page order, or sort names A–Z / Z–A. A gray row is a hover state, not export selection.
- Right-click a row and choose **Remove**. This affects the export list only. Keyboard users can open the menu with Shift+F10 or Enter, remove with Delete/Backspace, and reorder with Alt+Up/Down.
- **Clear list** empties the list. **Export** opens settings without starting rendering. Both are disabled for an empty list.
- Long names truncate visually; full names, dimensions and row instructions are available in a tooltip. Long lists scroll inside the card, keeping the footer visible.

## Export settings

- Separate selection buttons for **Type**, **Color profile**, **Quality**, **Compression**, **Lower resolution**, and **Output**.
- **Vector**, **As file**, **72 DPI**, **PNG**, **Don’t allow**, and **Single PDF** are the initial choices, matching the requested defaults. As file retains the existing Same as Figma file behavior.
- **More** contains Original for Vector, plus 144/216/288/300 DPI. Its label shows the selected extra resolution. Vector image resolution and Rasterized page resolution remain independent when switching modes.
- CMYK reveals Built-in / Custom and the optional profile picker; unsupported compression/fitting choices are hidden. Split reveals Pages per part. Remembered values survive switching back.
- **Cancel** returns to the frame list while idle. Both screens remain mounted, preserving settings and custom-profile bytes. During a job, Cancel cancels export; settings and navigation are locked. Multipart pauses expose Continue in the same footer.
- Explanatory text is hidden from the main screens and available on hover or keyboard focus. Escape dismisses tooltips and menus. ICC help provides Mac/Windows paths on hover and opens a keyboard-accessible dialog for copying paths and following the reference link.
- Progress, success, actual errors, warnings and file-reading failures remain visible. They are operational feedback rather than optional help.

The former manual light/dark switch and selection-summary text are intentionally removed to match the supplied design. Backend rendering, color conversion, link geometry, memory safeguards and multipart handling are unchanged; the backend change is the window size. Default Vector image resolution intentionally changes from Original to 72 DPI at the user's request. Original is still available in More.

## Verification

- Final bundle: 262 automated tests pass. Coverage includes actual browser clicks on visible settings, both physical drag directions, right-click and keyboard removal, all resolution choices, profile uploads, Back/Next persistence, cancellation, real RGB/CMYK PDFs, links and multipart downloads.
- New layout checks use 156 long frame names and a compact 400 × 450 window; both screens scroll without moving the footers outside the window. Tooltips are checked on hover/focus, including updated Custom ICC wording and menu focus handling.
- An isolated-browser native-PDF benchmark exported 250 pages and verified 1,250 preserved URI annotations plus 250 internal destinations, exact dimensions and zero browser errors. It explicitly selects Original to preserve historical benchmark semantics. This harness does not measure Figma rendering or whole-process memory. The larger raster/CMYK benchmarks were adapted for the interface but not rerun for this design change.
- Figma Desktop verification exercised frame collection, right-click Remove, navigation, selected defaults and a saved native Vector/As-file/72-DPI PDF. The one-page design fixture is 375 × 467 points, 92,072 bytes, with seven valid compressed streams and no annotations. It rendered correctly and was visually inspected. Existing Figma Type 3 glyph-bounds warnings remain. This is an interface smoke test; dev.8's 156-page RGB/CMYK evidence remains historical.
- The native run preceded only a singular/plural correction in the success label; the final full suite covers the packaged version. Aggregate hashes and evidence are in [interface results](interface-dev9-results.json). Screenshots, PDFs and detailed browser evidence remain in ignored `test-results/ui-dev9/`.

The existing [functionality audit](FUNCTIONALITY-AUDIT.md), [large-file limits](LARGE-EXPORTS.md) and [Vector CMYK limits](VECTOR-CMYK.md) still apply. This development interface does not publish a Community update.
