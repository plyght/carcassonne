const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Native module, imported by apps/desktop.
    const core = b.addModule("core", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    const test_filters = b.option([]const []const u8, "test-filter", "Only run tests whose names contain this") orelse &.{};
    const tests = b.addTest(.{ .root_module = core, .filters = test_filters });
    const test_step = b.step("test", "Run core unit tests");
    test_step.dependOn(&b.addRunArtifact(tests).step);

    // AI tournament harness: zig build ai-bench -- medium easy --seeds 200
    const bench = b.addExecutable(.{
        .name = "ai-bench",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/ai/bench.zig"),
            .target = target,
            .optimize = if (optimize == .debug) .ReleaseFast else optimize,
            .imports = &.{.{ .name = "core", .module = b.createModule(.{
                .root_source_file = b.path("src/root.zig"),
                .target = target,
                .optimize = if (optimize == .debug) .ReleaseFast else optimize,
            }) }},
        }),
    });
    const run_bench = b.addRunArtifact(bench);
    run_bench.addPassthruArgs();
    b.step("ai-bench", "Run the AI tournament (args after --)").dependOn(&run_bench.step);
    b.step("ai-bench-install", "Install the ai-bench binary to zig-out/bin").dependOn(&b.addInstallArtifact(bench, .{}).step);

    // WASM build for web + server: zig build wasm -> zig-out/bin/core.wasm
    const wasm = b.addExecutable(.{
        .name = "core",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/wasm.zig"),
            .target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding }),
            .optimize = if (optimize == .debug) .small else optimize,
        }),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    const install_wasm = b.addInstallArtifact(wasm, .{});
    b.step("wasm", "Build core.wasm").dependOn(&install_wasm.step);
}
