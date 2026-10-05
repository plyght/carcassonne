//! Tile registry used by the geo/anim WASM exports to resolve a tile by index or id.
//!
//! ===========================================================================
//! ENGINE INTEGRATION POINT (the only place geo needs to change):
//! Today this resolves against geo's own fixtures. Once the engine lands
//! `engine/tiles_base.zig` (A..X) and `engine/tiles_river.zig` (R1..R12),
//! replace `tiles` below with the engine's tables, e.g.
//!
//!     const base = @import("../engine/tiles_base.zig");
//!     const river = @import("../engine/tiles_river.zig");
//!     pub const tiles = base.tiles ++ river.tiles ++ fixtures.all;
//!
//! (keeping the fixtures appended is harmless and keeps the contact sheet
//! working). Indices are positions in this array; prefer lookup by id.
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

pub fn byId(id: []const u8) ?*const tile.TileDef {
    const i = indexOf(id) orelse return null;
    return &tiles[i];
}
