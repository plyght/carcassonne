// Post-FX chain per (style, tier, camera): toon inverted-hull outlines, GTAO,
// tilt-shift depth of field, saturation and vignette. Returns null when the
// chain would be a no-op (render straight to the canvas: cheapest path).
import * as THREE from "three/webgpu";
import { float, mix, mrt, normalView, output, pass, saturation, screenUV, smoothstep, toonOutlinePass, uniform, vec4, abs, length } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { effectOn, type StylePack, type Tier } from "./styles";

type AnyNode = any;

export interface PostChain {
  pipeline: THREE.RenderPipeline;
  /** Tilt-shift focus band centre (0 = top of screen, 1 = bottom), live-tweakable. */
  focus: { value: number } | null;
  dispose(): void;
}

export function buildPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, style: StylePack, tier: Tier): PostChain | null {
  const outline = style.shading === "toon" ? style.materials.outline : null;
  const useAO = effectOn(style.post.ssao, tier) && !outline;
  // tilt-shift only makes sense on a tilted view (not the top-down map)
  const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
  const tilt = effectOn(style.post.tiltShift, tier) && !ortho ? style.post.tiltShift : null;
  const sat = style.post.saturation;
  const vig = style.post.vignette;
  const grade = tier !== "low" && (Math.abs(sat - 1) > 0.01 || vig > 0.001);
  if (!outline && !useAO && !tilt && !grade) return null;

  const pipeline = new THREE.RenderPipeline(renderer);
  let colorNode: AnyNode;
  const nodes: { dispose?: () => void }[] = [];
  if (outline) {
    const p = toonOutlinePass(scene, camera, new THREE.Color(outline.color), outline.thickness, 1) as AnyNode;
    colorNode = p;
    nodes.push(p);
  } else {
    const p = pass(scene, camera) as AnyNode;
    nodes.push(p);
    if (useAO) {
      p.setMRT(mrt({ output, normal: normalView }));
      const sceneColor = p.getTextureNode("output");
      const aoNode = ao(p.getTextureNode("depth"), p.getTextureNode("normal"), camera) as AnyNode;
      aoNode.resolutionScale = 0.5;
      aoNode.radius.value = style.post.ssao!.radius;
      aoNode.samples.value = 12;
      nodes.push(aoNode);
      const occl = (aoNode.getTextureNode() as AnyNode).sample(screenUV).r;
      colorNode = vec4(sceneColor.rgb.mul(mix(float(1), occl, style.post.ssao!.intensity)), sceneColor.a);
    } else {
      colorNode = p;
    }
  }
  let focus: { value: number } | null = null;
  if (tilt) {
    const uFocus = uniform(tilt.focus);
    focus = uFocus as unknown as { value: number };
    const blurred = gaussianBlur(colorNode, null, tilt.blur) as AnyNode;
    nodes.push(blurred);
    const d: AnyNode = abs((screenUV as AnyNode).y.sub(uFocus));
    const k: AnyNode = smoothstep(tilt.range * 0.5, tilt.range * 0.5 + 0.28, d);
    colorNode = mix(colorNode, blurred, k);
  }
  if (grade) {
    let c: AnyNode = colorNode;
    if (Math.abs(sat - 1) > 0.01) c = vec4(saturation(c.rgb, sat), c.a);
    if (vig > 0.001) {
      const r: AnyNode = length((screenUV as AnyNode).sub(0.5));
      c = vec4(c.rgb.mul(float(1).sub(smoothstep(0.35, 0.85, r).mul(vig))), c.a);
    }
    colorNode = c;
  }
  pipeline.outputNode = colorNode;
  return {
    pipeline,
    focus,
    dispose() {
      for (const n of nodes) n.dispose?.();
      pipeline.dispose();
    },
  };
}
