# Requests to core/geo from the 2D renderers

The painted Classic tiles (`src/illustrated/`) consume core-geo as-is: 2D regions for the
layout plus the 3D `PROP` instances projected top-down. Below are things geo does not
provide (yet) and how render-classic works around them meanwhile. Newest at the bottom.

## Painted Classic tiles (2D illustrated art)

1. **Prop footprints.** Houses, the chapel, towers and gatehouses carry `scale`/`height`
   but no footprint size. The painter assumes the stand-in sizes from
   `core-geo/scripts/render-3d.ts` (house half-extents 0.021 × 0.016 × scale, chapel
   0.085 × 0.06 × scale, gatehouse 0.035 × 0.02). *Request:* document the footprint
   half-extents per prop (or add them to `PROP`), so 2D and 3D agree exactly.
   *Workaround:* hard-coded sizes in `src/illustrated/paint.ts` (houses drawn ~30% larger
   so packed towns overlap slightly, like the printed tiles).

2. **Larger cloister.** The cloister footprint (~0.23 tile) is small next to the printed
   abbey, which fills roughly 40% of the tile. *Request:* a larger cloister/plinth (around
   0.35) and anchor placement to match. *Workaround:* the abbey is drawn at 1.8× geo's
   scale, clamped to stay inside the tile; the monk anchor still sits in front of it.

3. **House margin on the north side.** 2D buildings are drawn in an oblique view (they rise
   toward the top of the screen), so houses within ~0.04 of a tile edge that faces up
   after rotation get their roofs clipped at the seam. *Request:* keep houses at least
   `r × 1.4` from the tile border (currently `r × 0.9`). *Workaround:* none (a few roof
   tips are cut at seams).

4. **Bridge orientation.** The `bridge` prop's `yaw` does not say which local axis the road
   runs along. *Request:* define it (e.g. the road runs along local +x). *Workaround:* the
   deck is drawn along local x with parapets on ±z; check R2/R8/R11 if geo changes it.

5. **Village houses at junctions.** Houses near crossroads plazas come out the same size as
   packed city houses, which reads as tiny red dots in a field. *Request:* a `village`
   variant (or larger `scale`) for houses outside cities. *Workaround:* houses outside a
   city feature are drawn at 1.5×.
