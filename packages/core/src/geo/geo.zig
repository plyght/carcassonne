//! Procedural tile geometry (style-agnostic). See README.md in this folder
//! for the binary buffer format exported over WASM.

pub const vec = @import("vec.zig");
pub const layout = @import("layout.zig");
pub const mesh = @import("mesh.zig");
pub const figure = @import("figure.zig");
pub const props = @import("props.zig");
pub const buffer = @import("buffer.zig");
pub const fixtures = @import("fixtures.zig");
pub const registry = @import("registry.zig");

pub const Layout = layout.Layout;
pub const buildLayout = layout.build;

test {
    _ = vec;
    _ = layout;
    _ = mesh;
    _ = figure;
    _ = props;
    _ = buffer;
    _ = registry;
    _ = @import("tests.zig");
}
