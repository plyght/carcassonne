# core/geo: procedural tile geometry

Turns any `TileDef` (`engine/tile.zig`) into style-agnostic geometry:

- **2D** region paths for Classic Board and Blueprint.
- **3D** meshes, prop instances and figure anchors for Tabletop, Cartoon and Diorama.
- the **classic meeple and abbot** figure shapes.
- the **prop models** (houses, towers, chapel, trees, animals...) that the `PROP` instances point at.

Styles change only materials, colours and prop models, never shapes or positions.

| File | What |
|---|---|
| `layout.zig` | 2D partition of the unit tile into feature regions, plus anchors and pennants |
| `mesh.zig` | Relief terrain, slab, walls (crenellations, gates), water, props, 3D anchors |
| `figure.zig` | Classic meeple and 3rd-edition abbot: outline, plus a bevelled extrusion |
| `props.zig` | Procedural low-poly prop models per (prop, variant), with palette part ids |
| `buffer.zig` | `CGEO` binary encoding (below) |
| `registry.zig` | Tile id/index → `TileDef`. **This is the engine integration point** (one line) |
| `fixtures.zig` | Geo-owned fixture tiles covering every topology |
| `tests.zig` | Invariants: regions, edge alignment, mesh validity, determinism |

## Conventions

- **Canonical tile space (rot 0):**
  - 2D: `x` points right (east) and `y` points down (south), each spanning 0..1.
  - 3D: `x` points east, `z` points south and `y` points up.
  - Apply a placement's `rot` as `rot` clockwise quarter turns about (0.5, 0.5) seen from above. In Three.js that is `mesh.rotation.y = -rot * PI / 2` about the tile centre. `@carcassonne/core-geo` exports `rotatePoint`.
- **Edges always line up.** Port positions, road and river widths, border vertices and border heights depend only on the edge kind. Jitter (seeded from the tile id hash, the only randomness) tapers to zero at the border. Roads and rivers leave each edge on an exactly perpendicular stub. `tests.zig` checks all of this for every registry tile.
- **Feature indices** are `TileDef.features` indices. `255` means no feature.
- **Recommended 2D draw order** is the order paths appear in the buffer:
  1. fields,
  2. ponds and river bands,
  3. road bands,
  4. plazas,
  5. cities,
  6. walls,
  7. buildings.

  Fields are inset off the road and river bands, so regions form a partition up to the junction plazas.

## Binary format `CGEO` (version 1)

Every geo export returns a pointer to `[u32 LE length][payload]`, which the caller frees with `core_free(ptr, 4 + length)`. A return of `0` means an error. The payload is little-endian, and every section is 4-byte aligned. Copy the payload out of wasm memory (memory can grow), then view the sections with `Float32Array`, `Uint32Array` and friends.

```
header (16 B)  u32 magic 0x4F454743 ("CGEO")   u16 version = 1   u16 kind (1 = 2D, 2 = 3D, 3 = figure, 4 = prop)
               u32 payloadLength               u32 sectionCount
table          sectionCount x { u32 tag (4 ASCII chars, LE), u32 offset (from payload start), u32 byteLength, u32 count }
sections       ...
```

### Shared by 2D and 3D

| Tag | count | Record |
|---|---|---|
| `META` | 1 | `f32 roadHalfWidth, f32 riverHalfWidth, u32 featureCount, u8 special (0 none, 1 start, 2 spring, 3 lake), u8 set (0 base, 1 river), u16 idLen, idLen bytes of UTF-8 id` (padded) |
| `FEAT` | features | 12 B: `u8 kind (0 road, 1 city, 2 field, 3 cloister, 4 garden, 5 river), u8 pennants, u16 portMask, f32 anchorX, f32 anchorY` (2D meeple anchor) |

### 2D (kind 1)

| Tag | count | Record |
|---|---|---|
| `PATH` | paths | 16 B: `u8 feature, u8 role, u8 flags (bit0 closed), u8 kind, u32 firstPoint, u32 pointCount, f32 width` |
| `PNTS` | points | `f32 x, f32 y` |
| `PENN` | pennants | 12 B: `u8 feature, 3 pad, f32 x, f32 y` (pennant / coat-of-arms position) |

Roles:

| Role | Meaning |
|---|---|
| `0` region | Filled polygon: field, city, road band, river band, pond or lake |
| `1` centerline | Road or river spline; `width` = full width |
| `2` wall | City boundary facing non-city ground; `width` = suggested stroke |
| `3` building | Cloister or garden footprint |
| `5` plaza | Junction disc; `feature` is one of its roads |

### 3D (kind 2)

| Tag | count | Record |
|---|---|---|
| `VPOS` | vertices | `f32 x, y, z` |
| `VNRM` | vertices | `f32 nx, ny, nz` (unit) |
| `VUV0` | vertices | `f32 u, v`: tile-space uv for terrain, arc length × height for walls, side × depth for the slab |
| `VFEA` | vertices | `u8 feature` (padded to 4 B) |
| `INDX` | indices | `u32` triangle list, counter-clockwise seen from outside |
| `GRUP` | groups | 16 B: `u32 firstIndex, u32 indexCount, u32 material, u32 reserved`. Material is 0 terrain, 1 wall (masonry: walls, merlons, cloister plinth), 2 water, 3 slab (cut sides and bottom). Maps to `BufferGeometry.addGroup` |
| `PROP` | instances | 28 B: `u8 prop, u8 feature, u8 variant, u8 tint, f32 x, y, z, f32 yaw, f32 scale, f32 height` |
| `ANC3` | features | 24 B: `f32 x, y, z, f32 yaw, f32 scale (suggested figure height), u32 pose (0 standing, 1 lying)` |
| `SLAB` | 1 | `f32 slabThickness` (0 = none) |

Props:

| Id | Prop | Id | Prop |
|---|---|---|---|
| 0 | tower | 8 | fountain |
| 1 | house | 9 | crop |
| 2 | chapel | 10 | duck |
| 3 | tree | 11 | bridge |
| 4 | sheep | 12 | bush |
| 5 | cow | 13 | gatehouse |
| 6 | cart | 14 | round_tower |
| 7 | mill | 15 | wall_stairs |

Prop fields:

- `yaw` is in radians about +y. 0 faces +z.
- `variant` picks a model (`variant % modelsAvailable`).
- `tint` indexes the style palette for that prop (roof colours, for example).
- `height` is an extra vertical scale (houses vary).

The terrain is a `(R+1)²` grid (default R = 48). Relief includes:

- raised city ground,
- road beds with two cart ruts,
- river beds under a flat water surface,
- slight field undulation.

**Border heights depend only on the edge kind**, so slabs and terrain meet flush, and multi-tile cities have continuous ground. Walls are generated only along city boundaries that face fields (never on tile edges), so adjacent city tiles read as one walled town.

Houses are dart-thrown, kept clear of walls, roads, the tile border and meeple anchors. Packing circles (radius `HOUSE_R` 0.045 × scale 0.8–1.3, models ≈ 0.11 × 0.07) may overlap slightly or leave gaps of up to 0.02, so the result is a few large, irregularly packed houses with courtyard ground showing. Houses near a wall line up with it.

Bushes come in clusters of one to three. They line roads, rivers and the outside of walls, and dot the fields. There are a few round trees, some animals and rare subtle crop strips.

Gates (`gatehouse`, with a gap in the wall mesh) sit wherever a road meets a wall.

Tuning toward the tabletop reference (`mesh.zig` constants):

| Constant | Value | Meaning |
|---|---|---|
| `WALL_H` | 0.085 | Wall height |
| `WALL_HT` | 0.019 | Wall half thickness |
| `MERLON` | 0.036 | Merlon pitch |
| `MERLON_H` | 0.016 | Merlon height |
| `GATE_R` | 0.055 | Gate radius |
| `ROAD_Y` | −0.006 | Road depth: sunken roads |
| `RUT_D` | 0.0015 | Rut depth |
| `MEEPLE_H` | 0.26 | Meeple height |

Anchors and poses:

- Field and city anchors (2D `FEAT` and 3D `ANC3` alike) are the **pole of inaccessibility** of the feature's region: the centre of the largest inscribed circle, clipped against road and river ribbons, plazas, ponds, buildings, walls and the tile border (`layout.clearance`). `tests.zig` checks every registry tile: each anchor classifies as its own feature, keeps a margin from roads, rivers, walls and other features, and is within 15% of the region's best clearance.
- Road anchors sit on their own road, clear of other roads and rivers.
- Farmers (field anchors) lie on their back (`pose = 1`).
- Cloister anchors stand on the plinth in front of the chapel.
- `scale` = 0.26 tile units, so figures read large next to houses (~0.08), as in the reference photo.

### Figure (kind 3)

| Tag | count | Record |
|---|---|---|
| `FDIM` | 1 | `u8 shape (0 meeple, 1 abbot), u8 pose (0 standing, 1 lying), u16 pad, f32 height (= 1), f32 thickness (0.35), f32 bevel` |
| `OUTL` | points | `f32 x, f32 y`: 2D token outline, y down, centred, height 1 |
| `VPOS`, `VNRM`, `VUV0`, `INDX` | | Bevelled extrusion of the outline |

Poses:

- **Standing:** base on y = 0, front toward +z.
- **Lying:** on its back, front up, head toward −z, resting on y = 0.

Scale the piece by the anchor's `scale` and rotate it by its `yaw`.

### Prop model (kind 4)

One model per (prop id, variant, rounded), shared by every style (styles only recolour parts through their palette). Instance it at each `PROP` record: translate to `x, y, z`, rotate by `yaw` about +y, scale by `scale` (and `height` vertically; render-three also applies the style's `props.scale` / `houseHeight`).

| Tag | count | Record |
|---|---|---|
| `PDIM` | 1 | 32 B: `u8 prop, u8 variant (resolved, = requested % variants), u8 variants, u8 flags (bit0 rounded), f32 baseScale, f32 minX, minY, minZ, f32 maxX, maxY, maxZ` |
| `VPOS` | vertices | `f32 x, y, z`: prop-local, tile units, +y up, yaw 0 faces +z, ground at y = 0 (bases sink slightly below) |
| `VNRM` | vertices | `f32 nx, ny, nz` (unit). Flat shaded: vertices are shared only within one flat face |
| `VPRT` | vertices | `u8 part` (padded to 4 B): palette slot, table below |
| `VSHD` | vertices | `f32 shade` in (0, 1]: baked contact darkening near the ground (0.72 at y = 0 → 1 at 0.03) × 0.6 on roof/cone undersides. Multiply into the colour (render-three: `mix(1, shade, 0.8)`) |
| `INDX` | indices | `u32` triangle list, counter-clockwise seen from outside |

No uvs. `baseScale` (house 1.3, mill 1.2, sheep 1.7, cow 1.6, duck 1.6, bush 1.25, tree 1.2, else 1) is already applied to `VPOS`; `shade` is computed before it.

Variants per prop: tower 3, house 6, tree 2, bush 3, round_tower 3, every other prop 1. `rounded` (toon styles) uses 14 instead of 8 cylinder segments, icosphere detail 2 instead of 1 for foliage and wool, gentler foliage lumps and 10 instead of 8 merlons on round towers.

Parts (palette slots; the style palette has 16 columns, rows = instance `tint` 0..3):

| Id | Part | Id | Part |
|---|---|---|---|
| 0 | plaster (house walls, gable ends) | 7 | dark (windows, doors, legs, wheels) |
| 1 | roof | 8 | sheep (wool, duck body) |
| 2 | stone (towers, gatehouse, fountain) | 9 | cow |
| 3 | stoneDark (chimney, parapets, walk-way) | 10 | crop |
| 4 | foliage | 11 | water (fountain basin) |
| 5 | trunk | 12 | grass (reserved) |
| 6 | wood (cart, mill wheel) | 13–15 | unused |

`props.zig` tests check every model (both roundnesses): indices in range, unit normals, valid part ids, shade range, no degenerate triangles, every face wound counter-clockwise from outside (each solid primitive faces away from its centre, each window/door plate along its facing), and byte-identical output across runs and for `variant + variants`.

## WASM exports (geo/anim section at the end of `wasm.zig`)

| Export | Returns |
|---|---|
| `geo_tile_count() -> u32` | Tiles in the registry |
| `geo_tile_index(id_ptr, id_len) -> i32` | Registry index of an id, or −1 |
| `geo_tile_id(index) -> ptr` | `[len][utf8 id]` |
| `geo_tile_2d(index) -> ptr` | `CGEO` kind 1 |
| `geo_tile_3d(index, resolution, slab_permille) -> ptr` | `CGEO` kind 2. `resolution` 0 = 48. `slab_permille` 0 = default 90 (0.09 tile), `0xFFFFFFFF` = no slab |
| `geo_figure(kind, pose) -> ptr` | `CGEO` kind 3. Kind 0 meeple, 1 abbot; pose 0 standing, 1 lying |
| `geo_prop(kind, variant, flags) -> ptr` | `CGEO` kind 4. `kind` is the prop id (0–15), `variant` is taken modulo the prop's model count, `flags` bit 0 = rounded. `CoreGeo.prop(kind, variant, {rounded})` decodes and caches it |
| `anim_timeline(events_ptr, len, opts_ptr, len) -> ptr` | `[len][JSON]`, see `../anim/README.md` |

Geometry is a pure function of the `TileDef`, so cache it per tile id (`CoreGeo.tile2d` does).

## Engine integration point

`registry.zig` holds one line, `pub const tiles = ...`. Today it points at `fixtures.all`. The replacement for the engine catalog is spelled out there (`engine/tiles.zig`'s `all ++ fixtures.all`, which keeps index == engine `TileIndex`). All 44 real tiles on main pass every invariant:

- A–X,
- the garden variants (`Eg` … `Vg`),
- R1–R12.

`docs/research/geo-real-tiles.svg` shows them.

## Visual checks

- `bun packages/core-geo/scripts/render-fixtures.ts` → `docs/research/geo-fixtures.svg` (contact sheet + assembled boards).
- `bun packages/core-geo/scripts/render-3d.ts` → `docs/research/geo-3d.png` (software-rasterised oblique view with stand-in props and figures).
