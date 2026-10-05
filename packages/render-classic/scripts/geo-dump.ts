// Dev aid: print the decoded core-geo 2D buffers of a few tiles.
import { CoreGeo } from "@carcassonne/core-geo";
import { loadCoreKit } from "@carcassonne/core-wasm";

const kit = await loadCoreKit();
const geo = new CoreGeo(kit.instance);
for (const id of process.argv.slice(2)) {
  const g = geo.tile2d(id);
  console.log(id, g.meta, g.features.map((f) => `${f.index}:${f.kind} a=${f.anchor.map((n) => n.toFixed(2))}`).join(" "));
  for (const p of g.paths) console.log("  ", p.role, p.kind, "f" + p.feature, p.closed ? "closed" : "open", "w=" + p.width.toFixed(3), "n=" + p.points.length / 2);
  console.log("  pennants", g.pennants);
}
