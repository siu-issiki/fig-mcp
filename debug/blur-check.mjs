import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex, formatGUID } from "../dist/parser/index.js";
import { renderScreen } from "../dist/renderer/render-screen.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";
const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();

// FOREGROUND_BLUR sample: 1:1871 "Old Street Buildings Road 2" radius 57.6 — render its parent for context
const n = nodeIdIndex.get("1:1871");
console.log("node:", n?.name, n?.type, Math.round(n?.width), "x", Math.round(n?.height), "visible:", n?.visible);
// find parent frame for context via nodePath walk
function chain(root, target, path = []) {
  if (root === target) return path.concat(root);
  for (const c of root.children ?? []) { const r = chain(c, target, path.concat(root)); if (r) return r; }
  return null;
}
const ch = chain(parsed.document, n);
const parent = ch[ch.length - 2];
console.log("parent:", parent?.name, parent?.type);
const result = renderScreen(parent, parsed.images, parsed.blobs ?? [], { includeImages: true, nodeIndex: nodeIdIndex, rawNodeIndex, scale: 2 });
console.log("has blur filter:", /<filter id="blur-/.test(result.svg), "| feGaussianBlur:", result.svg.includes("feGaussianBlur"));
const shot = await generateScreenshot(result.svg, { maxWidth: 700, maxHeight: 1500 });
fs.writeFileSync("/tmp/blur_check.png", Buffer.from(shot.base64, "base64"));
console.log("saved");
