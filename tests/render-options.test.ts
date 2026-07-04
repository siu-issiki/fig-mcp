import { describe, expect, it } from "vitest";

import { renderScreen } from "../src/renderer/render-screen.js";
import type { FigNode } from "../src/parser/types.js";

const redRect = {
  guid: { sessionID: 1, localID: 2 },
  name: "Red",
  type: "RECTANGLE",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
} as unknown as FigNode;

const frame = {
  guid: { sessionID: 1, localID: 1 },
  name: "Frame",
  type: "FRAME",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  children: [redRect],
} as unknown as FigNode;

describe("renderScreen option merging", () => {
  it("renders fills by default", () => {
    const { svg } = renderScreen(frame, undefined, []);
    expect(svg).toContain("rgb(255, 0, 0)");
  });

  it("treats explicit undefined options as absent (regression: blank renders)", () => {
    // The MCP handler passes `{ includeFills: undefined }` when the caller
    // does not specify options; this must not disable the default.
    const { svg } = renderScreen(frame, undefined, [], {
      includeFills: undefined,
      includeText: undefined,
      scale: 1,
    });
    expect(svg).toContain("rgb(255, 0, 0)");
  });

  it("still honours explicit false", () => {
    const { svg } = renderScreen(frame, undefined, [], { includeFills: false });
    expect(svg).not.toContain("rgb(255, 0, 0)");
  });
});
