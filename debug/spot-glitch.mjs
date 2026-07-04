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
const hits = [];
function walk(n, t, path) {
  const w = mul(t, localT(n));
  const x0 = w.e, y0 = w.f;
  const x1 = w.e + w.a * (n.width ?? 0) + w.c * (n.height ?? 0);
  const y1 = w.f + w.b * (n.width ?? 0) + w.d * (n.height ?? 0);
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  // glitch region: x 300-400, y 418-445
  if (maxX > 290 && minX < 400 && maxY > 430 && minY < 490 && (maxY - minY) < 80) {
    hits.push({ id: formatGUID(n.guid), type: n.type, name: n.name, x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX-minX), h: Math.round(maxY-minY), path });
  }
  for (const c of n.children ?? []) walk(c, w, path + "/" + n.name);
}
walk(root, I, "");
for (const h of hits) console.log(`${h.type} "${h.name}" ${h.id} @(${h.x},${h.y}) ${h.w}x${h.h}  ${h.path}`);
