import * as fs from "fs";
import { parseFigFile, buildRawNodeIndex } from "../dist/parser/index.js";
import { decodePathCommands } from "../dist/renderer/vector-renderer.js";

const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const raw = buildRawNodeIndex(parsed.rawMessage);
const n = raw.get("1:4296"); // TEXT "HAKONE" fontSize 30
const ctx = { defs: [], clipCounter: 0, shadowCounter: 0, warnings: [], usedFonts: new Set() };

const glyphs = n.derivedTextData.glyphs;
console.log("glyph count:", glyphs.length);
const g0 = glyphs[0];
const cmds = decodePathCommands(g0.commandsBlob, parsed.blobs, ctx);
let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
for (const c of cmds) {
  for (let i = 0; i < c.values.length; i += 2) {
    minX = Math.min(minX, c.values[i]); maxX = Math.max(maxX, c.values[i]);
    minY = Math.min(minY, c.values[i+1]); maxY = Math.max(maxY, c.values[i+1]);
  }
}
console.log("glyph0 (H) bounds:", { minX, minY, maxX, maxY }, "advance:", g0.advance, "fontSize:", g0.fontSize);

// Render all glyphs assuming em-square coords scaled by fontSize, positioned at baseline
const CMD = { 0: "Z", 1: "M", 2: "L", 3: "Q", 4: "C" };
function toPath(cmds, scale, dx, dy) {
  let d = "";
  for (const c of cmds) {
    const v = c.values.map((val, i) => (i % 2 === 0 ? val * scale + dx : val * scale + dy).toFixed(2));
    d += CMD[c.cmd] + v.join(" ") + " ";
  }
  return d.trim();
}
let paths = "";
for (const g of glyphs) {
  const cmds = decodePathCommands(g.commandsBlob, parsed.blobs, ctx);
  if (!cmds) continue;
  paths += `<path d="${toPath(cmds, g.fontSize, g.position.x, g.position.y)}" fill="#F2727D" />`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160" viewBox="-5 -10 90 46">${paths}</svg>`;
fs.writeFileSync("/tmp/glyphs.svg", svg);
const { generateScreenshot } = await import("../dist/renderer/screenshot.js");
const shot = await generateScreenshot(svg, { maxWidth: 600, maxHeight: 320 });
fs.writeFileSync("/tmp/glyphs.png", Buffer.from(shot.base64, "base64"));
console.log("rendered /tmp/glyphs.png");
