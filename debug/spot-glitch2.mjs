import { parseFigFile, buildNodeIdIndex, buildRawNodeIndex, formatGUID } from "../dist/parser/index.js";
const parsed = await parseFigFile("/Users/siu/Downloads/toritori2.0.fig");
const nodeIdIndex = buildNodeIdIndex(parsed.document);
const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();
const root = nodeIdIndex.get("1:4941");

function localT(n) {
  if (n.transform) return { a: n.transform.m00, b: n.transform.m10, c: n.transform.m01, d: n.transform.m11, e: n.transform.m02, f: n.transform.m12 };
  return { a: 1, b: 0, c: 0, d: 1, e: n.x ?? 0, f: n.y ?? 0 };
}
function mul(p, c) {
  return { a: p.a*c.a + p.c*c.b, b: p.b*c.a + p.d*c.b, c: p.a*c.c + p.c*c.d, d: p.b*c.c + p.d*c.d, e: p.a*c.e + p.c*c.f + p.e, f: p.b*c.e + p.d*c.f + p.f };
}
const I = { a:1,b:0,c:0,d:1,e:0,f:0 };
function fillsDesc(n) {
  const f = n.fills;
  if (!Array.isArray(f) || !f.length) return "";
  return f.map(p => p.type + (p.color ? `(${Math.round(p.color.r*255)},${Math.round(p.color.g*255)},${Math.round(p.color.b*255)})` : "")).join(",");
}
function walk(n, t, path, depth) {
  if (depth > 12) return;
  const w = mul(t, localT(n));
  const corners = [[0,0],[n.width ?? 0,0],[0,n.height ?? 0],[n.width ?? 0,n.height ?? 0]]
    .map(([x,y]) => ({ x: w.a*x + w.c*y + w.e, y: w.b*x + w.d*y + w.f }));
  const minX = Math.min(...corners.map(p=>p.x)), maxX = Math.max(...corners.map(p=>p.x));
  const minY = Math.min(...corners.map(p=>p.y)), maxY = Math.max(...corners.map(p=>p.y));
  if (maxX > 280 && minX < 393 && maxY > 430 && minY < 475) {
    const fd = fillsDesc(n);
    if (n.type !== "FRAME" || fd) {
      console.log(`${n.type} "${n.name}" ${formatGUID(n.guid)} @(${Math.round(minX)},${Math.round(minY)}) ${Math.round(maxX-minX)}x${Math.round(maxY-minY)} fills=[${fd}] ${path.slice(-70)}`);
    }
  }
  let children = n.children ?? [];
  if (n.type === "INSTANCE" && children.length === 0 && n.symbolData?.symbolID) {
    const sym = nodeIdIndex.get(`${n.symbolData.symbolID.sessionID}:${n.symbolData.symbolID.localID}`);
    if (sym?.children) children = sym.children;
  }
  for (const c of children) walk(c, w, path + "/" + n.name, depth + 1);
}
walk(root, I, "", 0);
