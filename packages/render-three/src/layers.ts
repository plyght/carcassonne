// Instanced layers: props (one InstancedMesh per prop kind + variant) and
// figures (one per shape + pose). Tiles own slots; animated tiles rewrite
// only their own instance matrices each frame.
import * as THREE from "three/webgpu";
import type { FigurePose, FigureShape, GeoFigure, PropKind } from "@carcassonne/core-geo";
import { PropKit, WALL_PROPS } from "./props";
import type { PlacedProp } from "./tile-cache";

export interface PropOwner {
  /** Tile transform (world <- tile-local). */
  matrix: THREE.Matrix4;
  props: PlacedProp[];
  /** 0..1(+) life-layer rise (houses, trees, animals). */
  rise: number;
  /** 0..1(+) wall rise (towers, gatehouses, stairs). */
  wallRise: number;
  visible: boolean;
  /** Assigned slots: [meshKey, index] per prop (same order as `props`). */
  slots: [string, number][];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class PropLayer {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private material: THREE.Material;
  houseHeight = 1;
  propScale = 1;
  castShadow = true;

  constructor(
    private kit: PropKit,
    material: THREE.Material,
  ) {
    this.material = material;
    this.root.name = "props";
  }

  get drawCalls(): number {
    let n = 0;
    for (const m of this.meshes.values()) if (m.count > 0) n++;
    return n;
  }

  setMaterial(m: THREE.Material): void {
    this.material = m;
    for (const mesh of this.meshes.values()) mesh.material = m;
  }

  setKit(kit: PropKit): void {
    this.kit = kit;
    for (const mesh of this.meshes.values()) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.meshes.clear();
  }

  private meshFor(prop: PropKind, variant: number, need: number): THREE.InstancedMesh {
    const v = this.kit.variantOf(prop, variant);
    const key = `${prop}:${v}`;
    let mesh = this.meshes.get(key);
    if (mesh && mesh.instanceMatrix.count >= need) return mesh;
    const cap = Math.max(16, 1 << Math.ceil(Math.log2(need * 1.5)));
    const base = this.kit.geometry(prop, v);
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
    g.boundingSphere = null;
    g.setAttribute("aTint", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    const next = new THREE.InstancedMesh(g, this.material, cap);
    next.name = key;
    next.count = 0;
    next.castShadow = this.castShadow;
    next.receiveShadow = true;
    next.frustumCulled = false;
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (mesh) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.meshes.set(key, next);
    this.root.add(next);
    return next;
  }

  /** Reassigns every slot (tiles added/removed or kit changed). */
  rebuild(owners: Iterable<PropOwner>): void {
    const list = [...owners];
    const counts = new Map<string, number>();
    for (const o of list)
      for (const p of o.props) {
        const k = `${p.prop}:${this.kit.variantOf(p.prop, p.variant)}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    for (const [k, n] of counts) {
      const [prop, v] = k.split(":") as [PropKind, string];
      this.meshFor(prop, Number(v), n);
    }
    for (const m of this.meshes.values()) m.count = 0;
    for (const o of list) {
      o.slots = o.props.map((p) => {
        const mesh = this.meshFor(p.prop, p.variant, 0);
        const i = mesh.count++;
        (mesh.geometry.getAttribute("aTint") as THREE.InstancedBufferAttribute).setX(i, p.tint % 4);
        return [mesh.name, i] as [string, number];
      });
      this.write(o);
    }
    for (const m of this.meshes.values()) {
      m.instanceMatrix.needsUpdate = true;
      m.geometry.getAttribute("aTint").needsUpdate = true;
    }
  }

  /** Writes an owner's instance matrices (call after animating it). */
  write(o: PropOwner): void {
    o.props.forEach((p, i) => {
      const slot = o.slots[i];
      if (!slot) return;
      const mesh = this.meshes.get(slot[0]);
      if (!mesh) return;
      const k = WALL_PROPS.has(p.prop) ? o.wallRise : o.rise;
      if (!o.visible || k <= 0.001) {
        mesh.setMatrixAt(slot[1], ZERO);
      } else {
        const house = p.prop === "house" ? this.houseHeight : 1;
        const sc = p.scale * this.propScale;
        const xz = Math.min(1.15, 0.55 + 0.45 * k);
        _s.set(sc * xz, sc * p.height * house * k, sc * xz);
        _q.setFromAxisAngle(_y, p.yaw);
        _p.set(p.x, p.y, p.z);
        _m.compose(_p, _q, _s).premultiply(o.matrix);
        mesh.setMatrixAt(slot[1], _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      m.dispose();
    }
    this.meshes.clear();
  }
}

export interface FigureInstance {
  key: string;
  shape: FigureShape;
  pose: FigurePose;
  color: THREE.Color;
  matrix: THREE.Matrix4;
  visible: boolean;
}

export class FigureLayer {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private geoms = new Map<string, THREE.BufferGeometry>();
  private material: THREE.Material;

  constructor(
    private figure: (shape: FigureShape, pose: FigurePose) => GeoFigure,
    material: THREE.Material,
  ) {
    this.material = material;
    this.root.name = "figures";
  }

  get drawCalls(): number {
    let n = 0;
    for (const m of this.meshes.values()) if (m.count > 0) n++;
    return n;
  }

  setMaterial(m: THREE.Material): void {
    this.material = m;
    for (const mesh of this.meshes.values()) mesh.material = m;
  }

  private geometry(shape: FigureShape, pose: FigurePose): THREE.BufferGeometry {
    const k = `${shape}|${pose}`;
    let g = this.geoms.get(k);
    if (!g) {
      const f = this.figure(shape, pose);
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(f.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(f.normals, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(f.uvs, 2));
      g.setIndex(new THREE.BufferAttribute(f.indices, 1));
      g.computeBoundingSphere();
      this.geoms.set(k, g);
    }
    return g;
  }

  update(figs: FigureInstance[]): void {
    const groups = new Map<string, FigureInstance[]>();
    for (const f of figs) {
      if (!f.visible) continue;
      const k = `${f.shape}|${f.pose}`;
      let l = groups.get(k);
      if (!l) groups.set(k, (l = []));
      l.push(f);
    }
    for (const m of this.meshes.values()) m.count = 0;
    for (const [k, list] of groups) {
      let mesh = this.meshes.get(k);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        const [shape, pose] = k.split("|") as [FigureShape, FigurePose];
        const cap = Math.max(32, list.length * 2);
        const next = new THREE.InstancedMesh(this.geometry(shape, pose), this.material, cap);
        next.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        next.castShadow = true;
        next.receiveShadow = true;
        next.frustumCulled = false;
        next.name = k;
        if (mesh) {
          this.root.remove(mesh);
          mesh.dispose();
        }
        this.meshes.set(k, next);
        this.root.add(next);
        mesh = next;
      }
      list.forEach((f, i) => {
        mesh.setMatrixAt(i, f.matrix);
        mesh.setColorAt(i, f.color);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
    for (const g of this.geoms.values()) g.dispose();
    this.meshes.clear();
    this.geoms.clear();
  }
}
