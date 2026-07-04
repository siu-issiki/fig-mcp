import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex, formatGUID } from "../dist/parser/index.js";
import { renderScreen } from "../dist/renderer/render-screen.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";
const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();
// 1:383 color/primary_01 has the linear gradient; render its parent context
const n = nodeIdIndex.get("1:383");
console.log("node:", n?.name, n?.type, n?.width, "x", n?.height);
const result = renderScreen(n, parsed.images, parsed.blobs ?? [], { nodeIndex: nodeIdIndex, rawNodeIndex, scale: 4 });
console.log("has linearGradient def:", result.svg.includes("<linearGradient"));
console.log("uses url(#grad:", result.svg.includes('fill="url(#grad-'));
const shot = await generateScreenshot(result.svg, { maxWidth: 400, maxHeight: 400 });
fs.writeFileSync("/tmp/gradient_node.png", Buffer.from(shot.base64, "base64"));
