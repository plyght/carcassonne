//! Fixture builder for hand-placed boards in tests (and AI experiments).
//!
//!     var fx = Fixture.init(.{ .river = false }, 2);
//!     fx.put("D", 0, 0, 0);
//!     fx.meeple(0, 0, 0, 1);            // player 0 on feature 1 of the tile at (0,0)
//!     fx.deck(&.{ "U", "V" });           // draw pile, first entry is drawn now
//!     try fx.game.apply(.{ .x = 1, .y = 0, .rot = 1 }, null);
const std = @import("std");
const engine = @import("engine.zig");
const tiles = @import("tiles.zig");

const Game = engine.Game;

pub const Fixture = struct {
    game: Game,

    /// Empty board, empty draw pile, player 0 to move.
    pub fn init(ruleset: engine.Ruleset, players: u8) Fixture {
        return .{ .game = .{ .ruleset = ruleset, .seed = 0, .num_players = players } };
    }

    pub fn tileIndex(id: []const u8) tiles.TileIndex {
        return tiles.indexOf(id) orelse std.debug.panic("unknown tile id {s}", .{id});
    }

    /// Place a tile without turn bookkeeping. Asserts that edges match every
    /// existing neighbour (tiles may be disconnected, to build boards quickly).
    pub fn put(self: *Fixture, id: []const u8, x: i16, y: i16, rot: u2) void {
        const t = tileIndex(id);
        if (self.game.slotAt(x, y) != null) std.debug.panic("fixture: ({d},{d}) occupied", .{ x, y });
        const r = &tiles.rotated[t][rot];
        const dx = [4]i16{ 0, 1, 0, -1 };
        const dy = [4]i16{ -1, 0, 1, 0 };
        for (0..4) |s| {
            const ns = self.game.slotAt(x + dx[s], y + dy[s]) orelse continue;
            const p = self.game.placed[ns];
            if (tiles.rotated[p.tile][p.rot].edges[(s + 2) % 4] != r.edges[s])
                std.debug.panic("fixture: {s} rot {d} does not fit at ({d},{d})", .{ id, rot, x, y });
        }
        self.game.putTile(t, x, y, rot);
    }

    /// Place the river spring at (0,0) flowing south, as at the start of a River game.
    pub fn riverStart(self: *Fixture) void {
        self.game.putTile(tileIndex("R1"), 0, 0, 0);
        self.game.river = .{ .open = true, .x = 0, .y = 1, .heading = 2, .spring_dir = 2, .last_turn = 0 };
    }

    pub fn currentPlayer(self: *Fixture, p: u8) void {
        self.game.current_player = p;
    }

    fn setFigure(self: *Fixture, player: u8, idx: usize, x: i16, y: i16, feature: u8) void {
        const slot = self.game.slotAt(x, y) orelse std.debug.panic("fixture: no tile at ({d},{d})", .{ x, y });
        self.game.figures[player][idx] = .{ .on_board = true, .slot = slot, .feature = feature };
    }

    /// Stand one of `player`'s meeples on `feature` of the tile at (x, y).
    pub fn meeple(self: *Fixture, player: u8, x: i16, y: i16, feature: u8) void {
        for (self.game.figures[player][0..engine.MEEPLES_PER_PLAYER], 0..) |fs, i| {
            if (!fs.on_board) return self.setFigure(player, i, x, y, feature);
        }
        std.debug.panic("fixture: player {d} has no meeples left", .{player});
    }

    pub fn abbot(self: *Fixture, player: u8, x: i16, y: i16, feature: u8) void {
        self.setFigure(player, engine.ABBOT_SLOT, x, y, feature);
    }

    /// Set the draw pile and draw the first tile for the current player.
    pub fn deck(self: *Fixture, ids: []const []const u8) void {
        for (ids, 0..) |id, i| self.game.deck[i] = tileIndex(id);
        self.game.deck_len = @intCast(ids.len);
        self.game.deck_pos = 0;
        self.game.drawForTurn(null) catch unreachable;
    }

    /// Same as `deck`, collecting setup events (e.g. discards) into `events`.
    pub fn deckEvents(self: *Fixture, ids: []const []const u8, events: *engine.Events) !void {
        for (ids, 0..) |id, i| self.game.deck[i] = tileIndex(id);
        self.game.deck_len = @intCast(ids.len);
        self.game.deck_pos = 0;
        try self.game.drawForTurn(events);
    }

    pub fn currentId(self: *const Fixture) ?[]const u8 {
        const t = self.game.currentTile() orelse return null;
        return tiles.all[t].id;
    }
};
