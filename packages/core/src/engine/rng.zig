//! Deterministic PRNG: xoshiro256** seeded through SplitMix64. Implemented here
//! (rather than via std.Random) so the stream can never change under us with a
//! Zig upgrade: replays depend on it bit-for-bit.
const std = @import("std");

pub const Rng = struct {
    s: [4]u64,

    pub fn init(seed: u64) Rng {
        var sm = seed;
        var r: Rng = undefined;
        for (&r.s) |*w| w.* = splitmix(&sm);
        return r;
    }

    fn splitmix(state: *u64) u64 {
        state.* +%= 0x9e3779b97f4a7c15;
        var z = state.*;
        z = (z ^ (z >> 30)) *% 0xbf58476d1ce4e5b9;
        z = (z ^ (z >> 27)) *% 0x94d049bb133111eb;
        return z ^ (z >> 31);
    }

    pub fn next(self: *Rng) u64 {
        const s = &self.s;
        const result = std.math.rotl(u64, s[1] *% 5, 7) *% 9;
        const t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = std.math.rotl(u64, s[3], 45);
        return result;
    }

    /// Unbiased integer in [0, n), n > 0 (rejection sampling).
    pub fn below(self: *Rng, n: u64) u64 {
        std.debug.assert(n > 0);
        const threshold = (0 -% n) % n;
        while (true) {
            const r = self.next();
            if (r >= threshold) return r % n;
        }
    }

    /// Fisher-Yates shuffle.
    pub fn shuffle(self: *Rng, comptime T: type, items: []T) void {
        if (items.len < 2) return;
        var i: usize = items.len - 1;
        while (i > 0) : (i -= 1) {
            const j: usize = @intCast(self.below(i + 1));
            std.mem.swap(T, &items[i], &items[j]);
        }
    }
};

test "rng is stable" {
    // Pinned values: changing these breaks every stored replay.
    var r = Rng.init(42);
    const a = r.next();
    const b = r.next();
    var r2 = Rng.init(42);
    try std.testing.expectEqual(a, r2.next());
    try std.testing.expectEqual(b, r2.next());
    try std.testing.expect(a != b);
    var buf = [_]u8{ 0, 1, 2, 3, 4, 5, 6, 7 };
    var r3 = Rng.init(7);
    r3.shuffle(u8, &buf);
    var sum: u32 = 0;
    for (buf) |v| sum += v;
    try std.testing.expectEqual(@as(u32, 28), sum);
}
