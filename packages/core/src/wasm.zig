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
