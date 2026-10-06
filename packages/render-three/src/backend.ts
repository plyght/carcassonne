// WebGPU renderer with a WebGL2 fallback. three's WebGPURenderer already
// falls back when `navigator.gpu` is missing; we also probe one frame, since
// some browsers expose an adapter whose implementation lags the spec (e.g.
// texture-view swizzle), and retry on the WebGL2 backend if it throws.
import * as THREE from "three/webgpu";

export type BackendPreference = "auto" | "webgpu" | "webgl";
export type BackendKind = "webgpu" | "webgl";

export interface CreatedRenderer {
  renderer: THREE.WebGPURenderer;
  backend: BackendKind;
  /** The canvas in use: a fresh clone replaces the original after a failed WebGPU attempt (a canvas keeps its first context type). */
  canvas: HTMLCanvasElement;
}

function freshCanvas(old: HTMLCanvasElement): HTMLCanvasElement {
  const c = old.cloneNode(false) as HTMLCanvasElement;
  old.replaceWith(c);
  return c;
}

function kindOf(r: THREE.WebGPURenderer): BackendKind {
  return (r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl";
}

async function make(canvas: HTMLCanvasElement, forceWebGL: boolean, antialias: boolean): Promise<THREE.WebGPURenderer> {
  const r = new THREE.WebGPURenderer({ canvas, antialias, forceWebGL, alpha: false, powerPreference: "high-performance" });
  await r.init();
  return r;
}

function probe(r: THREE.WebGPURenderer): void {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
  r.render(scene, cam);
}

export async function createRenderer(canvas: HTMLCanvasElement, pref: BackendPreference = "auto", antialias = true): Promise<CreatedRenderer> {
  if (pref !== "webgl") {
    try {
      const r = await make(canvas, false, antialias);
      try {
        probe(r);
        return { renderer: r, backend: kindOf(r), canvas };
      } catch (e) {
        if (pref === "webgpu") throw e;
        console.warn("[render-three] WebGPU probe failed, falling back to WebGL2:", e);
        r.dispose();
      }
    } catch (e) {
      if (pref === "webgpu") throw e;
      console.warn("[render-three] WebGPU init failed, falling back to WebGL2:", e);
    }
    canvas = canvas.parentNode ? freshCanvas(canvas) : document.createElement("canvas");
  }
  const r = await make(canvas, true, antialias);
  return { renderer: r, backend: kindOf(r), canvas };
}
