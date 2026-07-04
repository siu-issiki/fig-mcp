import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex, formatGUID } from "../dist/parser/index.js";
import { renderScreen } from "../dist/renderer/render-screen.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";

const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();

// find an icon instance
function find(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children ?? []) find(c, pred, out);
  return out;
}
const icons = find(parsed.document, n => n.type === "INSTANCE" && /^icon\//.test(n.name ?? ""));
console.log("icon instances:", icons.length, "first:", icons[0]?.name, formatGUID(icons[0]?.guid));

const icon = icons.find(n => n.name === "icon/open_in_new") ?? icons[0];
const symId = formatGUID(icon.symbolData.symbolID);
const sym = nodeIdIndex.get(symId);
console.log("\nicon:", icon.name, formatGUID(icon.guid), "symbol:", symId, sym?.name, sym?.type);

function dumpTree(n, d = 0) {
  const raw = rawNodeIndex.get(formatGUID(n.guid)) ?? {};
  const keys = ["fillGeometry","strokeGeometry","vectorData","fillPaints","strokePaints"].filter(k => raw[k] !== undefined);
  console.log("  ".repeat(d) + `${n.type} "${n.name}" ${formatGUID(n.guid)} size=${n.width}x${n.height} rawKeys=[${keys}]`);
  if (raw.fillGeometry) console.log("  ".repeat(d) + `  fillGeometry: ${JSON.stringify(raw.fillGeometry).slice(0,200)}`);
  if (raw.fillPaints) console.log("  ".repeat(d) + `  fillPaints: ${JSON.stringify(raw.fillPaints).slice(0,200)}`);
  for (const c of n.children ?? []) dumpTree(c, d + 1);
}
dumpTree(sym);

// render icon instance standalone
const result = renderScreen(icon, parsed.images, parsed.blobs ?? [], {
  includeImages: true, nodeIndex: nodeIdIndex, rawNodeIndex, scale: 8,
});
console.log("\nsvg:", result.svg.length, "warnings:", result.warnings);
fs.writeFileSync("/tmp/icon.svg", result.svg);
const shot = await generateScreenshot(result.svg, { maxWidth: 256, maxHeight: 256 });
fs.writeFileSync("/tmp/icon.png", Buffer.from(shot.base64, "base64"));
console.log("svg content:\n", result.svg.slice(0, 1500));
