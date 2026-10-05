//! Carcassonne core: rules engine, AI, procedural geometry, animation timeline.
//! Shared by web (WASM), server (WASM on Vercel) and desktop (native, via zpui).
//! See docs/CONTRACT.md for the cross-language contract.

pub const tile = @import("engine/tile.zig");
pub const engine = @import("engine/engine.zig");
pub const ai = @import("ai/ai.zig");
pub const geo = @import("geo/geo.zig");
pub const anim = @import("anim/anim.zig");

test {
    @import("std").testing.refAllDecls(@This());
}
