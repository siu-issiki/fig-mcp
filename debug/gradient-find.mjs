import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex, formatGUID } from "../dist/parser/index.js";
import { renderScreen } from "../dist/renderer/render-screen.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";
const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();

function find(n, pred, out = [], visible = true) {
  const vis = visible && n.visible !== false;
  if (vis && pred(n)) out.push(n);
  for (const c of n.children ?? []) find(c, pred, out, vis);
  return out;
}
const hits = find(parsed.document, n => {
  const fills = n.fills;
  return Array.isArray(fills) && fills.some(p => p.visible !== false && p.type?.startsWith("GRADIENT"));
});
for (const h of hits.slice(0, 8)) console.log(formatGUID(h.guid), h.type, `"${h.name}"`, Math.round(h.width ?? 0), "x", Math.round(h.height ?? 0));

if (hits.length) {
  const n = hits[0];
  const result = renderScreen(n, parsed.images, parsed.blobs ?? [], { nodeIndex: nodeIdIndex, rawNodeIndex, scale: 4 });
  console.log("\nrender:", n.name, "| linearGradient:", result.svg.includes("<linearGradient"), "| url ref:", result.svg.includes('url(#grad-'));
  if (result.svg) {
    const shot = await generateScreenshot(result.svg, { maxWidth: 400, maxHeight: 400 });
    fs.writeFileSync("/tmp/gradient_node.png", Buffer.from(shot.base64, "base64"));
    console.log("saved /tmp/gradient_node.png");
  }
}
