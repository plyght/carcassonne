// Style materials (TSL node materials, so they run on WebGPU and the WebGL2
// backend alike). One `MaterialSet` per style pack: terrain, masonry, water,
// props (palette lookup by part + per-instance tint), figures, table and
// overlays. Shading models: pbr (MeshStandard), toon (ramp; outlines are added
// by the post chain's inverted-hull pass), flat (unlit).
import * as THREE from "three/webgpu";
import {
  attribute,
  float,
  max,
  min,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { PART, PART_COUNT, TINT_COUNT } from "./props";
import type { ShadingModel, StylePack } from "./styles";

type AnyNode = any; // TSL node graphs are loosely typed in @types/three

export interface MaterialSet {
  style: StylePack;
  ground: THREE.Material;
  wall: THREE.Material;
  water: THREE.Material;
  props: THREE.Material;
  figure: THREE.Material;
  table: THREE.Material;
  highlight: THREE.MeshBasicNodeMaterial;
  legal: THREE.MeshBasicNodeMaterial;
  ghost: { ground: THREE.Material; wall: THREE.Material; water: THREE.Material; props: THREE.Material };
  palette: THREE.DataTexture;
  dispose(): void;
}

function col(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function toonRamp(steps: number): THREE.DataTexture {
  const n = Math.max(2, Math.round(steps));
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(255 * (0.35 + (0.65 * i) / (n - 1)));
    data.set([v, v, v, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function makeMaterial(shading: ShadingModel, style: StylePack, ramp: THREE.DataTexture | null, rough = style.materials.roughness): THREE.MeshStandardNodeMaterial | THREE.MeshToonNodeMaterial | THREE.MeshBasicNodeMaterial {
  if (shading === "toon") {
    const m = new THREE.MeshToonNodeMaterial();
    m.gradientMap = ramp;
    return m;
  }
  if (shading === "flat") return new THREE.MeshBasicNodeMaterial();
  const m = new THREE.MeshStandardNodeMaterial();
  m.roughness = rough;
  m.metalness = style.materials.metalness;
  return m;
}

/** Palette texture: columns = part slots, rows = tint. Linear colours. */
export function paletteData(style: StylePack): Uint8Array {
  const p = style.palette;
  const data = new Uint8Array(PART_COUNT * TINT_COUNT * 4);
  const pick = (list: string[], i: number) => list[i % list.length]!;
  for (let t = 0; t < TINT_COUNT; t++) {
    const slots: Record<number, string> = {
      [PART.plaster]: pick(p.plaster, t),
      [PART.roof]: pick(p.roofs, t),
      [PART.stone]: p.stone,
      [PART.stoneDark]: p.stoneDark,
      [PART.foliage]: pick(p.foliage, t),
      [PART.trunk]: p.trunk,
      [PART.wood]: p.wood,
      [PART.dark]: p.dark,
      [PART.sheep]: p.sheep,
      [PART.cow]: p.cow,
      [PART.crop]: p.crop,
      [PART.water]: p.water,
      [PART.grass]: p.grass,
    };
    for (let s = 0; s < PART_COUNT; s++) {
      const c = col(slots[s] ?? "#ff00ff");
      // stored as sRGB bytes; the texture is tagged SRGBColorSpace
      const srgb = c.clone().convertLinearToSRGB();
      data.set([Math.round(srgb.r * 255), Math.round(srgb.g * 255), Math.round(srgb.b * 255), 255], (t * PART_COUNT + s) * 4);
    }
  }
  return data;
}

export function createMaterials(style: StylePack): MaterialSet {
  const P = style.palette;
  const T = style.terrain;
  const ramp = style.shading === "toon" ? toonRamp(style.materials.toonSteps) : null;

  // --- ground: terrain + slab sides ---------------------------------------
  const uGrass = uniform(col(P.grass));
  const uGrassAlt = uniform(col(P.grassAlt));
  const uRoad = uniform(col(P.road));
  const uCity = uniform(col(P.city));
  const uBed = uniform(col(P.riverBed));
  const uSlab = uniform(col(P.slab));
  const uSeam = uniform(col(P.seam));
  const kindW: AnyNode = attribute("aKind", "vec4");
  const matA: AnyNode = attribute("aMat", "vec2");
  const wp: AnyNode = positionWorld;
  const blot: AnyNode = mx_noise_float(wp.xz.mul(T.noiseScale)).mul(0.5).add(0.5);
  const blot2: AnyNode = mx_noise_float(wp.xz.mul(T.noiseScale * 3.1).add(vec2(7.3, 1.1))).mul(0.5).add(0.5);
  const grainN: AnyNode = mx_noise_float(wp.xz.mul(140)).mul(T.grain);
  const grass: AnyNode = mix(uGrass, uGrassAlt, smoothstep(0.25, 0.85, blot.mul(0.65).add(blot2.mul(0.35))).mul(T.grassNoise * 1.6).min(1)).mul(grainN.add(1));
  const dirt: AnyNode = mx_noise_float(wp.xz.mul(22)).mul(0.06).add(1);
  const wsum: AnyNode = max(kindW.x.add(kindW.y).add(kindW.z).add(kindW.w), float(0.0001));
  const terr: AnyNode = grass
    .mul(kindW.x)
    .add(uRoad.mul(dirt).mul(kindW.y))
    .add(uCity.mul(dirt).mul(kindW.z))
    .add(uBed.mul(kindW.w))
    .div(wsum);
  const tuv: AnyNode = uv();
  const edge: AnyNode = min(min(tuv.x, tuv.y.oneMinus()), min(tuv.x.oneMinus(), tuv.y));
  const seamK: AnyNode = smoothstep(0, max(float(T.seamWidth), float(0.0001)), edge).oneMinus().mul(T.seamDarken);
  const ao: AnyNode = mix(float(1), matA.x, T.ao);
  const terrCol: AnyNode = mix(terr.mul(ao), uSeam, seamK);
  // slab sides: lighter at the top edge, a touch darker at the bottom (uv.y = depth)
  const slabCol: AnyNode = uSlab.mul(float(1).sub(tuv.y.mul(1.2).min(0.18)));
  const groundColor: AnyNode = mix(terrCol, slabCol, matA.y);

  const ground = makeMaterial(style.shading, style, ramp);
  ground.colorNode = groundColor;
  ground.name = "ground";

  // --- masonry ------------------------------------------------------------
  const uStone = uniform(col(P.stone));
  const uStoneDark = uniform(col(P.stoneDark));
  const sn: AnyNode = mx_noise_float(wp.mul(vec3(90, 140, 90))).mul(0.5).add(0.5);
  const sn2: AnyNode = mx_noise_float(wp.mul(18)).mul(0.5).add(0.5);
  const stone: AnyNode = mix(uStone, uStoneDark, sn.mul(style.materials.stoneNoise).add(sn2.mul(style.materials.stoneNoise * 0.8)));
  // darker at the foot of the wall (wall uv.y is height above its base)
  const foot: AnyNode = mix(float(0.7), float(1), smoothstep(0, 0.035, wp.y.sub(0.0)));
  const wall = makeMaterial(style.shading, style, ramp);
  wall.colorNode = stone.mul(foot);
  wall.name = "wall";

  // --- water --------------------------------------------------------------
  const uWater = uniform(col(P.water));
  const ripple: AnyNode = mx_noise_float(vec3(wp.x.mul(18), wp.z.mul(18), time.mul(0.6))).mul(0.08).add(1);
  const water = makeMaterial(style.shading, style, ramp, 0.2);
  water.colorNode = uWater.mul(ripple);
  water.name = "water";

  // --- props --------------------------------------------------------------
  const palette = new THREE.DataTexture(paletteData(style), PART_COUNT, TINT_COUNT, THREE.RGBAFormat);
  palette.colorSpace = THREE.SRGBColorSpace;
  palette.minFilter = THREE.NearestFilter;
  palette.magFilter = THREE.NearestFilter;
  palette.generateMipmaps = false;
  palette.needsUpdate = true;
  const part: AnyNode = attribute("aPart", "float");
  const tint: AnyNode = attribute("aTint", "float");
  const shade: AnyNode = attribute("aShade", "float");
  const palUV: AnyNode = vec2(part.add(0.5).div(PART_COUNT), tint.add(0.5).div(TINT_COUNT));
  const base: AnyNode = (texture(palette, palUV) as AnyNode).rgb;
  const isStone: AnyNode = smoothstep(1.5, 2.0, part).mul(smoothstep(3.5, 3.0, part));
  const propNoise: AnyNode = mix(float(1), sn.mul(0.35).add(0.75), isStone.mul(style.materials.stoneNoise * 2.5).min(1));
  const props = makeMaterial(style.shading, style, ramp);
  props.colorNode = base.mul(propNoise).mul(mix(float(1), shade, 0.8));
  props.name = "props";

  // --- figures (instanceColor carries the player colour) --------------------
  const figure = makeMaterial(style.shading, style, ramp, style.materials.figureRoughness);
  const grain: AnyNode = mx_noise_float(vec3(wp.x.mul(30), wp.y.mul(260), wp.z.mul(30))).mul(style.shading === "pbr" ? 0.06 : 0.0).add(1);
  figure.colorNode = vec3(1, 1, 1).mul(grain);
  figure.name = "figure";

  // --- table --------------------------------------------------------------
  const table = makeMaterial(style.shading === "toon" ? "toon" : "pbr", style, ramp, 0.95);
  const tn: AnyNode = mx_noise_float(wp.xz.mul(1.3)).mul(0.015).add(1);
  table.colorNode = uniform(col(P.table)).mul(tn);
  table.name = "table";

  // --- overlays -----------------------------------------------------------
  const highlight = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  highlight.color = new THREE.Color("#fff6c8");
  highlight.opacity = 0.45;
  highlight.polygonOffset = true;
  highlight.polygonOffsetFactor = -4;
  highlight.polygonOffsetUnits = -4;
  highlight.name = "highlight";

  const legal = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  legal.color = new THREE.Color("#fff4d6");
  const luv: AnyNode = uv();
  const ld: AnyNode = min(min(luv.x, luv.y), min(luv.x.oneMinus(), luv.y.oneMinus()));
  // bright rim, faint fill
  legal.opacityNode = smoothstep(0.0, 0.07, ld).oneMinus().mul(0.75).add(0.18);
  legal.name = "legal";

  const ghostOf = (m: THREE.Material): THREE.Material => {
    const g = m.clone();
    g.transparent = true;
    g.opacity = 0.62;
    g.depthWrite = true;
    return g;
  };
  const ghost = { ground: ghostOf(ground), wall: ghostOf(wall), water: ghostOf(water), props: ghostOf(props) };

  const all = [ground, wall, water, props, figure, table, highlight, legal, ...Object.values(ghost)];
  return {
    style,
    ground,
    wall,
    water,
    props,
    figure,
    table,
    highlight,
    legal,
    ghost,
    palette,
    dispose() {
      for (const m of all) m.dispose();
      palette.dispose();
      ramp?.dispose();
    },
  };
}
