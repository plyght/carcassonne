//! Move generation for search: every (placement x figure action) move for the
//! current player, with symmetric rotations removed.
//!
//! Two rotations of a tile are equivalent when they put the same kind of
//! feature on every edge port and group the ports into features the same way
//! (for example all four rotations of `C`, or `U` at rot 0 and 2). Legality and
//! every consequence of a move depend only on that structure, so only the
//! smallest rotation of each equivalence class is generated.
//!
//! Figure options are computed without copying the game: a new tile's feature
//! is occupied exactly when one of the neighbouring features it would join is.
const std = @import("std");
const engine = @import("../engine/engine.zig");
const tiles = @import("../engine/tiles.zig");
const tile = @import("../engine/tile.zig");

const Game = engine.Game;
const Move = engine.Move;
const Placement = engine.Placement;
const TileIndex = tiles.TileIndex;
const NO_FEATURE = tiles.NO_FEATURE;

pub const dx = [4]i16{ 0, 1, 0, -1 };
pub const dy = [4]i16{ -1, 0, 1, 0 };

/// Upper bound on generated moves; generation truncates (still legal) beyond it.
pub const MAX_MOVES = 4096;

fn equivalentRotations(t: usize, r1: usize, r2: usize) bool {
    const d = tiles.all[t];
    const a = &tiles.rotated[t][r1];
    const b = &tiles.rotated[t][r2];
    var fwd: [tiles.max_features]u8 = @splat(NO_FEATURE);
    var back: [tiles.max_features]u8 = @splat(NO_FEATURE);
    for (0..12) |p| {
        const fa = a.port_feature[p];
        const fb = b.port_feature[p];
        if (fa == NO_FEATURE or fb == NO_FEATURE) {
            if (fa != fb) return false;
            continue;
        }
        const ka = d.features[fa];
        const kb = d.features[fb];
        if (ka.kind != kb.kind or ka.pennants != kb.pennants) return false;
        if (fwd[fa] == NO_FEATURE and back[fb] == NO_FEATURE) {
            fwd[fa] = fb;
            back[fb] = fa;
        } else if (fwd[fa] != fb or back[fb] != fa) return false;
    }
    return true;
}

/// Smallest rotation equivalent to each rotation of each tile.
pub const canon_rot: [tiles.count][4]u2 = blk: {
    @setEvalBranchQuota(1_000_000);
    var out: [tiles.count][4]u2 = undefined;
    for (0..tiles.count) |t| {
        for (0..4) |r| {
            var c: usize = r;
            for (0..r) |s| {
                if (equivalentRotations(t, s, r)) {
                    c = s;
                    break;
                }
            }
            out[t][r] = @intCast(c);
        }
    }
    break :blk out;
};

/// Required edge kind on each side of an empty cell (null = no neighbour).
pub const CellNeeds = [4]?tile.EdgeKind;

pub fn cellNeeds(g: *const Game, x: i16, y: i16) CellNeeds {
    var need: CellNeeds = @splat(null);
    for (0..4) |s| {
        if (g.slotAt(x + dx[s], y + dy[s])) |ns| {
            const p = g.placed[ns];
            need[s] = tiles.rotated[p.tile][p.rot].edges[(s + 2) % 4];
        }
    }
    return need;
}

pub inline fn rotFits(t: TileIndex, r: u2, need: CellNeeds) bool {
    const e = &tiles.rotated[t][r].edges;
    inline for (0..4) |s| {
        if (need[s]) |k| {
            if (e[s] != k) return false;
        }
    }
    return true;
}

/// Small open-addressing set of board cells.
pub const CellSet = struct {
    const N = 1024;
    keys: [N]u32 = undefined,
    used: std.StaticBitSet(N) = .empty,

    pub inline fn key(x: i16, y: i16) u32 {
        return (@as(u32, @as(u16, @bitCast(x))) << 16) | @as(u16, @bitCast(y));
    }

    /// Returns true if newly inserted.
    pub fn insert(self: *CellSet, x: i16, y: i16) bool {
        const k = key(x, y);
        var b: usize = @intCast((k *% 0x9E3779B1) >> 22);
        while (self.used.isSet(b)) : (b = (b + 1) % N) {
            if (self.keys[b] == k) return false;
        }
        self.keys[b] = k;
        self.used.set(b);
        return true;
    }
};

/// Empty cells next to the board, in deterministic order.
pub fn frontier(g: *const Game, out: []engine.Cell) []engine.Cell {
    var set: CellSet = .{};
    var n: usize = 0;
    for (g.placed[0..g.placed_len]) |p| {
        for (0..4) |s| {
            const cx = p.x + dx[s];
            const cy = p.y + dy[s];
            if (g.slotAt(cx, cy) != null) continue;
            if (!set.insert(cx, cy)) continue;
            if (n < out.len) {
                out[n] = .{ .x = cx, .y = cy };
                n += 1;
            }
        }
    }
    return out[0..n];
}

pub const MAX_FRONTIER = 4 * engine.MAX_SLOTS;

/// Legal placements of tile `t`, one per rotation equivalence class.
pub fn placements(g: *const Game, t: TileIndex, out: []Placement) []Placement {
    var n: usize = 0;
    if (tiles.isRiver(t)) {
        var buf: [engine.MAX_PLACEMENTS]Placement = undefined;
        for (g.placementsFor(t, &buf)) |p| {
            if (canon_rot[t][p.rot] != p.rot) continue;
            out[n] = p;
            n += 1;
        }
        return out[0..n];
    }
    var cbuf: [MAX_FRONTIER]engine.Cell = undefined;
    for (frontier(g, &cbuf)) |c| {
        const need = cellNeeds(g, c.x, c.y);
        // A base tile can never continue the river.
        var river = false;
        for (need) |k| {
            if (k == .river) river = true;
        }
        if (river) continue;
        for (0..4) |ri| {
            const r: u2 = @intCast(ri);
            if (canon_rot[t][r] != r) continue;
            if (!rotFits(t, r, need)) continue;
            if (n >= out.len) return out[0..n];
            out[n] = .{ .x = c.x, .y = c.y, .rot = r };
            n += 1;
        }
    }
    return out[0..n];
}

/// Bitset of union-find roots that carry at least one figure.
pub const Occupied = std.StaticBitSet(engine.MAX_NODES);

pub fn occupiedRoots(g: *const Game) Occupied {
    var occ = Occupied.empty;
    for (0..g.num_players) |p| {
        for (g.figures[p]) |fs| {
            if (fs.on_board) occ.set(g.findConst(Game.node(fs.slot, fs.feature)));
        }
    }
    return occ;
}

/// Which features of tile `t` placed at (x, y, r) would join a feature that
/// already carries a figure (bit fi set). Features of the new tile that touch
/// the same neighbouring feature merge with each other too, so occupancy is
/// propagated through those shared roots.
pub fn occupiedFeatures(g: *const Game, occ: *const Occupied, t: TileIndex, x: i16, y: i16, r: u2) u16 {
    const rr = &tiles.rotated[t][r];
    const d = tiles.all[t];
    // Neighbouring roots touched by each feature.
    var roots: [tiles.max_features][12]u16 = undefined;
    var nroots: [tiles.max_features]u8 = @splat(0);
    var direct: u16 = 0;
    for (0..12) |pi| {
        const fi = rr.port_feature[pi];
        if (fi == NO_FEATURE) continue;
        const kind = d.features[fi].kind;
        // Roads, cities and rivers connect through the middle port only.
        if (kind != .field and pi % 3 != 1) continue;
        if (kind != .field and kind != .road and kind != .city) continue;
        const s = pi / 3;
        const ns = g.slotAt(x + dx[s], y + dy[s]) orelse continue;
        const np = tile.opposingPort(@intCast(pi));
        const p = g.placed[ns];
        const nf = tiles.rotated[p.tile][p.rot].port_feature[np];
        const root = g.findConst(Game.node(ns, nf));
        roots[fi][nroots[fi]] = root;
        nroots[fi] += 1;
        if (occ.isSet(root)) direct |= @as(u16, 1) << @intCast(fi);
    }
    if (direct == 0) return 0;
    // Propagate through shared roots until stable (at most a few rounds).
    var result = direct;
    var changed = true;
    while (changed) {
        changed = false;
        for (0..d.features.len) |a| {
            if (result & (@as(u16, 1) << @intCast(a)) != 0) continue;
            outer: for (0..d.features.len) |b| {
                if (result & (@as(u16, 1) << @intCast(b)) == 0) continue;
                for (roots[a][0..nroots[a]]) |ra| {
                    for (roots[b][0..nroots[b]]) |rb| {
                        if (ra == rb) {
                            result |= @as(u16, 1) << @intCast(a);
                            changed = true;
                            break :outer;
                        }
                    }
                }
            }
        }
    }
    return result;
}

/// Context shared by all placements of one turn.
pub const TurnInfo = struct {
    player: u8,
    tile: TileIndex,
    occ: Occupied,
    has_meeple: bool,
    has_abbot: bool,
    /// Cell of the player's abbot when it is on the board (recall possible).
    abbot_cell: ?engine.Cell,
    abbot_nb: u32,

    pub fn init(g: *const Game) TurnInfo {
        const player = g.current_player;
        var info: TurnInfo = .{
            .player = player,
            .tile = g.current_tile,
            .occ = occupiedRoots(g),
            .has_meeple = g.meeplesInSupply(player) > 0,
            .has_abbot = g.abbotAvailable(player),
            .abbot_cell = null,
            .abbot_nb = 0,
        };
        const ab = g.figures[player][engine.ABBOT_SLOT];
        if (g.ruleset.abbot and ab.on_board) {
            const c = g.placed[ab.slot];
            info.abbot_cell = .{ .x = c.x, .y = c.y };
            info.abbot_nb = g.neighbourCount(c.x, c.y);
        }
        return info;
    }
};

/// Appends every figure action for placement `p` (including `.none`).
pub fn figureMoves(g: *const Game, info: *const TurnInfo, p: Placement, out: []Move) usize {
    var n: usize = 0;
    const t = info.tile;
    const d = tiles.all[t];
    const busy = if (info.has_meeple or info.has_abbot) occupiedFeatures(g, &info.occ, t, p.x, p.y, p.rot) else 0;
    if (n < out.len) {
        out[n] = .{ .x = p.x, .y = p.y, .rot = p.rot };
        n += 1;
    }
    for (d.features, 0..) |f, fi| {
        const meeple_ok = info.has_meeple and switch (f.kind) {
            .road, .city, .field, .cloister => true,
            else => false,
        };
        const abbot_ok = info.has_abbot and (f.kind == .cloister or f.kind == .garden);
        if (!meeple_ok and !abbot_ok) continue;
        if (busy & (@as(u16, 1) << @intCast(fi)) != 0) continue;
        if (meeple_ok and n < out.len) {
            out[n] = .{ .x = p.x, .y = p.y, .rot = p.rot, .figure = .{ .meeple = @intCast(fi) } };
            n += 1;
        }
        if (abbot_ok and n < out.len) {
            out[n] = .{ .x = p.x, .y = p.y, .rot = p.rot, .figure = .{ .abbot = @intCast(fi) } };
            n += 1;
        }
    }
    if (info.abbot_cell) |c| {
        const near = @abs(p.x - c.x) <= 1 and @abs(p.y - c.y) <= 1;
        const nb = info.abbot_nb + @intFromBool(near);
        if (nb < 8 and n < out.len) {
            out[n] = .{ .x = p.x, .y = p.y, .rot = p.rot, .figure = .{ .recall_abbot = c } };
            n += 1;
        }
    }
    return n;
}

/// All deduplicated legal moves for the current player. Empty only when the
/// game is over.
pub fn generate(g: *const Game, out: []Move) []Move {
    if (g.status != .playing) return out[0..0];
    var pbuf: [engine.MAX_PLACEMENTS]Placement = undefined;
    const ps = placements(g, g.current_tile, &pbuf);
    const info = TurnInfo.init(g);
    var n: usize = 0;
    for (ps) |p| {
        n += figureMoves(g, &info, p, out[n..]);
        if (n >= out.len) break;
    }
    return out[0..n];
}

// ---------------------------------------------------------------- tests

const testing = std.testing;

test "canonical rotations of symmetric tiles" {
    const c = tiles.indexOfComptime("C");
    for (0..4) |r| try testing.expectEqual(@as(u2, 0), canon_rot[c][r]);
    const u = tiles.indexOfComptime("U");
    try testing.expectEqual(@as(u2, 0), canon_rot[u][2]);
    try testing.expectEqual(@as(u2, 1), canon_rot[u][3]);
    try testing.expectEqual(@as(u2, 1), canon_rot[u][1]);
    const x = tiles.indexOfComptime("X");
    for (0..4) |r| try testing.expectEqual(@as(u2, 0), canon_rot[x][r]);
    const v = tiles.indexOfComptime("V");
    for (0..4) |r| try testing.expectEqual(@as(u2, @intCast(r)), canon_rot[v][r]);
    // Pennant-less E-W city and the H two-cities tile are 2-fold symmetric.
    const h = tiles.indexOfComptime("H");
    try testing.expectEqual(@as(u2, 0), canon_rot[h][2]);
    const b = tiles.indexOfComptime("B");
    for (0..4) |r| try testing.expectEqual(@as(u2, 0), canon_rot[b][r]);
}

test "placements match the engine up to symmetric rotations" {
    var rng = @import("../engine/rng.zig").Rng.init(99);
    var seed: u64 = 1;
    while (seed <= 30) : (seed += 1) {
        var g = try Game.init(testing.allocator, .{ .river = seed % 2 == 0 }, seed, 2);
        while (g.status == .playing) {
            var ebuf: [engine.MAX_PLACEMENTS]Placement = undefined;
            const eps = g.legalPlacements(&ebuf);
            var abuf: [engine.MAX_PLACEMENTS]Placement = undefined;
            const aps = placements(&g, g.current_tile, &abuf);
            // Every engine placement maps to exactly one generated canonical one.
            var canon_count: usize = 0;
            for (eps) |p| {
                if (canon_rot[g.current_tile][p.rot] != p.rot) continue;
                canon_count += 1;
                var found = false;
                for (aps) |q| {
                    if (q.x == p.x and q.y == p.y and q.rot == p.rot) found = true;
                }
                try testing.expect(found);
            }
            if (canon_count != aps.len) {
                for (aps) |q| {
                    var found = false;
                    for (eps) |p| {
                        if (q.x == p.x and q.y == p.y and q.rot == p.rot) found = true;
                    }
                    if (!found) std.debug.print("extra {s} {any} river {any}\n", .{ tiles.all[g.current_tile].id, q, g.river });
                }
            }
            try testing.expectEqual(canon_count, aps.len);
            var mbuf: [MAX_MOVES]Move = undefined;
            const ms = generate(&g, &mbuf);
            try testing.expect(ms.len > 0);
            // Same figure options as the engine for every canonical placement.
            const info = TurnInfo.init(&g);
            for (aps) |p| {
                var fbuf: [2 * engine.MAX_FEATURES]engine.FigureOption = undefined;
                const opts = g.legalFigures(p.x, p.y, p.rot, &fbuf);
                var tmp: [64]Move = undefined;
                const k = figureMoves(&g, &info, p, &tmp);
                var recall: usize = 0;
                for (tmp[0..k]) |m| {
                    if (m.figure == .recall_abbot) recall += 1;
                }
                if (opts.len + 1 + recall != k) {
                    std.debug.print("tile {s} at {d},{d} r{d}: engine {any}\nmine {any}\n", .{ tiles.all[g.current_tile].id, p.x, p.y, p.rot, opts, tmp[0..k] });
                }
                try testing.expectEqual(opts.len + 1 + recall, k);
            }
            // Every generated move is legal.
            for (ms) |m| {
                var copy = g;
                try copy.apply(m, null);
            }
            try g.apply(ms[@intCast(rng.below(ms.len))], null);
        }
    }
}
