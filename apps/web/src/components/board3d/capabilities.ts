// Cheap, three-free device probes for the 3D board: is WebGL2 there at all (otherwise we
// fall back to Classic), and which performance tier to start on.

export type Tier3D = "low" | "medium" | "high";

export interface GpuProbe {
  webgl2: boolean;
  /** Unmasked GPU renderer string when the browser exposes it. */
  gpu: string | null;
  webgpu: boolean;
  mobile: boolean;
}

let cached: GpuProbe | null = null;

export function probeGpu(): GpuProbe {
  if (cached) return cached;
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const mobile =
    !!nav &&
    (/Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent) ||
      // iPadOS reports a desktop UA
      (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1));
  let webgl2 = false;
  let gpu: string | null = null;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (gl) {
      webgl2 = true;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "") || null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    webgl2 = false;
  }
  cached = { webgl2, gpu, webgpu: !!nav && "gpu" in nav, mobile };
  return cached;
}

/** Software rasterisers and integrated / mobile GPUs. */
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|intel|mali|adreno|powervr|videocore|apple gpu/i;

/**
 * Auto tier: low on phones, small CPUs, software and integrated GPUs; high on a
 * discrete GPU with WebGPU; medium otherwise.
 */
export function detectTier(p: GpuProbe = probeGpu()): Tier3D {
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 8) : 8;
  if (p.mobile || cores <= 4) return "low";
  if (p.gpu && WEAK_GPU.test(p.gpu)) return "low";
  return p.webgpu ? "high" : "medium";
}
