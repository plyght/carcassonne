//! Tile registry used by the geo/anim WASM exports to resolve a tile by index or id.
//!
//! ===========================================================================
//! ENGINE INTEGRATION POINT: the single line `pub const tiles = ...` below.
//! Today it resolves against geo's own fixtures. With the engine's catalog
//! (`engine/tiles.zig`: `tiles.all` = base A..X + garden variants + R1..R12):
//!
//!     const engine_tiles = @import("../engine/tiles.zig");
//!     pub const tiles: []const tile.TileDef = &(engine_tiles.all ++ fixtures.all);
//!
//! Engine tiles first keeps registry index == engine `TileIndex`, so
//! `geo_tile_2d(i)` takes the same index the engine uses; the fixtures after
//! them keep the contact sheet working. `byId` / `indexOf` derive from it.
//! Verified on 2026-10-05 against main's tiles_base.zig + tiles_river.zig:
//! all 44 real tiles pass every geo invariant (see tests.zig).
//! ===========================================================================

const std = @import("std");
const tile = @import("../engine/tile.zig");
const fixtures = @import("fixtures.zig");

pub const tiles: []const tile.TileDef = &fixtures.all;

pub fn byIndex(i: u32) ?*const tile.TileDef {
    if (i >= tiles.len) return null;
    return &tiles[i];
}

pub fn indexOf(id: []const u8) ?u32 {
    for (tiles, 0..) |*t, i| {
        if (std.mem.eql(u8, t.id, id)) return @intCast(i);
    }
    return null;
}

/// Tile id -> definition.
pub fn byId(id: []const u8) ?*const tile.TileDef {
    const i = indexOf(id) orelse return null;
    return &tiles[i];
}
