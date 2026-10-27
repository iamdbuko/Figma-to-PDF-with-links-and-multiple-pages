# Color profiles in v9.0.0-dev.5

The exporter defaults to **Same as Figma file**. Explicit **sRGB** and **Display P3** remain available. **CMYK (beta)** is a separate raster conversion path using a built-in coated-paper profile or an optional uploaded printer profile; see [CMYK behavior](CMYK.md).

## Behavior

The backend passes the resolved export profile explicitly to Figma for every native PDF, PNG, JPEG and annotation export, including raster fallbacks. It never changes the source document's profile or paint values. Same as Figma file resolves the source's assigned sRGB or Display P3 once at the start. If the document profile changes during a job, the exporter cancels to avoid mixing source color interpretations.

Figma can report older documents as `LEGACY`, which does not expose an unambiguous assigned profile. Same as Figma file now passes `DOCUMENT` to Figma for these files and preserves the color metadata Figma actually exports. For a legacy JPEG, a tiny PNG export of the same frame supplies color metadata if the JPEG omits it; original compressed JPEG pixels are retained. The probe is included in the per-page transfer allowance. Missing or invalid metadata fails rather than guessing. Figma controls the legacy preference; keep that preference unchanged during export. Assigned sRGB/P3 document profiles remain fixed at the start.

This feature follows Figma's rendering for the selected export profile. It does not promise identical appearance when changing between profiles, or on viewers/displays that ignore color management. It is not a new independent gamut-conversion engine.

## PDF assembly

Raster image objects use PDF `ICCBased` color spaces. The exporter reads embedded profiles from Figma's PNG/JPEG output; explicitly exported sRGB images without an ICC profile receive a standard sRGB profile. Display P3 raster data without its expected embedded profile fails explicitly. Transparency masks remain grayscale and keep their alpha values.

JPEG image streams remain compressed and are not decoded or recompressed to attach a profile. Identical raster profiles are shared within each output PDF, and profile caches are tied to that document's lifetime. Each multipart document receives its own profiles. Existing raster, transfer and PDF-data budgets still apply.

Native PDF pages retain their existing page color resources, including ICC profiles referenced by gradients and images. An unsupported document-level output-intent dependency triggers the selected raster fallback rather than being silently dropped or adding an unearned PDF/X declaration.

## Current dev.4 validation

The [dev.4 results](cmyk-results.json) record 125 passing tests and successful live Figma exports using the new Same as Figma file default for vector and JPEG pages. Both saved PDFs retain their 600×400 page dimensions, RGB ICC data and the exact web-link rectangle. Automated cases cover legacy PNG metadata, legacy JPEG probes, assigned sRGB/P3 resolution, probe failures and cancellation. Earlier dev.3 evidence below remains unchanged as a historical checkpoint.

## Previous dev.3 validation

The dedicated **Color profile regression** page in the Booko Studio regression file contains saturated RGB swatches, gray/black, a gradient, a raster image and half-opacity color. Native reference exports are saved as test fixtures in both profiles. Automated tests cover export settings, document-profile resolution, cancellation on changes, malformed profiles, PDF embedding and multipart consistency.

All **97 automated tests passed** locally. The [color results](color-results.json) record four successful live Figma exports: Display P3 vector, PNG and JPEG, plus sRGB JPEG. Each saved PDF retained the expected profile, 600×400 page dimensions and its web link. Same as Figma file correctly rejected the legacy source with an actionable message and no download; assigned sRGB/P3 resolution and P3 multipart exports are covered by automated tests.

For both profiles, the assembled vector fixture rendered pixel-identically to Figma's native PDF reference under the same Poppler settings. Raster swatch/gradient interior samples differed by at most 3 channel levels out of 255 from LittleCMS-converted source images. Whole-image maximum differences were larger at image boundaries because of PDF raster resampling; the raw measurements are retained. This is a rendering/profile-preservation check, not a calibrated-display or print-accuracy guarantee.

The repeated [30-page JPEG stress workload](color-large-file-results.json) passed with all original compressed JPEG streams retained, one shared sRGB profile and an approximately 10.9 MiB output. The previous full PNG/multipart stress report remains the dev.2 checkpoint, not a rerun of every workload on dev.3.

Reproduce assembly with `node scripts/validate-colors.mjs`. It writes six PDFs under the ignored `test-results/color-profiles/` directory. Repeat the JPEG workload without overwriting the earlier report with `node scripts/stress-large.mjs jpeg --output=docs/color-large-file-results.json`.

References: [Figma export settings](https://developers.figma.com/docs/plugins/api/ExportSettings/), [Figma document profile](https://developers.figma.com/docs/plugins/api/DocumentNode/#documentcolorprofile), [Figma color management](https://help.figma.com/hc/en-us/articles/360039825114-Manage-color-profiles-in-design-files).
