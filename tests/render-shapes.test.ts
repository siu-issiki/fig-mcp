import { describe, expect, it } from "vitest";

import { renderScreen } from "../src/renderer/render-screen.js";
import type { FigNode } from "../src/parser/types.js";

function base(localID: number, name: string, type: string, extra: Record<string, unknown>) {
  return {
    guid: { sessionID: 1, localID },
    name,
    type,
    x: 0,
    y: 0,
    width: 24,
    height: 24,
    ...extra,
  } as unknown as FigNode;
}

describe("shape rendering", () => {
  it("renders ROUNDED_RECTANGLE with corner radius (regression: fell back to FRAME)", () => {
    const rounded = base(2, "Pill", "ROUNDED_RECTANGLE", {
      cornerRadius: 6,
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 }, visible: true }],
    });
    const { svg } = renderScreen(rounded, undefined, []);
    expect(svg).toContain('rx="6"');
    expect(svg).toContain("rgb(0, 0, 255)");
  });

  it("mask layers clip siblings instead of painting (regression: icon black boxes)", () => {
    // Material-symbols style icon: a filled "Bounding box" mask followed by the glyph
    const boundingBox = base(3, "Bounding box", "ROUNDED_RECTANGLE", {
      isMask: true,
      fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, visible: true }],
    });
    const glyph = base(4, "glyph", "RECTANGLE", {
      width: 12,
      height: 12,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
    });
    const icon = base(5, "icon/test", "FRAME", { children: [boundingBox, glyph] });

    const { svg } = renderScreen(icon, undefined, []);
    // The mask must become a clipPath, not a painted dark rectangle
    expect(svg).toContain("<clipPath");
    expect(svg).not.toContain("rgb(26, 26, 26)");
    // The glyph renders inside the clipped group
    expect(svg).toContain("rgb(255, 0, 0)");
  });
});
