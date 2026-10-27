# Community report triage

Reviewed 2026-10-27 at https://www.figma.com/community/plugin/1535371360850075397.

These are public user reports, not copies of users' original design files. The reproductions below use synthetic fixtures; matching a failure mechanism does not prove it explains every reported file.

| Report | Reproduced mechanism | v9 action |
| --- | --- | --- |
| Liesl, shown as 15 days ago: only one website link works on a page although several are detected | v8 uses a nonexistent text-range bounds API, then assigns every text hyperlink the entire text-layer rectangle. These annotations overlap. | Preserve native Figma PDF annotations. For raster pages, recover the same geometry from an auxiliary native PDF. Real three-URL wrapped-text fixture checked. |
| Raúl Pérez, shown as 3 months ago: different page dimensions move elements | v8 hybrid segments hide sibling nodes, moving auto-layout children during export. Frame dimensions can also be stale after resizing. | Export each whole frame, refresh dimensions, preserve individual page sizes, and use transformed export bounds for rotated frames. |
| Casey Taylor, shown as 10 months ago: plugin runtime error | Broad symptom; original failing file unavailable. Code review reproduced overlapping batch work and identified unbounded exported-buffer accumulation. | One page in flight, acknowledgments, cancellation, explicit errors, and provisional pixel/transfer limits. Original reported file remains unverified. |
| Sia/Ellena and bar, older reports: shared-file/ownership and blank exports | Original files and exact permissions unavailable; do not infer an ownership-only cause. | Failed pages cannot silently become blank successful pages. Real permissions/library-resource cases remain release checks. |
| Piotr, shown as 9 months ago: frame order unclear with 100 frames | v8 already introduced numeric name sorting. v8 batched export separately matches names rather than unique IDs. | Keep stable numeric sorting and use IDs for every export. Preserve selection and manual ordering during list refresh. |
| Earlier quality/vector reports | Predate v7 hybrid support; not evidence that the latest release always rasterizes. | Native PDF path retains vectors where Figma supports them; unsupported Plus blend modes fall back to PNG with a warning. |

No public replies were sent during this investigation. Competitor analysis is deferred.
