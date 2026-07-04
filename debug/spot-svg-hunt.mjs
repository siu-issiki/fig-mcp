import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex } from "../dist/parser/index.js";
import { renderScreen } from "../dist/renderer/render-screen.js";
const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();
const result = renderScreen(nodeIdIndex.get("1:4941"), parsed.images, parsed.blobs ?? [], {
  includeImages: true, nodeIndex: nodeIdIndex, rawNodeIndex,
});
fs.writeFileSync("/tmp/spot.svg", result.svg);
// find elements with coords in glitch region: numbers x∈[280,400], y∈[430,480]
const els = result.svg.match(/<(rect|path|image|g)\b[^>]*>/g) ?? [];
let idx = 0;
for (const el of els) {
  idx++;
  // quick numeric scan of first coordinates
  const nums = [...el.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
  const hasX = nums.some(v => v >= 280 && v <= 400);
  const hasY = nums.some(v => v >= 425 && v <= 480);
  const isDark = /fill="(?:#000|black|rgb\(0, 0, 0\)|rgb\(1[0-9], |rgb\([0-9], )/.test(el) || /fill="rgb\(2[0-9],/.test(el);
  if (hasX && hasY && isDark) {
    console.log("---", idx, el.slice(0, 260));
  }
}
console.log("total elements:", els.length);
