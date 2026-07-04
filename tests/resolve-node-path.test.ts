import { describe, expect, it } from "vitest";

import { resolveNodePath } from "../src/parser/layout-inference.js";
import type { FigNode } from "../src/parser/types.js";

function node(name: string, type: string, children?: FigNode[]): FigNode {
  return { guid: { sessionID: 1, localID: Math.floor(Math.random() * 1e9) }, name, type, children } as unknown as FigNode;
}

const tree = node("Document", "DOCUMENT", [
  node("Page 1", "CANVAS", [
    node("Plan select", "FRAME", [node("Title", "TEXT")]),
    node("Plans / Detail - LIST", "INSTANCE", [node("Row", "FRAME")]),
    node("icon/open_in_new", "INSTANCE"),
  ]),
  node("Internal Only Canvas", "CANVAS"),
]);

describe("resolveNodePath", () => {
  it("resolves an exact path chain", () => {
    const result = resolveNodePath(tree, "Page 1/Plan select/Title");
    expect(result.node?.type).toBe("TEXT");
    expect(result.path).toEqual(["Page 1", "Plan select", "Title"]);
  });

  it("returns root for an empty path", () => {
    expect(resolveNodePath(tree, "").node?.name).toBe("Document");
  });

  it("matches case-insensitively", () => {
    expect(resolveNodePath(tree, "page 1/plan select").node?.name).toBe("Plan select");
  });

  it("falls back to substring matching", () => {
    expect(resolveNodePath(tree, "Page 1/Plan sel").node?.name).toBe("Plan select");
  });

  it("resolves node names containing slashes", () => {
    const withSpaces = resolveNodePath(tree, "Page 1/Plans / Detail - LIST/Row");
    expect(withSpaces.node?.name).toBe("Row");

    const icon = resolveNodePath(tree, "Page 1/icon/open_in_new");
    expect(icon.node?.name).toBe("icon/open_in_new");
  });

  it("reports candidates when a segment does not match", () => {
    const result = resolveNodePath(tree, "Page 1/No Such Frame");
    expect(result.node).toBeNull();
    expect(result.error).toContain('"Plan select" (FRAME)');
  });

  it("errors when descending below a leaf", () => {
    const result = resolveNodePath(tree, "Internal Only Canvas/Anything");
    expect(result.node).toBeNull();
    expect(result.error).toContain("has no children");
  });
});
