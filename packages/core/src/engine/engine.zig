//! Carcassonne rules engine: base game + The River + The Abbot.
//!
//! `Game` is plain data (no pointers, no heap), so `var copy = game;` is a full,
//! cheap clone (a few KB) for AI search. Events are only materialised when the
//! caller passes an `Events` sink; pass `null` for fast simulation.
//!
//! Rules references are in RULES_NOTES.md; JSON I/O lives in json.zig.
const std = @import("std");
const tile = @import("tile.zig");
const tiles = @import("tiles.zig");
const Rng = @import("rng.zig").Rng;

pub const TileIndex = tiles.TileIndex;
pub const FeatureKind = tile.FeatureKind;
pub const EdgeKind = tile.EdgeKind;

pub const MAX_PLAYERS = 5;
pub const MIN_PLAYERS = 2;
pub const MEEPLES_PER_PLAYER = 7;
/// Figure slots per player: 7 meeples then the abbot.
pub const FIGURES_PER_PLAYER = MEEPLES_PER_PLAYER + 1;
pub const ABBOT_SLOT = MEEPLES_PER_PLAYER;
/// Most tiles that can ever be on the board: 72 base + 12 river.
pub const MAX_SLOTS = 84;
pub const MAX_FEATURES: u16 = tiles.max_features;
pub const MAX_NODES = MAX_SLOTS * MAX_FEATURES;
/// Upper bound on legal placements for one tile.
pub const MAX_PLACEMENTS = 4 * (2 * MAX_SLOTS + 2);
const MAP_SIZE = 256;
const NONE: u8 = 0xff;

pub const Ruleset = struct {
    /// Field (farmer) scoring edition, 1..3. Editions 1 and 2 also score a
    /// completed 2-tile city as 2 points.
    field_edition: u8 = 3,
    river: bool = true,
    abbot: bool = true,
    /// Tiles held in hand. Only 1 is supported (the hand variant is P1).
    hand_size: u8 = 1,
};

pub const FigureKind = enum(u8) { meeple, abbot };

pub const FigureAction = union(enum) {
    none,
    meeple: u8,
    abbot: u8,
    recall_abbot: Cell,
};

pub const Cell = struct { x: i16, y: i16 };

pub const Placement = struct { x: i16, y: i16, rot: u2 };

pub const Move = struct {
    x: i16,
    y: i16,
    rot: u2,
    figure: FigureAction = .none,
};

pub const FigureOption = struct { kind: FigureKind, feature: u8 };

pub const Status = enum(u8) { playing, ended };

pub const Category = enum(u3) { road, city, cloister, garden, field };
pub const Breakdown = [5]u32;

pub const FigureRef = struct { player: u8, x: i16, y: i16, feature: u8, figure: FigureKind };

pub const Event = union(enum) {
    turn_started: struct { player: u8, tile: TileIndex },
    tile_discarded: struct { tile: TileIndex },
    tile_placed: struct { player: u8, x: i16, y: i16, rot: u2, tile: TileIndex },
    figure_placed: struct { player: u8, x: i16, y: i16, feature: u8, figure: FigureKind },
    feature_scored: struct {
        kind: FeatureKind,
        cells: []const Cell,
        /// Bit p set when player p scored.
        winners: u8,
        points: u32,
        returned: []const FigureRef,
        final: bool,
    },
    abbot_recalled: struct { player: u8, x: i16, y: i16, points: u32 },
    game_ended: struct { players: u8, scores: [MAX_PLAYERS]u32, breakdown: [MAX_PLAYERS]Breakdown },
};

/// Event sink. Owns an arena for the variable-length parts of events.
pub const Events = struct {
    arena: std.heap.ArenaAllocator,
    list: std.ArrayList(Event) = .empty,

    pub fn init(gpa: std.mem.Allocator) Events {
        return .{ .arena = std.heap.ArenaAllocator.init(gpa) };
    }

    pub fn deinit(self: *Events) void {
        self.arena.deinit();
    }

    pub fn clear(self: *Events) void {
        _ = self.arena.reset(.retain_capacity);
        self.list = .empty;
    }

    pub fn items(self: *const Events) []const Event {
        return self.list.items;
    }

    fn push(self: *Events, e: Event) !void {
        try self.list.append(self.arena.allocator(), e);
    }
};

pub const Error = error{
    GameOver,
    IllegalPlacement,
    IllegalFigure,
    BadRuleset,
    BadPlayers,
    OutOfMemory,
};

const Placed = struct { x: i16, y: i16, tile: TileIndex, rot: u2 };

const FigureSlot = struct {
    on_board: bool = false,
    slot: u8 = 0,
    feature: u8 = 0,
};

const RiverState = struct {
    /// True while the river still has an open end to extend.
    open: bool = false,
    /// Cell the next river tile must occupy.
    x: i16 = 0,
    y: i16 = 0,
    /// Side through which the river leaves the last river tile (flow direction).
    heading: u2 = 2,
    /// Flow direction out of the spring.
    spring_dir: u2 = 2,
    /// Turn made by the last river tile: -1 left, 0 straight/none, 1 right.
    last_turn: i8 = 0,
};

const dx = [4]i16{ 0, 1, 0, -1 };
const dy = [4]i16{ -1, 0, 1, 0 };

inline fn opposite(s: u2) u2 {
    return s +% 2;
}

pub const Game = struct {
    ruleset: Ruleset,
    seed: u64,
    num_players: u8,
    status: Status = .playing,
    ply: u32 = 0,
    current_player: u8 = 0,
    current_tile: TileIndex = NONE,

    deck: [MAX_SLOTS]TileIndex = @splat(0),
    deck_len: u8 = 0,
    deck_pos: u8 = 0,

    placed: [MAX_SLOTS]Placed = @splat(.{ .x = 0, .y = 0, .tile = 0, .rot = 0 }),
    placed_len: u8 = 0,
    map_keys: [MAP_SIZE]u32 = @splat(0),
    /// Slot + 1, 0 = empty bucket.
    map_vals: [MAP_SIZE]u8 = @splat(0),

    // Union-find over (slot, feature) nodes; root data lives on the root.
    parent: [MAX_NODES]u16 = @splat(0),
    /// Road/city: number of tile sides of the feature not yet matched by a neighbour.
    open: [MAX_NODES]u16 = @splat(0),
    pennants: [MAX_NODES]u8 = @splat(0),

    figures: [MAX_PLAYERS][FIGURES_PER_PLAYER]FigureSlot = @splat(@splat(.{})),
    scores: [MAX_PLAYERS]u32 = @splat(0),
    breakdown: [MAX_PLAYERS]Breakdown = @splat(@splat(0)),

    river: RiverState = .{},

    // ------------------------------------------------------------ setup

    /// Create a game. `allocator` is unused today (Game is self-contained) but
    /// kept in the signature so callers do not change if that ever changes.
    /// Discards at setup (practically impossible) are not reported.
    pub fn init(allocator: std.mem.Allocator, ruleset: Ruleset, seed: u64, players: u8) Error!Game {
        _ = allocator;
        if (players < MIN_PLAYERS or players > MAX_PLAYERS) return error.BadPlayers;
        if (ruleset.field_edition < 1 or ruleset.field_edition > 3) return error.BadRuleset;
        if (ruleset.hand_size != 1) return error.BadRuleset;

        var g: Game = .{ .ruleset = ruleset, .seed = seed, .num_players = players };
        var rng = Rng.init(seed);
        const start_tile = tiles.indexOfComptime("D");
        const spring = tiles.indexOfComptime("R1");
        const lake = tiles.indexOfComptime("R12");

        if (ruleset.river) {
            // River rules: the spring is the start tile, the other river tiles are
            // shuffled with the lake at the bottom, and the regular start tile is
            // just another land tile.
            var n: u8 = 0;
            for (tiles.all, 0..) |t, i| {
                if (t.set != .river or t.special != .none) continue;
                g.deck[n] = @intCast(i);
                n += 1;
            }
            rng.shuffle(TileIndex, g.deck[0..n]);
            g.deck[n] = lake;
            n += 1;
            const base_start = n;
            for (tiles.all, 0..) |t, i| {
                if (t.set != .base) continue;
                for (0..t.count) |_| {
                    g.deck[n] = @intCast(i);
                    n += 1;
                }
            }
            rng.shuffle(TileIndex, g.deck[base_start..n]);
            g.deck_len = n;
            g.putTile(spring, 0, 0, 0);
            g.river = .{ .open = true, .x = 0, .y = 1, .heading = 2, .spring_dir = 2, .last_turn = 0 };
        } else {
            var n: u8 = 0;
            var skipped_start = false;
            for (tiles.all, 0..) |t, i| {
                if (t.set != .base) continue;
                for (0..t.count) |_| {
                    if (i == start_tile and !skipped_start) {
                        skipped_start = true;
                        continue;
                    }
                    g.deck[n] = @intCast(i);
                    n += 1;
                }
            }
            rng.shuffle(TileIndex, g.deck[0..n]);
            g.deck_len = n;
            g.putTile(start_tile, 0, 0, 0);
        }
        g.drawForTurn(null) catch unreachable; // no events -> no allocation
        return g;
    }

    // ------------------------------------------------------------ board lookup

    inline fn key(x: i16, y: i16) u32 {
        return (@as(u32, @as(u16, @bitCast(x))) << 16) | @as(u16, @bitCast(y));
    }

    inline fn bucket(k: u32) usize {
        return @intCast((k *% 0x9E3779B1) >> 24);
    }

    /// Slot index of the tile at (x, y), if any.
    pub fn slotAt(self: *const Game, x: i16, y: i16) ?u8 {
        const k = key(x, y);
        var b = bucket(k);
        while (self.map_vals[b] != 0) : (b = (b + 1) % MAP_SIZE) {
            if (self.map_keys[b] == k) return self.map_vals[b] - 1;
        }
        return null;
    }

    fn mapInsert(self: *Game, x: i16, y: i16, slot: u8) void {
        const k = key(x, y);
        var b = bucket(k);
        while (self.map_vals[b] != 0) b = (b + 1) % MAP_SIZE;
        self.map_keys[b] = k;
        self.map_vals[b] = slot + 1;
    }

    pub fn placedTiles(self: *const Game) []const Placed {
        return self.placed[0..self.placed_len];
    }

    inline fn rotOf(self: *const Game, slot: u8) *const tiles.Rotated {
        const p = self.placed[slot];
        return &tiles.rotated[p.tile][p.rot];
    }

    inline fn featureKind(self: *const Game, slot: u8, f: u8) FeatureKind {
        return tiles.all[self.placed[slot].tile].features[f].kind;
    }

    pub inline fn node(slot: u8, f: u8) u16 {
        return @as(u16, slot) * @as(u16, MAX_FEATURES) + f;
    }

    // ------------------------------------------------------------ union-find

    pub fn find(self: *Game, n: u16) u16 {
        var x = n;
        while (self.parent[x] != x) {
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        return x;
    }

    /// Non-mutating find, for const queries.
    pub fn findConst(self: *const Game, n: u16) u16 {
        var x = n;
        while (self.parent[x] != x) x = self.parent[x];
        return x;
    }

    fn unite(self: *Game, a: u16, b: u16) void {
        const ra = self.find(a);
        const rb = self.find(b);
        if (ra == rb) return;
        const lo = @min(ra, rb);
        const hi = @max(ra, rb);
        self.parent[hi] = lo;
        self.open[lo] += self.open[hi];
        self.pennants[lo] += self.pennants[hi];
    }

    // ------------------------------------------------------------ placement

    fn edgesMatch(self: *const Game, t: TileIndex, x: i16, y: i16, rot: u2) bool {
        const r = &tiles.rotated[t][rot];
        var neighbours: u8 = 0;
        for (0..4) |s| {
            const ns = self.slotAt(x + dx[s], y + dy[s]) orelse continue;
            neighbours += 1;
            const nr = self.rotOf(ns);
            if (nr.edges[opposite(@intCast(s))] != r.edges[s]) return false;
        }
        return neighbours > 0;
    }

    /// River sides of a rotated river tile (bit s = side s).
    fn riverSides(t: TileIndex, rot: u2) u4 {
        const r = &tiles.rotated[t][rot];
        var m: u4 = 0;
        for (0..4) |s| {
            if (r.edges[s] == .river) m |= @as(u4, 1) << @intCast(s);
        }
        return m;
    }

    const RiverStep = struct { exit: ?u2, turn: i8 };

    /// Validate a river tile against the river rules; returns the new heading.
    fn riverStep(self: *const Game, t: TileIndex, x: i16, y: i16, rot: u2) ?RiverStep {
        const rv = self.river;
        if (!rv.open or x != rv.x or y != rv.y) return null;
        const entry = opposite(rv.heading);
        const sides = riverSides(t, rot);
        if (sides & (@as(u4, 1) << entry) == 0) return null;
        const rest = sides & ~(@as(u4, 1) << entry);
        if (rest == 0) return .{ .exit = null, .turn = 0 }; // lake
        const exit: u2 = @intCast(@ctz(rest));
        var turn: i8 = 0;
        if (exit == rv.heading +% 1) turn = 1 else if (exit == rv.heading -% 1) turn = -1;
        // No immediate U-turn: two consecutive bends may not turn the same way.
        if (turn != 0 and turn == rv.last_turn) return null;
        // The river may never flow back against the spring's direction.
        if (exit == opposite(rv.spring_dir)) return null;
        // The next cell must still be free.
        if (self.slotAt(x + dx[exit], y + dy[exit]) != null) return null;
        return .{ .exit = exit, .turn = turn };
    }

    /// Whether tile `t` can be placed at (x, y) with rotation `rot`.
    pub fn canPlace(self: *const Game, t: TileIndex, x: i16, y: i16, rot: u2) bool {
        if (self.slotAt(x, y) != null) return false;
        if (!self.edgesMatch(t, x, y, rot)) return false;
        if (tiles.isRiver(t)) return self.riverStep(t, x, y, rot) != null;
        return true;
    }

    /// Writes every legal placement of tile `t` into `out` and returns the used part.
    /// Order is deterministic (by placed-slot frontier, then rotation).
    pub fn placementsFor(self: *const Game, t: TileIndex, out: []Placement) []Placement {
        var n: usize = 0;
        if (tiles.isRiver(t)) {
            if (!self.river.open) return out[0..0];
            for (0..4) |r| {
                if (self.canPlace(t, self.river.x, self.river.y, @intCast(r))) {
                    out[n] = .{ .x = self.river.x, .y = self.river.y, .rot = @intCast(r) };
                    n += 1;
                }
            }
            return out[0..n];
        }
        var seen: [4 * MAX_SLOTS]Cell = undefined;
        var seen_len: usize = 0;
        for (self.placed[0..self.placed_len]) |p| {
            for (0..4) |s| {
                const cx = p.x + dx[s];
                const cy = p.y + dy[s];
                if (self.slotAt(cx, cy) != null) continue;
                var dup = false;
                for (seen[0..seen_len]) |c| {
                    if (c.x == cx and c.y == cy) {
                        dup = true;
                        break;
                    }
                }
                if (dup) continue;
                seen[seen_len] = .{ .x = cx, .y = cy };
                seen_len += 1;
                for (0..4) |r| {
                    if (self.edgesMatch(t, cx, cy, @intCast(r))) {
                        out[n] = .{ .x = cx, .y = cy, .rot = @intCast(r) };
                        n += 1;
                    }
                }
            }
        }
        return out[0..n];
    }

    pub fn hasPlacement(self: *const Game, t: TileIndex) bool {
        var buf: [MAX_PLACEMENTS]Placement = undefined;
        return self.placementsFor(t, &buf).len > 0;
    }

    /// Legal placements of the current tile.
    pub fn legalPlacements(self: *const Game, out: []Placement) []Placement {
        if (self.status != .playing) return out[0..0];
        return self.placementsFor(self.current_tile, out);
    }

    /// Put a tile on the board and merge its features. No legality checks:
    /// for fixtures and search code that already validated the placement.
    pub fn putTile(self: *Game, t: TileIndex, x: i16, y: i16, rot: u2) void {
        const slot = self.placed_len;
        self.placed[slot] = .{ .x = x, .y = y, .tile = t, .rot = rot };
        self.placed_len += 1;
        self.mapInsert(x, y, slot);

        const d = tiles.def(t);
        const r = &tiles.rotated[t][rot];
        for (d.features, 0..) |f, fi| {
            const n = node(slot, @intCast(fi));
            self.parent[n] = n;
            self.open[n] = 0;
            self.pennants[n] = f.pennants;
        }
        for (d.features, 0..) |f, fi| {
            const n = node(slot, @intCast(fi));
            switch (f.kind) {
                .road, .city => {
                    for (0..4) |s| {
                        if (r.feature_sides[fi] & (@as(u4, 1) << @intCast(s)) == 0) continue;
                        if (self.slotAt(x + dx[s], y + dy[s])) |ns| {
                            const np: u4 = tile.opposingPort(@intCast(s * 3 + 1));
                            const nf = self.rotOf(ns).port_feature[np];
                            const nn = node(ns, nf);
                            const root = self.find(nn);
                            self.open[root] -= 1;
                            self.unite(n, nn);
                        } else {
                            self.open[self.find(n)] += 1;
                        }
                    }
                },
                .field => {
                    for (0..12) |p| {
                        if (r.feature_ports[fi] & (@as(tile.PortMask, 1) << @intCast(p)) == 0) continue;
                        const s = p / 3;
                        const ns = self.slotAt(x + dx[s], y + dy[s]) orelse continue;
                        const np = tile.opposingPort(@intCast(p));
                        self.unite(n, node(ns, self.rotOf(ns).port_feature[np]));
                    }
                },
                else => {},
            }
        }

        if (tiles.isRiver(t) and d.special != .spring) {
            const step = self.riverStep(t, x, y, rot).?;
            if (step.exit) |e| {
                self.river.x = x + dx[e];
                self.river.y = y + dy[e];
                self.river.heading = e;
                self.river.last_turn = step.turn;
            } else {
                self.river.open = false;
            }
        }
    }

    // ------------------------------------------------------------ figures

    fn nodeOccupied(self: *Game, root: u16) bool {
        for (0..self.num_players) |p| {
            for (self.figures[p]) |fs| {
                if (fs.on_board and self.find(node(fs.slot, fs.feature)) == root) return true;
            }
        }
        return false;
    }

    pub fn meeplesInSupply(self: *const Game, player: u8) u8 {
        var n: u8 = 0;
        for (self.figures[player][0..MEEPLES_PER_PLAYER]) |fs| {
            if (!fs.on_board) n += 1;
        }
        return n;
    }

    pub fn abbotAvailable(self: *const Game, player: u8) bool {
        return self.ruleset.abbot and !self.figures[player][ABBOT_SLOT].on_board;
    }

    fn freeMeeple(self: *const Game, player: u8) ?usize {
        for (self.figures[player][0..MEEPLES_PER_PLAYER], 0..) |fs, i| {
            if (!fs.on_board) return i;
        }
        return null;
    }

    /// Figure options on the most recently placed tile (call after placing).
    fn figureOptionsOnLast(self: *Game, player: u8, out: []FigureOption) []FigureOption {
        const slot = self.placed_len - 1;
        const d = tiles.def(self.placed[slot].tile);
        var n: usize = 0;
        const has_meeple = self.freeMeeple(player) != null;
        const has_abbot = self.abbotAvailable(player);
        for (d.features, 0..) |f, fi| {
            const nd = node(slot, @intCast(fi));
            switch (f.kind) {
                .road, .city, .field, .cloister => if (has_meeple and !self.nodeOccupied(self.find(nd))) {
                    out[n] = .{ .kind = .meeple, .feature = @intCast(fi) };
                    n += 1;
                },
                else => {},
            }
            switch (f.kind) {
                .cloister, .garden => if (has_abbot and !self.nodeOccupied(self.find(nd))) {
                    out[n] = .{ .kind = .abbot, .feature = @intCast(fi) };
                    n += 1;
                },
                else => {},
            }
        }
        return out[0..n];
    }

    /// Figure options for the current player if the current tile were placed at
    /// (x, y, rot). Empty if the placement is illegal.
    pub fn legalFigures(self: *const Game, x: i16, y: i16, rot: u2, out: []FigureOption) []FigureOption {
        if (self.status != .playing or !self.canPlace(self.current_tile, x, y, rot)) return out[0..0];
        var tmp = self.*;
        tmp.putTile(self.current_tile, x, y, rot);
        return tmp.figureOptionsOnLast(self.current_player, out);
    }

    /// Tiles around (x, y) that are present (0..8), not counting (x, y) itself.
    pub fn neighbourCount(self: *const Game, x: i16, y: i16) u32 {
        var n: u32 = 0;
        var oy: i16 = -1;
        while (oy <= 1) : (oy += 1) {
            var ox: i16 = -1;
            while (ox <= 1) : (ox += 1) {
                if (ox == 0 and oy == 0) continue;
                if (self.slotAt(x + ox, y + oy) != null) n += 1;
            }
        }
        return n;
    }

    // ------------------------------------------------------------ turn

    /// Apply one move (place the current tile, then one figure action). On error
    /// the game is unchanged. Events are appended to `events` when given.
    pub fn apply(self: *Game, move: Move, events: ?*Events) Error!void {
        if (self.status != .playing) return error.GameOver;
        const t = self.current_tile;
        if (!self.canPlace(t, move.x, move.y, move.rot)) return error.IllegalPlacement;

        var next = self.*;
        next.putTile(t, move.x, move.y, move.rot);
        const player = next.current_player;
        const slot = next.placed_len - 1;

        // Validate the figure action against the post-placement board.
        var recall_points: u32 = 0;
        var recall_cat: Category = .cloister;
        var recall_cell: Cell = undefined;
        switch (move.figure) {
            .none => {},
            .meeple, .abbot => |f| {
                var buf: [2 * MAX_FEATURES]FigureOption = undefined;
                const kind: FigureKind = if (move.figure == .meeple) .meeple else .abbot;
                const opts = next.figureOptionsOnLast(player, &buf);
                var ok = false;
                for (opts) |o| {
                    if (o.kind == kind and o.feature == f) ok = true;
                }
                if (!ok) return error.IllegalFigure;
            },
            .recall_abbot => |c| {
                if (!next.ruleset.abbot) return error.IllegalFigure;
                const ab = next.figures[player][ABBOT_SLOT];
                if (!ab.on_board) return error.IllegalFigure;
                const p = next.placed[ab.slot];
                if (p.x != c.x or p.y != c.y) return error.IllegalFigure;
                const nb = next.neighbourCount(p.x, p.y);
                // Only an unfinished cloister/garden can be recalled (Abbot FAQ 11/2020).
                if (nb == 8) return error.IllegalFigure;
                recall_points = 1 + nb;
                recall_cat = if (next.featureKind(ab.slot, ab.feature) == .garden) .garden else .cloister;
                recall_cell = c;
            },
        }

        // Commit.
        self.* = next;
        self.ply += 1;
        if (events) |ev| try ev.push(.{ .tile_placed = .{ .player = player, .x = move.x, .y = move.y, .rot = move.rot, .tile = t } });
        switch (move.figure) {
            .none => {},
            .meeple => |f| {
                const i = self.freeMeeple(player).?;
                self.figures[player][i] = .{ .on_board = true, .slot = slot, .feature = f };
                if (events) |ev| try ev.push(.{ .figure_placed = .{ .player = player, .x = move.x, .y = move.y, .feature = f, .figure = .meeple } });
            },
            .abbot => |f| {
                self.figures[player][ABBOT_SLOT] = .{ .on_board = true, .slot = slot, .feature = f };
                if (events) |ev| try ev.push(.{ .figure_placed = .{ .player = player, .x = move.x, .y = move.y, .feature = f, .figure = .abbot } });
            },
            .recall_abbot => {
                self.figures[player][ABBOT_SLOT] = .{};
                self.addScore(player, recall_cat, recall_points);
                if (events) |ev| try ev.push(.{ .abbot_recalled = .{ .player = player, .x = recall_cell.x, .y = recall_cell.y, .points = recall_points } });
            },
        }

        try self.scoreCompleted(slot, events);

        self.current_player = @intCast((@as(u16, self.current_player) + 1) % self.num_players);
        try self.drawForTurn(events);
    }

    /// Draw the next placeable tile for the current player (discarding
    /// unplaceable ones), or end the game when the pile is empty.
    pub fn drawForTurn(self: *Game, events: ?*Events) Error!void {
        while (self.deck_pos < self.deck_len) {
            const t = self.deck[self.deck_pos];
            self.deck_pos += 1;
            if (self.hasPlacement(t)) {
                self.current_tile = t;
                if (events) |ev| try ev.push(.{ .turn_started = .{ .player = self.current_player, .tile = t } });
                return;
            }
            // Unplaceable: shown to everyone, removed from the game, draw again.
            if (events) |ev| try ev.push(.{ .tile_discarded = .{ .tile = t } });
        }
        try self.endGame(events);
    }

    /// Tiles left in the draw pile (not counting the current tile).
    pub fn remainingDeck(self: *const Game) []const TileIndex {
        return self.deck[self.deck_pos..self.deck_len];
    }

    // ------------------------------------------------------------ scoring

    fn addScore(self: *Game, player: u8, cat: Category, pts: u32) void {
        self.scores[player] += pts;
        self.breakdown[player][@intFromEnum(cat)] += pts;
    }

    const Majority = struct { winners: u8, counts: [MAX_PLAYERS]u8 };

    fn majority(self: *Game, root: u16) Majority {
        var m: Majority = .{ .winners = 0, .counts = @splat(0) };
        for (0..self.num_players) |p| {
            for (self.figures[p]) |fs| {
                if (fs.on_board and self.find(node(fs.slot, fs.feature)) == root) m.counts[p] += 1;
            }
        }
        m.winners = winnersOf(m.counts);
        return m;
    }

    fn winnersOf(counts: [MAX_PLAYERS]u8) u8 {
        var best: u8 = 0;
        for (counts) |c| best = @max(best, c);
        if (best == 0) return 0;
        var w: u8 = 0;
        for (counts, 0..) |c, p| {
            if (c == best) w |= @as(u8, 1) << @intCast(p);
        }
        return w;
    }

    /// Remove every figure on `root`; record them in `out` when given.
    fn returnFigures(self: *Game, root: u16, out: ?*std.ArrayList(FigureRef), alloc: std.mem.Allocator) !void {
        for (0..self.num_players) |p| {
            for (&self.figures[p], 0..) |*fs, i| {
                if (!fs.on_board or self.find(node(fs.slot, fs.feature)) != root) continue;
                if (out) |o| {
                    const pl = self.placed[fs.slot];
                    try o.append(alloc, .{ .player = @intCast(p), .x = pl.x, .y = pl.y, .feature = fs.feature, .figure = if (i == ABBOT_SLOT) .abbot else .meeple });
                }
                fs.* = .{};
            }
        }
    }

    /// Distinct tiles of a road/city/field extent, and their cells.
    fn extentTiles(self: *Game, root: u16, cells: ?*std.ArrayList(Cell), alloc: std.mem.Allocator) !u32 {
        var n: u32 = 0;
        for (self.placed[0..self.placed_len], 0..) |p, slot| {
            const nf = tiles.def(p.tile).features.len;
            for (0..nf) |f| {
                if (self.find(node(@intCast(slot), @intCast(f))) == root) {
                    n += 1;
                    if (cells) |c| try c.append(alloc, .{ .x = p.x, .y = p.y });
                    break;
                }
            }
        }
        return n;
    }

    fn cloisterCells(self: *const Game, x: i16, y: i16, cells: ?*std.ArrayList(Cell), alloc: std.mem.Allocator) !void {
        const c = cells orelse return;
        var oy: i16 = -1;
        while (oy <= 1) : (oy += 1) {
            var ox: i16 = -1;
            while (ox <= 1) : (ox += 1) {
                if (self.slotAt(x + ox, y + oy) != null) try c.append(alloc, .{ .x = x + ox, .y = y + oy });
            }
        }
    }

    fn cityPoints(self: *const Game, tile_count: u32, pennant_count: u32, complete: bool) u32 {
        if (!complete) return tile_count + pennant_count;
        // 1st/2nd edition rules: a completed 2-tile city scores only 2.
        if (self.ruleset.field_edition <= 2 and tile_count == 2) return 2;
        return 2 * tile_count + 2 * pennant_count;
    }

    /// Score one road/city/cloister/garden feature (by root node).
    fn scoreFeature(self: *Game, root: u16, slot: u8, kind: FeatureKind, final: bool, events: ?*Events) Error!void {
        const alloc = if (events) |ev| ev.arena.allocator() else std.heap.page_allocator; // unused when events == null
        var cells: std.ArrayList(Cell) = .empty;
        var returned: std.ArrayList(FigureRef) = .empty;
        const cells_ptr: ?*std.ArrayList(Cell) = if (events != null) &cells else null;
        const ret_ptr: ?*std.ArrayList(FigureRef) = if (events != null) &returned else null;

        const m = self.majority(root);
        var points: u32 = 0;
        var cat: Category = .road;
        switch (kind) {
            .road => {
                points = try self.extentTiles(root, cells_ptr, alloc);
                cat = .road;
            },
            .city => {
                const n = try self.extentTiles(root, cells_ptr, alloc);
                points = self.cityPoints(n, self.pennants[root], self.open[root] == 0);
                cat = .city;
            },
            .cloister, .garden => {
                const p = self.placed[slot];
                points = 1 + self.neighbourCount(p.x, p.y);
                try self.cloisterCells(p.x, p.y, cells_ptr, alloc);
                cat = if (kind == .garden) .garden else .cloister;
            },
            else => unreachable,
        }
        for (0..self.num_players) |p| {
            if (m.winners & (@as(u8, 1) << @intCast(p)) != 0) self.addScore(@intCast(p), cat, points);
        }
        try self.returnFigures(root, ret_ptr, alloc);
        if (events) |ev| try ev.push(.{ .feature_scored = .{
            .kind = kind,
            .cells = cells.items,
            .winners = m.winners,
            .points = points,
            .returned = returned.items,
            .final = final,
        } });
    }

    /// Score roads/cities/cloisters/gardens completed by the tile in `slot`.
    fn scoreCompleted(self: *Game, slot: u8, events: ?*Events) Error!void {
        const p = self.placed[slot];
        const d = tiles.def(p.tile);
        var done: [MAX_FEATURES]u16 = undefined;
        var done_len: usize = 0;
        for (d.features, 0..) |f, fi| {
            if (f.kind != .road and f.kind != .city) continue;
            const root = self.find(node(slot, @intCast(fi)));
            if (self.open[root] != 0) continue;
            if (std.mem.indexOfScalar(u16, done[0..done_len], root) != null) continue;
            done[done_len] = root;
            done_len += 1;
            try self.scoreFeature(root, slot, f.kind, false, events);
        }
        // Cloisters and gardens in the 3x3 block that just became surrounded.
        var oy: i16 = -1;
        while (oy <= 1) : (oy += 1) {
            var ox: i16 = -1;
            while (ox <= 1) : (ox += 1) {
                const s = self.slotAt(p.x + ox, p.y + oy) orelse continue;
                if (self.neighbourCount(p.x + ox, p.y + oy) != 8) continue;
                const sd = tiles.def(self.placed[s].tile);
                for (sd.features, 0..) |f, fi| {
                    if (f.kind == .cloister or (f.kind == .garden and self.ruleset.abbot)) {
                        try self.scoreFeature(node(s, @intCast(fi)), s, f.kind, false, events);
                    }
                }
            }
        }
    }

    fn endGame(self: *Game, events: ?*Events) Error!void {
        self.current_tile = NONE;
        self.status = .ended;
        // Incomplete roads, cities, cloisters and gardens with figures.
        var seen = std.StaticBitSet(MAX_NODES).empty;
        for (0..self.placed_len) |slot_usize| {
            const slot: u8 = @intCast(slot_usize);
            const d = tiles.def(self.placed[slot].tile);
            for (d.features, 0..) |f, fi| {
                switch (f.kind) {
                    .road, .city, .cloister, .garden => {},
                    else => continue,
                }
                const root = self.find(node(slot, @intCast(fi)));
                if (seen.isSet(root)) continue;
                seen.set(root);
                if (!self.nodeOccupied(root)) continue;
                try self.scoreFeature(root, slot, f.kind, true, events);
            }
        }
        try self.scoreFields(events);
        if (events) |ev| try ev.push(.{ .game_ended = .{ .players = self.num_players, .scores = self.scores, .breakdown = self.breakdown } });
    }

    const FieldInfo = struct {
        root: u16,
        counts: [MAX_PLAYERS]u8,
        winners: u8,
        /// Completed adjacent city roots.
        cities: std.ArrayList(u16) = .empty,
    };

    fn scoreFields(self: *Game, events: ?*Events) Error!void {
        // Scratch memory: a fixed buffer is enough for every bound below.
        var scratch: [64 * 1024]u8 = undefined;
        var fba = std.heap.FixedBufferAllocator.init(&scratch);
        const tmp = fba.allocator();
        const ev_alloc = if (events) |ev| ev.arena.allocator() else tmp;

        // Fields with farmers, in order of first appearance.
        var fields: std.ArrayList(FieldInfo) = .empty;
        for (0..self.placed_len) |slot_usize| {
            const slot: u8 = @intCast(slot_usize);
            const d = tiles.def(self.placed[slot].tile);
            for (d.features, 0..) |f, fi| {
                if (f.kind != .field) continue;
                const root = self.find(node(slot, @intCast(fi)));
                var known = false;
                for (fields.items) |fi2| {
                    if (fi2.root == root) known = true;
                }
                if (known or !self.nodeOccupied(root)) continue;
                const m = self.majority(root);
                try fields.append(tmp, .{ .root = root, .counts = m.counts, .winners = m.winners });
            }
        }
        if (fields.items.len == 0) return;
        // Completed cities adjacent to each farmed field.
        for (0..self.placed_len) |slot_usize| {
            const slot: u8 = @intCast(slot_usize);
            const d = tiles.def(self.placed[slot].tile);
            for (d.features, 0..) |f, fi| {
                if (f.kind != .field) continue;
                const root = self.find(node(slot, @intCast(fi)));
                for (fields.items) |*info| {
                    if (info.root != root) continue;
                    for (f.adjacent_cities) |ci| {
                        const croot = self.find(node(slot, ci));
                        if (self.open[croot] != 0) continue;
                        if (std.mem.indexOfScalar(u16, info.cities.items, croot) == null) try info.cities.append(tmp, croot);
                    }
                }
            }
        }

        switch (self.ruleset.field_edition) {
            3 => {
                // 3rd edition: each field pays 3 per completed city to its majority.
                for (fields.items) |*info| {
                    const pts: u32 = 3 * @as(u32, @intCast(info.cities.items.len));
                    try self.emitField(info.root, info.winners, pts, events, ev_alloc, &.{info.root});
                }
            },
            2 => {
                // 2nd edition: per field, but a player scores each city only once.
                var credited: [MAX_PLAYERS]std.ArrayList(u16) = @splat(.empty);
                for (fields.items) |*info| {
                    var pts: [MAX_PLAYERS]u32 = @splat(0);
                    for (0..self.num_players) |p| {
                        if (info.winners & (@as(u8, 1) << @intCast(p)) == 0) continue;
                        for (info.cities.items) |c| {
                            if (std.mem.indexOfScalar(u16, credited[p].items, c) != null) continue;
                            try credited[p].append(tmp, c);
                            pts[p] += 3;
                        }
                    }
                    // One event per distinct point value among the winners.
                    var remaining = info.winners;
                    var first = true;
                    while (remaining != 0) {
                        const lead: u8 = @intCast(@ctz(remaining));
                        var group: u8 = 0;
                        for (0..self.num_players) |p| {
                            if (remaining & (@as(u8, 1) << @intCast(p)) != 0 and pts[p] == pts[lead]) group |= @as(u8, 1) << @intCast(p);
                        }
                        remaining &= ~group;
                        try self.emitField(info.root, group, pts[lead], events, ev_alloc, if (first) &.{info.root} else &.{});
                        first = false;
                    }
                }
            },
            else => {
                // 1st edition: each completed city scores 4 once, to the player(s)
                // with the most farmers across all fields that supply it.
                var cities: std.ArrayList(u16) = .empty;
                for (fields.items) |info| {
                    for (info.cities.items) |c| {
                        if (std.mem.indexOfScalar(u16, cities.items, c) == null) try cities.append(tmp, c);
                    }
                }
                var returned = std.StaticBitSet(MAX_NODES).empty;
                for (cities.items) |c| {
                    var counts: [MAX_PLAYERS]u8 = @splat(0);
                    var suppliers: std.ArrayList(u16) = .empty;
                    for (fields.items) |info| {
                        if (std.mem.indexOfScalar(u16, info.cities.items, c) == null) continue;
                        for (0..MAX_PLAYERS) |p| counts[p] += info.counts[p];
                        if (!returned.isSet(info.root)) {
                            returned.set(info.root);
                            try suppliers.append(tmp, info.root);
                        }
                    }
                    const w = winnersOf(counts);
                    try self.emitCityFarmers(c, w, suppliers.items, events, ev_alloc);
                }
                for (fields.items) |info| {
                    if (returned.isSet(info.root)) continue;
                    try self.emitField(info.root, info.winners, 0, events, ev_alloc, &.{info.root});
                }
            },
        }
    }

    /// Pay `points` to each winner of a field and emit the event; figures on
    /// the fields in `return_roots` go back to their owners.
    fn emitField(self: *Game, root: u16, winners: u8, points: u32, events: ?*Events, alloc: std.mem.Allocator, return_roots: []const u16) Error!void {
        for (0..self.num_players) |p| {
            if (winners & (@as(u8, 1) << @intCast(p)) != 0) self.addScore(@intCast(p), .field, points);
        }
        var cells: std.ArrayList(Cell) = .empty;
        var returned: std.ArrayList(FigureRef) = .empty;
        const want = events != null;
        _ = try self.extentTiles(root, if (want) &cells else null, alloc);
        for (return_roots) |r| try self.returnFigures(r, if (want) &returned else null, alloc);
        if (events) |ev| try ev.push(.{ .feature_scored = .{ .kind = .field, .cells = cells.items, .winners = winners, .points = points, .returned = returned.items, .final = true } });
    }

    /// 1st-edition farmer scoring of one completed city (cells are the city's).
    fn emitCityFarmers(self: *Game, city_root: u16, winners: u8, suppliers: []const u16, events: ?*Events, alloc: std.mem.Allocator) Error!void {
        for (0..self.num_players) |p| {
            if (winners & (@as(u8, 1) << @intCast(p)) != 0) self.addScore(@intCast(p), .field, 4);
        }
        var cells: std.ArrayList(Cell) = .empty;
        var returned: std.ArrayList(FigureRef) = .empty;
        const want = events != null;
        _ = try self.extentTiles(city_root, if (want) &cells else null, alloc);
        for (suppliers) |r| try self.returnFigures(r, if (want) &returned else null, alloc);
        if (events) |ev| try ev.push(.{ .feature_scored = .{ .kind = .field, .cells = cells.items, .winners = winners, .points = 4, .returned = returned.items, .final = true } });
    }

    // ------------------------------------------------------------ queries for views

    pub const BoardFigure = struct { player: u8, feature: u8, figure: FigureKind };

    /// Figures standing on the tile in `slot`.
    pub fn figuresOn(self: *const Game, slot: u8, out: []BoardFigure) []BoardFigure {
        var n: usize = 0;
        for (0..self.num_players) |p| {
            for (self.figures[p], 0..) |fs, i| {
                if (!fs.on_board or fs.slot != slot) continue;
                out[n] = .{ .player = @intCast(p), .feature = fs.feature, .figure = if (i == ABBOT_SLOT) .abbot else .meeple };
                n += 1;
            }
        }
        return out[0..n];
    }

    /// Tile counts of the draw pile by tile index.
    pub fn remainingCounts(self: *const Game) [tiles.count]u8 {
        var c: [tiles.count]u8 = @splat(0);
        for (self.remainingDeck()) |t| c[t] += 1;
        return c;
    }

    pub fn currentTile(self: *const Game) ?TileIndex {
        return if (self.status == .playing) self.current_tile else null;
    }

    // ------------------------------------------------------------ hashing / snapshots

    /// Deterministic 64-bit hash (FNV-1a) of the canonical serialised state.
    pub fn hash(self: *const Game) u64 {
        var h = Fnv{};
        serialize(Game, self, &h);
        return h.state;
    }

    pub const SNAPSHOT_SIZE: usize = serialSize(Game);

    pub fn snapshotBytes(self: *const Game, out: *[SNAPSHOT_SIZE]u8) void {
        var w = BufWriter{ .buf = out };
        serialize(Game, self, &w);
    }

    pub fn restoreBytes(bytes: []const u8) error{BadSnapshot}!Game {
        if (bytes.len != SNAPSHOT_SIZE) return error.BadSnapshot;
        var r = BufReader{ .buf = bytes };
        var g: Game = undefined;
        try deserialize(Game, &g, &r);
        try g.validate();
        return g;
    }

    /// Bounds checks so a corrupt snapshot cannot index out of range.
    fn validate(self: *const Game) error{BadSnapshot}!void {
        const bad = error.BadSnapshot;
        if (self.num_players < MIN_PLAYERS or self.num_players > MAX_PLAYERS) return bad;
        if (self.current_player >= self.num_players) return bad;
        if (self.ruleset.field_edition < 1 or self.ruleset.field_edition > 3 or self.ruleset.hand_size != 1) return bad;
        if (self.placed_len > MAX_SLOTS or self.deck_len > MAX_SLOTS or self.deck_pos > self.deck_len) return bad;
        if (self.status == .playing and self.current_tile >= tiles.count) return bad;
        for (self.deck[0..self.deck_len]) |t| if (t >= tiles.count) return bad;
        for (self.placed[0..self.placed_len]) |p| if (p.tile >= tiles.count) return bad;
        for (self.map_vals) |v| if (v > self.placed_len) return bad;
        for (self.parent) |p| if (p >= MAX_NODES) return bad;
        for (self.figures) |pf| for (pf) |fs| {
            if (!fs.on_board) continue;
            if (fs.slot >= self.placed_len) return bad;
            if (fs.feature >= tiles.def(self.placed[fs.slot].tile).features.len) return bad;
        };
        // Union-find must be acyclic for nodes in use.
        for (0..self.placed_len) |slot| {
            const nf = tiles.def(self.placed[slot].tile).features.len;
            for (0..nf) |f| {
                var x: u16 = node(@intCast(slot), @intCast(f));
                var steps: usize = 0;
                while (self.parent[x] != x) : (steps += 1) {
                    if (steps > MAX_NODES) return bad;
                    x = self.parent[x];
                }
            }
        }
    }
};

// -------------------------------------------------------------- serialisation

const Fnv = struct {
    state: u64 = 0xcbf29ce484222325,
    fn write(self: *Fnv, bytes: []const u8) void {
        for (bytes) |b| {
            self.state ^= b;
            self.state *%= 0x100000001b3;
        }
    }
};

fn serialSize(comptime T: type) usize {
    return switch (@typeInfo(T)) {
        .int => @typeInfo(byteInt(T)).int.bits / 8,
        .bool => 1,
        .@"enum" => |info| serialSize(info.tag_type),
        .array => |info| info.len * serialSize(info.child),
        .@"struct" => |info| blk: {
            var n: usize = 0;
            for (info.field_types) |ft| n += serialSize(ft);
            break :blk n;
        },
        else => @compileError("cannot serialise " ++ @typeName(T)),
    };
}

const BufWriter = struct {
    buf: []u8,
    pos: usize = 0,
    fn write(self: *BufWriter, bytes: []const u8) void {
        @memcpy(self.buf[self.pos..][0..bytes.len], bytes);
        self.pos += bytes.len;
    }
};

const BufReader = struct {
    buf: []const u8,
    pos: usize = 0,
    fn read(self: *BufReader, n: usize) error{BadSnapshot}![]const u8 {
        if (self.pos + n > self.buf.len) return error.BadSnapshot;
        defer self.pos += n;
        return self.buf[self.pos..][0..n];
    }
};

fn byteInt(comptime T: type) type {
    const bits = @typeInfo(T).int.bits;
    return @Int(.unsigned, ((bits + 7) / 8) * 8);
}

/// Field-by-field little-endian encoding (never raw memory, so padding and
/// layout never leak into hashes or snapshots).
fn serialize(comptime T: type, v: *const T, w: anytype) void {
    switch (@typeInfo(T)) {
        .int => |info| {
            const B = byteInt(T);
            const U = @Int(.unsigned, info.bits);
            const wide: B = @as(U, @bitCast(v.*));
            var bytes: [@sizeOf(B)]u8 = undefined;
            std.mem.writeInt(B, &bytes, wide, .little);
            w.write(bytes[0..(@typeInfo(B).int.bits / 8)]);
        },
        .bool => w.write(&[_]u8{@intFromBool(v.*)}),
        .@"enum" => |info| {
            const tag: info.tag_type = @intFromEnum(v.*);
            serialize(info.tag_type, &tag, w);
        },
        .array => |info| for (v) |*e| serialize(info.child, e, w),
        .@"struct" => |info| inline for (info.field_names, info.field_types) |name, ft| serialize(ft, &@field(v.*, name), w),
        else => @compileError("cannot serialise " ++ @typeName(T)),
    }
}

fn deserialize(comptime T: type, v: *T, r: *BufReader) error{BadSnapshot}!void {
    switch (@typeInfo(T)) {
        .int => |info| {
            const B = byteInt(T);
            const n = @typeInfo(B).int.bits / 8;
            const bytes = try r.read(n);
            const wide = std.mem.readInt(B, bytes[0..n], .little);
            const U = @Int(.unsigned, info.bits);
            if (wide > std.math.maxInt(U)) return error.BadSnapshot;
            v.* = @bitCast(@as(U, @intCast(wide)));
        },
        .bool => {
            const b = (try r.read(1))[0];
            if (b > 1) return error.BadSnapshot;
            v.* = b == 1;
        },
        .@"enum" => |info| {
            var tag: info.tag_type = undefined;
            try deserialize(info.tag_type, &tag, r);
            v.* = std.enums.fromInt(T, tag) orelse return error.BadSnapshot;
        },
        .array => |info| for (v) |*e| try deserialize(info.child, e, r),
        .@"struct" => |info| inline for (info.field_names, info.field_types) |name, ft| try deserialize(ft, &@field(v.*, name), r),
        else => @compileError("cannot deserialise " ++ @typeName(T)),
    }
}

pub fn tileId(t: TileIndex) []const u8 {
    return tiles.all[t].id;
}

test {
    _ = tiles;
    _ = @import("rng.zig");
    _ = @import("json.zig");
    _ = @import("fixture.zig");
    _ = @import("rules_test.zig");
    _ = @import("soak_test.zig");
}
