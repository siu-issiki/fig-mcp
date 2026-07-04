import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex, formatGUID } from "../dist/parser/index.js";
import { renderScreen } from "../dist/renderer/render-screen.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";
const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();

// find "image 23" under Spot 1:4941
function find(n, pred, out = []) { if (pred(n)) out.push(n); for (const c of n.children ?? []) find(c, pred, out); return out; }
const spot = nodeIdIndex.get("1:4941");
const img = find(spot, n => n.name === "image 23")[0];
console.log("image 23:", formatGUID(img.guid), img.type, img.width, "x", img.height, "transform:", JSON.stringify(img.transform), "visible:", img.visible);

// parents chain with transforms and clip/mask info
function chain(n, target, path = []) {
  if (n === target) return path.concat(n);
  for (const c of n.children ?? []) { const r = chain(c, target, path.concat(n)); if (r) return r; }
  return null;
}
for (const p of chain(spot, img)) {
  const raw = rawNodeIndex.get(formatGUID(p.guid)) ?? {};
  console.log(`  ${p.type} "${p.name}" t=${JSON.stringify(p.transform ?? {x:p.x,y:p.y})} clips=${!!p.clipsContent} mask=${!!raw.mask} visible=${p.visible}`);
}

// render QR frame standalone
const qr = find(spot, n => n.name === "QR")[0];
const result = renderScreen(qr, parsed.images, parsed.blobs ?? [], { includeImages: true, nodeIndex: nodeIdIndex, rawNodeIndex, scale: 2 });
const shot = await generateScreenshot(result.svg, { maxWidth: 600, maxHeight: 600 });
fs.writeFileSync("/tmp/qr_standalone.png", Buffer.from(shot.base64, "base64"));
console.log("QR standalone rendered");
