import * as fs from "fs";
import { parseFigFile, buildRawNodeIndex } from "../dist/parser/index.js";
import { decodePathCommands } from "../dist/renderer/vector-renderer.js";
import { buildSvgPath } from "../dist/renderer/render-utils.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";

const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const raw = buildRawNodeIndex(parsed.rawMessage);
const n = raw.get("1:4296");
const ctx = { defs: [], clipCounter: 0, shadowCounter: 0, warnings: [], usedFonts: new Set() };

for (const [label, dScale] of [["yup", -1], ["ydown", 1]]) {
  let paths = "";
  for (const g of n.derivedTextData.glyphs) {
    const cmds = decodePathCommands(g.commandsBlob, parsed.blobs, ctx);
    if (!cmds) continue;
    const t = { a: g.fontSize, b: 0, c: 0, d: g.fontSize * dScale, e: g.position.x, f: g.position.y };
    const d = buildSvgPath(cmds, t);
    if (d) paths += `<path d="${d}" fill="#F2727D" fill-rule="nonzero" />`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="-2 ${label === "yup" ? 0 : 20} 80 30">${paths}</svg>`;
  const shot = await generateScreenshot(svg, { maxWidth: 640, maxHeight: 240 });
  fs.writeFileSync(`/tmp/glyphs_${label}2.png`, Buffer.from(shot.base64, "base64"));
}
console.log("done");
