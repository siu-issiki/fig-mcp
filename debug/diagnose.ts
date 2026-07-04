/**
 * Debug harness: render specific nodes from a real .fig file and report
 * what ends up in the SVG (text/rect/image counts, warnings).
 *
 * Usage: npx tsx debug/diagnose.ts <file.fig> <nodeId> [svgOut]
 */
import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex, formatGUID } from "../src/parser/index.js";
import type { FigNode, SceneNode } from "../src/parser/types.js";
import { renderScreen } from "../src/renderer/render-screen.js";

const [figPath, nodeId, svgOut] = process.argv.slice(2);

const parsed = await parseFigFile(figPath);
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();

const node = nodeIdIndex.get(nodeId);
if (!node) {
  console.error("node not found:", nodeId);
  process.exit(1);
}

console.log(`node: ${node.name} (${node.type})`);
const kids = (node.children ?? []) as FigNode[];
console.log(`direct children: ${kids.length}`);
for (const c of kids.slice(0, 10)) {
  const sc = c as SceneNode & FigNode;
  const sym = (sc as any).symbolData?.symbolID;
  const symId = sym ? formatGUID(sym) : "-";
  const symNode = sym ? nodeIdIndex.get(symId) : undefined;
  console.log(
    `  ${c.type} "${c.name}" children=${c.children?.length ?? 0}` +
      (c.type === "INSTANCE"
        ? ` symbolID=${symId} symbolInIndex=${!!symNode} symbolChildren=${symNode?.children?.length ?? 0}`
        : ""),
  );
}

const result = renderScreen(node, parsed.images, parsed.blobs ?? [], {
  includeImages: true,
  nodeIndex: nodeIdIndex,
  rawNodeIndex,
});

const count = (re: RegExp) => (result.svg.match(re) ?? []).length;
console.log(`\nsvg: ${result.svg.length} bytes, ${result.width}x${result.height}`);
console.log(`  <text>: ${count(/<text[\s>]/g)}`);
console.log(`  <rect>: ${count(/<rect[\s>]/g)}`);
console.log(`  <path>: ${count(/<path[\s>]/g)}`);
console.log(`  <image>: ${count(/<image[\s>]/g)}`);
console.log(`warnings (${result.warnings.length}):`);
for (const w of result.warnings.slice(0, 20)) console.log("  -", w);

if (svgOut) {
  fs.writeFileSync(svgOut, result.svg);
  console.log("svg written to", svgOut);
}
