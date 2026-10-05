// Feature-graph analysis over a public board (GameView.board). Used by the UI for
// hover extents / projected scores and by the dev reference engine for scoring.
// Pure functions: no engine state beyond what the public view exposes.

import type {
  BoardTile,
  FeatureKind,
  FigureKind,
  FigureOption,
  Placement,
  PlayerIndex,
  PlayerView,
  Ruleset,
} from "@carcassonne/protocol";

import {
  edgeKind,
  featureAtPort,
  opposingPort,
  SIDE_DELTA,
  type TileCatalog,
  type TileDef,
} from "./tiles";

export const cellKey = (x: number, y: number) => `${x},${y}`;

export type Board = Map<string, BoardTile>;

export function boardFromTiles(tiles: BoardTile[]): Board {
  return new Map(tiles.map((t) => [cellKey(t.x, t.y), t]));
}

export interface NodeRef {
  x: number;
  y: number;
  feature: number;
}

export interface FigureOnBoard {
  player: PlayerIndex;
  x: number;
  y: number;
  feature: number;
  figure: FigureKind;
}

export interface FeatureExtent {
  id: number;
  kind: FeatureKind;
  nodes: NodeRef[];
  /** Distinct board cells covered. */
  cells: [number, number][];
  pennants: number;
  /** Number of edge ports not yet matched by a neighbour (roads/cities/fields). */
  openPorts: number;
  complete: boolean;
  figures: FigureOnBoard[];
  /** City extents adjacent to this field (field only). */
  adjacentCities: number[];
}

export interface BoardAnalysis {
  extents: FeatureExtent[];
  extentOf(x: number, y: number, feature: number): FeatureExtent | undefined;
}

class UnionFind {
  parent: number[] = [];
  add(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(a: number): number {
    let r = a;
    while (this.parent[r] !== r) r = this.parent[r]!;
    while (this.parent[a] !== r) {
      const n = this.parent[a]!;
      this.parent[a] = r;
      a = n;
    }
    return r;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export function neighbourCount(board: Board, x: number, y: number): number {
  let n = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && board.has(cellKey(x + dx, y + dy))) n++;
  return n;
}

export function analyzeBoard(board: Board, catalog: TileCatalog): BoardAnalysis {
  const uf = new UnionFind();
  const nodeIds = new Map<string, number>();
  const nodes: (NodeRef & { def: TileDef; tile: BoardTile })[] = [];
  const nkey = (x: number, y: number, f: number) => `${x},${y},${f}`;

  for (const tile of board.values()) {
    const def = catalog.get(tile.tile);
    if (!def) continue;
    def.features.forEach((_, f) => {
      nodeIds.set(nkey(tile.x, tile.y, f), uf.add());
      nodes.push({ x: tile.x, y: tile.y, feature: f, def, tile });
    });
  }

  const openByNode: number[] = new Array(nodes.length).fill(0);

  for (const tile of board.values()) {
    const def = catalog.get(tile.tile);
    if (!def) continue;
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = SIDE_DELTA[side]!;
      const nb = board.get(cellKey(tile.x + dx, tile.y + dy));
      const nbDef = nb ? catalog.get(nb.tile) : undefined;
      for (let k = 0; k < 3; k++) {
        const port = side * 3 + k;
        const f = featureAtPort(def, tile.rot, port);
        if (f < 0) continue;
        const a = nodeIds.get(nkey(tile.x, tile.y, f))!;
        if (!nb || !nbDef) {
          openByNode[a] = (openByNode[a] ?? 0) + 1;
          continue;
        }
        const g = featureAtPort(nbDef, nb.rot, opposingPort(port));
        if (g < 0) continue;
        uf.union(a, nodeIds.get(nkey(nb.x, nb.y, g))!);
      }
    }
  }

  const byRoot = new Map<number, FeatureExtent>();
  const cellSeen = new Set<string>();
  const extentForNode: FeatureExtent[] = [];
  nodes.forEach((n, i) => {
    const root = uf.find(i);
    let ext = byRoot.get(root);
    const feat = n.def.features[n.feature]!;
    if (!ext) {
      ext = {
        id: byRoot.size,
        kind: feat.kind,
        nodes: [],
        cells: [],
        pennants: 0,
        openPorts: 0,
        complete: false,
        figures: [],
        adjacentCities: [],
      };
      byRoot.set(root, ext);
    }
    ext.nodes.push({ x: n.x, y: n.y, feature: n.feature });
    const ck = `${ext.id}:${n.x},${n.y}`;
    if (!cellSeen.has(ck)) {
      cellSeen.add(ck);
      ext.cells.push([n.x, n.y]);
    }
    ext.pennants += feat.pennants ?? 0;
    ext.openPorts += openByNode[i] ?? 0;
    for (const fig of n.tile.figures)
      if (fig.feature === n.feature)
        ext.figures.push({ player: fig.player, x: n.x, y: n.y, feature: n.feature, figure: fig.figure });
    extentForNode[i] = ext;
  });

  // Completion + field adjacency.
  for (const ext of byRoot.values()) {
    if (ext.kind === "cloister" || ext.kind === "garden") {
      const n = ext.nodes[0]!;
      ext.complete = neighbourCount(board, n.x, n.y) === 8;
    } else {
      ext.complete = ext.kind !== "field" && ext.openPorts === 0;
    }
  }
  nodes.forEach((n, i) => {
    const feat = n.def.features[n.feature]!;
    if (feat.kind !== "field" || !feat.adjacentCities) return;
    const ext = extentForNode[i]!;
    for (const c of feat.adjacentCities) {
      const cityNode = nodeIds.get(nkey(n.x, n.y, c));
      if (cityNode === undefined) continue;
      const cityExt = extentForNode[cityNode]!;
      if (!ext.adjacentCities.includes(cityExt.id)) ext.adjacentCities.push(cityExt.id);
    }
  });

  const extents = [...byRoot.values()];
  return {
    extents,
    extentOf(x, y, feature) {
      const id = nodeIds.get(nkey(x, y, feature));
      return id === undefined ? undefined : extentForNode[id];
    },
  };
}

/** Players with the most figures on the extent (ties all win). */
export function majority(figures: { player: PlayerIndex }[]): PlayerIndex[] {
  const counts = new Map<number, number>();
  for (const f of figures) counts.set(f.player, (counts.get(f.player) ?? 0) + 1);
  let best = 0;
  for (const c of counts.values()) best = Math.max(best, c);
  if (best === 0) return [];
  return [...counts.entries()]
    .filter(([, c]) => c === best)
    .map(([p]) => p)
    .sort((a, b) => a - b);
}

/** Points a road/city/cloister extent is worth, completed now or at the end. */
export function extentPoints(
  ext: FeatureExtent,
  board: Board,
  ruleset: Pick<Ruleset, "fieldEdition">,
  final: boolean,
): number {
  const tiles = ext.cells.length;
  switch (ext.kind) {
    case "road":
      return tiles;
    case "city":
      if (!final && ext.complete) {
        if (ruleset.fieldEdition === 1 && tiles === 2) return 2 + ext.pennants;
        return 2 * tiles + 2 * ext.pennants;
      }
      return tiles + ext.pennants;
    case "cloister":
    case "garden": {
      const n = ext.nodes[0]!;
      return 1 + neighbourCount(board, n.x, n.y);
    }
    default:
      return 0;
  }
}

/** Projected value of a field at game end (3rd/2nd edition rule). */
export function fieldPoints(ext: FeatureExtent, analysis: BoardAnalysis): number {
  return 3 * ext.adjacentCities.filter((id) => analysis.extents[id]?.complete).length;
}

/** Whether the tile fits at (x,y) with the given rotation (edges match, touches a tile). */
export function fits(board: Board, catalog: TileCatalog, def: TileDef, x: number, y: number, rot: number): boolean {
  if (board.has(cellKey(x, y))) return false;
  let touching = false;
  for (let side = 0; side < 4; side++) {
    const [dx, dy] = SIDE_DELTA[side]!;
    const nb = board.get(cellKey(x + dx, y + dy));
    if (!nb) continue;
    const nbDef = catalog.get(nb.tile);
    if (!nbDef) return false;
    touching = true;
    if (edgeKind(def, rot, side) !== edgeKind(nbDef, nb.rot, (side + 2) % 4)) return false;
  }
  return touching;
}

export function frontier(board: Board): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const t of board.values()) {
    for (const [dx, dy] of SIDE_DELTA) {
      const x = t.x + dx;
      const y = t.y + dy;
      const k = cellKey(x, y);
      if (board.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push([x, y]);
    }
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function legalPlacementsOn(
  board: Board,
  catalog: TileCatalog,
  tile: string,
): { x: number; y: number; rot: 0 | 1 | 2 | 3 }[] {
  const def = catalog.get(tile);
  if (!def) return [];
  const out: { x: number; y: number; rot: 0 | 1 | 2 | 3 }[] = [];
  for (const [x, y] of frontier(board))
    for (const rot of [0, 1, 2, 3] as const)
      if (fits(board, catalog, def, x, y, rot)) out.push({ x, y, rot });
  return out;
}


/** Figure options for the tile just placed at `p` (view-only rules, no deck needed). */
export function legalFiguresOn(
  board: Board,
  catalog: TileCatalog,
  tile: string,
  p: Placement,
  me: Pick<PlayerView, "meeples" | "abbotAvailable">,
  ruleset: Pick<Ruleset, "abbot">,
): FigureOption[] {
  const def = catalog.get(tile);
  if (!def || !fits(board, catalog, def, p.x, p.y, p.rot)) return [];
  const next = new Map(board);
  next.set(cellKey(p.x, p.y), { x: p.x, y: p.y, rot: p.rot, tile, figures: [] });
  const analysis = analyzeBoard(next, catalog);
  const out: FigureOption[] = [];
  def.features.forEach((feat, i) => {
    const ext = analysis.extentOf(p.x, p.y, i)!;
    if (feat.kind === "cloister") {
      if (me.meeples > 0) out.push({ type: "meeple", feature: i });
      if (ruleset.abbot && me.abbotAvailable) out.push({ type: "abbot", feature: i });
    } else if (feat.kind === "garden") {
      if (ruleset.abbot && me.abbotAvailable) out.push({ type: "abbot", feature: i });
    } else if (feat.kind !== "river" && me.meeples > 0 && ext.figures.length === 0) {
      out.push({ type: "meeple", feature: i });
    }
  });
  return out;
}

/** Where the given player's abbot stands, if on the board. */
export function findAbbot(board: Board, player: PlayerIndex): { x: number; y: number; feature: number } | null {
  for (const t of board.values())
    for (const f of t.figures) if (f.player === player && f.figure === "abbot") return { x: t.x, y: t.y, feature: f.feature };
  return null;
}
