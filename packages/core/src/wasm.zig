//! WASM export surface (see docs/CONTRACT.md "WASM ABI").
const std = @import("std");
const core = @import("root.zig");

const gpa = std.heap.wasm_allocator;

export fn core_alloc(len: u32) ?[*]u8 {
    const buf = gpa.alloc(u8, len) catch return null;
    return buf.ptr;
}

export fn core_free(ptr: [*]u8, len: u32) void {
    gpa.free(ptr[0..len]);
}

export fn core_abi_version() u32 {
    _ = core;
    return 1;
}

// ===================================================================== engine
// Owned by the engine workstream. JSON-returning functions return a pointer to
// `[u32 LE length][utf8 bytes]`, freed by the caller with core_free(ptr, 4 + len).

const engine = core.engine;
const ejson = @import("engine/json.zig");
const Game = engine.Game;

var games: std.ArrayList(?*Game) = .empty;

fn input(ptr: ?[*]const u8, len: u32) []const u8 {
    const p = ptr orelse return &.{};
    return p[0..len];
}

fn getGame(handle: u32) ?*Game {
    if (handle == 0 or handle > games.items.len) return null;
    return games.items[handle - 1];
}

fn addGame(g: Game) u32 {
    const slot = gpa.create(Game) catch return 0;
    slot.* = g;
    for (games.items, 0..) |entry, i| {
        if (entry == null) {
            games.items[i] = slot;
            return @intCast(i + 1);
        }
    }
    games.append(gpa, slot) catch {
        gpa.destroy(slot);
        return 0;
    };
    return @intCast(games.items.len);
}

/// Prefix the bytes with their length and hand ownership to the caller.
fn finish(out: *std.ArrayList(u8)) ?[*]u8 {
    defer out.deinit(gpa);
    const n: u32 = @intCast(out.items.len - 4);
    std.mem.writeInt(u32, out.items[0..4], n, .little);
    const owned = out.toOwnedSlice(gpa) catch return null;
    return owned.ptr;
}

fn begin() ?std.ArrayList(u8) {
    var out: std.ArrayList(u8) = .empty;
    out.appendSlice(gpa, &[_]u8{ 0, 0, 0, 0 }) catch return null;
    return out;
}

fn errorResult(message: []const u8) ?[*]u8 {
    var out = begin() orelse return null;
    ejson.writeApplyError(.{ .out = &out, .gpa = gpa }, message) catch {
        out.deinit(gpa);
        return null;
    };
    return finish(&out);
}

export fn game_new(ruleset_ptr: ?[*]const u8, ruleset_len: u32, seed_lo: u32, seed_hi: u32, players: u32) u32 {
    const ruleset = ejson.parseRuleset(gpa, input(ruleset_ptr, ruleset_len)) catch return 0;
    if (players > engine.MAX_PLAYERS) return 0;
    const seed = (@as(u64, seed_hi) << 32) | seed_lo;
    const g = Game.init(gpa, ruleset, seed, @intCast(players)) catch return 0;
    return addGame(g);
}

export fn game_free(handle: u32) void {
    const g = getGame(handle) orelse return;
    gpa.destroy(g);
    games.items[handle - 1] = null;
}

export fn game_apply(handle: u32, move_ptr: ?[*]const u8, move_len: u32) ?[*]u8 {
    const g = getGame(handle) orelse return errorResult("bad handle");
    const move = ejson.parseMove(gpa, input(move_ptr, move_len)) catch |e| return errorResult(ejson.errorMessage(e));
    var events = engine.Events.init(gpa);
    defer events.deinit();
    g.apply(move, &events) catch |e| return errorResult(ejson.errorMessage(e));
    var out = begin() orelse return null;
    ejson.writeApplyOk(.{ .out = &out, .gpa = gpa }, events.items()) catch {
        out.deinit(gpa);
        return null;
    };
    return finish(&out);
}

export fn game_view(handle: u32) ?[*]u8 {
    const g = getGame(handle) orelse return null;
    var out = begin() orelse return null;
    ejson.writeView(.{ .out = &out, .gpa = gpa }, g) catch {
        out.deinit(gpa);
        return null;
    };
    return finish(&out);
}

export fn game_legal_placements(handle: u32) ?[*]u8 {
    const g = getGame(handle) orelse return null;
    var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    var out = begin() orelse return null;
    ejson.writePlacements(.{ .out = &out, .gpa = gpa }, g.legalPlacements(&buf)) catch {
        out.deinit(gpa);
        return null;
    };
    return finish(&out);
}

export fn game_legal_figures(handle: u32, x: i32, y: i32, rot: u32) ?[*]u8 {
    const g = getGame(handle) orelse return null;
    var buf: [2 * engine.MAX_FEATURES]engine.FigureOption = undefined;
    const opts = if (x < -1000 or x > 1000 or y < -1000 or y > 1000 or rot > 3)
        buf[0..0]
    else
        g.legalFigures(@intCast(x), @intCast(y), @intCast(rot), &buf);
    var out = begin() orelse return null;
    ejson.writeFigureOptions(.{ .out = &out, .gpa = gpa }, opts) catch {
        out.deinit(gpa);
        return null;
    };
    return finish(&out);
}

export fn game_snapshot(handle: u32) ?[*]u8 {
    const g = getGame(handle) orelse return null;
    var out = begin() orelse return null;
    ejson.writeSnapshot(.{ .out = &out, .gpa = gpa }, g) catch {
        out.deinit(gpa);
        return null;
    };
    return finish(&out);
}

export fn game_restore(ptr: ?[*]const u8, len: u32) u32 {
    const g = ejson.parseSnapshot(gpa, input(ptr, len)) catch return 0;
    return addGame(g);
}

export fn game_hash(handle: u32) u64 {
    const g = getGame(handle) orelse return 0;
    return g.hash();
}

// =================================================================== end engine

// ===========================================================================
// geo / anim exports (owned by the geo workstream; keep this section last so
// merges with the engine section stay trivial). Formats: src/geo/README.md and
// src/anim/README.md. Every returned pointer is `[u32 LE length][bytes]` and is
// released with core_free(ptr, 4 + length); 0 means error.
// ===========================================================================

const geo = core.geo;
const anim = core.anim;

fn geoReturn(bytes: []const u8) u32 {
    const out = gpa.alloc(u8, bytes.len + 4) catch return 0;
    std.mem.writeInt(u32, out[0..4], @intCast(bytes.len), .little);
    @memcpy(out[4..], bytes);
    return @intCast(@intFromPtr(out.ptr));
}

/// Number of tiles in the geo registry (see geo/registry.zig).
export fn geo_tile_count() u32 {
    return @intCast(geo.registry.tiles.len);
}

/// Registry index of a tile id ("A", "R3", "fx-cap"...), or -1.
export fn geo_tile_index(id_ptr: [*]const u8, id_len: u32) i32 {
    const i = geo.registry.indexOf(id_ptr[0..id_len]) orelse return -1;
    return @intCast(i);
}

/// Tile id of a registry index as `[u32 len][utf8]`.
export fn geo_tile_id(index: u32) u32 {
    const t = geo.registry.byIndex(index) orelse return 0;
    return geoReturn(t.id);
}

/// 2D geometry buffer ("CGEO" kind 1) for the tile at `index`.
export fn geo_tile_2d(index: u32) u32 {
    const t = geo.registry.byIndex(index) orelse return 0;
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    var lay = geo.layout.build(gpa, t) catch return 0;
    defer lay.deinit();
    const bytes = geo.buffer.encode2D(arena.allocator(), &lay) catch return 0;
    return geoReturn(bytes);
}

/// 3D geometry buffer ("CGEO" kind 2) for the tile at `index`; `resolution`
/// is the terrain grid size (quads per side, 4..128, 0 = default 48);
/// `slab_permille` is the slab thickness in 1/1000 tile (0 = default 90,
/// 0xFFFFFFFF = no slab).
export fn geo_tile_3d(index: u32, resolution: u32, slab_permille: u32) u32 {
    const t = geo.registry.byIndex(index) orelse return 0;
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    var lay = geo.layout.build(gpa, t) catch return 0;
    defer lay.deinit();
    const slab: f64 = if (slab_permille == 0) geo.mesh.SLAB_DEFAULT else if (slab_permille == 0xFFFFFFFF) 0 else @as(f64, @floatFromInt(slab_permille)) / 1000.0;
    const bytes = geo.buffer.encode3D(arena.allocator(), &lay, .{ .resolution = if (resolution == 0) 48 else resolution, .slab = slab }) catch return 0;
    return geoReturn(bytes);
}

/// Figure buffer ("CGEO" kind 3): kind 0 = meeple, 1 = abbot;
/// pose 0 = standing (thief/knight/monk), 1 = lying (farmer, 3rd edition).
export fn geo_figure(kind: u32, pose: u32) u32 {
    if (kind > 1 or pose > 1) return 0;
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const bytes = geo.buffer.encodeFigure(arena.allocator(), @enumFromInt(kind), @enumFromInt(pose)) catch return 0;
    return geoReturn(bytes);
}

/// Prop model buffer ("CGEO" kind 4) for prop kind `kind` (mesh.Prop id,
/// 0..15) and `variant` (taken modulo the kind's model count). `flags` bit 0
/// = rounded (toon styles: more segments, smoother foliage).
export fn geo_prop(kind: u32, variant: u32, flags: u32) u32 {
    if (kind >= std.enums.values(geo.mesh.Prop).len) return 0;
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const bytes = geo.buffer.encodeProp(arena.allocator(), @enumFromInt(kind), @intCast(variant % 256), .{ .rounded = flags & 1 != 0 }) catch return 0;
    return geoReturn(bytes);
}

/// Animation timeline JSON for a JSON array of engine events.
/// `opts` is JSON `{style:"realistic"|"cartoon"|"reduced", speed?:number}` (may be empty).
export fn anim_timeline(events_ptr: [*]const u8, events_len: u32, opts_ptr: [*]const u8, opts_len: u32) u32 {
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const out = anim.timelineJson(arena.allocator(), events_ptr[0..events_len], opts_ptr[0..opts_len]) catch return 0;
    return geoReturn(out);
}

// ===========================================================================
// Public-view exports (owned by the integration workstream; additive only).
// Online clients never receive the deck seed, so they rebuild a game from the
// public GameView to ask the engine for legal placements/figures. The handle
// works with game_view / game_legal_placements / game_legal_figures and is
// released with game_free. JSON results use the engine framing above.
// ===========================================================================

const public_view = @import("engine/public_view.zig");

/// Rebuild a game from a GameView JSON document. Returns a handle, 0 on error.
export fn game_from_view(view_ptr: ?[*]const u8, view_len: u32) u32 {
    const g = public_view.fromView(gpa, input(view_ptr, view_len)) catch return 0;
    return addGame(g);
}

/// The engine tile catalog as JSON (see public_view.writeCatalog).
export fn tiles_catalog() ?[*]u8 {
    var out = begin() orelse return null;
    public_view.writeCatalog(.{ .out = &out, .gpa = gpa }) catch {
        out.deinit(gpa);
        return null;
    };
    return finish(&out);
}
