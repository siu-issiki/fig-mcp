import * as fs from "fs";
import { parseFigFile, buildRawNodeIndex } from "../dist/parser/index.js";
import { decodePathCommands } from "../dist/renderer/vector-renderer.js";
import { generateScreenshot } from "../dist/renderer/screenshot.js";

const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const raw = buildRawNodeIndex(parsed.rawMessage);
const n = raw.get("1:4296");
const ctx = { defs: [], clipCounter: 0, shadowCounter: 0, warnings: [], usedFonts: new Set() };
const CMD = { 0: "Z", 1: "M", 2: "L", 3: "Q", 4: "C" };

for (const [label, flip] of [["ydown", false], ["yup", true]]) {
  let paths = "";
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const g of n.derivedTextData.glyphs) {
    const cmds = decodePathCommands(g.commandsBlob, parsed.blobs, ctx);
    if (!cmds) continue;
    let d = "";
    for (const c of cmds) {
      const pts = [];
      for (let i = 0; i < c.values.length; i += 2) {
        const x = c.values[i] * g.fontSize + g.position.x;
        const y = flip
          ? g.position.y - c.values[i + 1] * g.fontSize
          : g.position.y + c.values[i + 1] * g.fontSize;
        pts.push(x.toFixed(2), y.toFixed(2));
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      d += CMD[c.cmd] + pts.join(" ") + " ";
    }
    paths += `<path d="${d.trim()}" fill="#F2727D" fill-rule="nonzero" />`;
  }
  console.log(label, "bounds:", minX.toFixed(1), minY.toFixed(1), maxX.toFixed(1), maxY.toFixed(1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(maxX-minX)+4}" height="${Math.ceil(maxY-minY)+4}" viewBox="${minX-2} ${minY-2} ${maxX-minX+4} ${maxY-minY+4}">${paths}</svg>`;
  const shot = await generateScreenshot(svg, { maxWidth: 600, maxHeight: 300 });
  fs.writeFileSync(`/tmp/glyphs_${label}.png`, Buffer.from(shot.base64, "base64"));
}
console.log("done");
