import * as fs from "fs";
import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex } from "../dist/parser/index.js";
import { renderScreen } from "../dist/renderer/render-screen.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";

const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();
const node = nodeIdIndex.get("1:4281");

for (const [label, opts] of [
  ["dist_images", { includeImages: true, nodeIndex: nodeIdIndex, rawNodeIndex }],
  ["dist_noimages", { scale: 1, nodeIndex: nodeIdIndex, rawNodeIndex }],
]) {
  const result = renderScreen(node, parsed.images, parsed.blobs ?? [], opts);
  const c = (re) => (result.svg.match(re) ?? []).length;
  console.log(label, "svg:", result.svg.length, "text:", c(/<text[\s>]/g), "rect:", c(/<rect[\s>]/g), "image:", c(/<image[\s>]/g), "warnings:", result.warnings.length);
  const shot = await generateScreenshot(result.svg, { maxWidth: 400, maxHeight: 900 });
  fs.writeFileSync(`/tmp/${label}.png`, Buffer.from(shot.base64, "base64"));
  console.log(label, "png bytes:", Buffer.from(shot.base64, "base64").length);
}
