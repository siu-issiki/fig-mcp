import * as fs from "fs";
import { generateScreenshot } from "../src/renderer/screenshot.js";
const [svgIn, pngOut] = process.argv.slice(2);
const svg = fs.readFileSync(svgIn, "utf8");
const shot = await generateScreenshot(svg, { maxWidth: 400, maxHeight: 900 });
fs.writeFileSync(pngOut, Buffer.from(shot.base64, "base64"));
console.log("png:", shot.width, "x", shot.height, Buffer.from(shot.base64, "base64").length, "bytes");
