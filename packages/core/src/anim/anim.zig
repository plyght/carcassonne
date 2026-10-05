const std = @import("std");
pub fn timelineJson(a: std.mem.Allocator, events: []const u8, opts: []const u8) ![]u8 {
    _ = events;
    _ = opts;
    return a.dupe(u8, "{}");
}
