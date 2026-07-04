import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex } from "../dist/parser/index.js";

const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();

const raw = rawNodeIndex.get("1:312");  // "Bounding box" frame inside icon symbol
const replacer = (k, v) => typeof v === "bigint" ? v.toString() : v;
const skip = new Set(["fillPaints"]);
const summary = {};
for (const [k, v] of Object.entries(raw)) {
  if (skip.has(k)) continue;
  const s = JSON.stringify(v, replacer);
  summary[k] = s && s.length > 120 ? s.slice(0, 120) + "…" : v;
}
console.log(JSON.stringify(summary, replacer, 2));
console.log("\nfillPaints[0] keys:", Object.keys(raw.fillPaints?.[0] ?? {}));
console.log("fillPaints[0].visible:", raw.fillPaints?.[0]?.visible, "opacity:", raw.fillPaints?.[0]?.opacity);
