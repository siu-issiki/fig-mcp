import { describe, expect, it } from "vitest";

import { renderScreen } from "../src/renderer/render-screen.js";
import { resolveFonts } from "../src/renderer/font-resolver.js";
import type { FigNode } from "../src/parser/types.js";

function base(localID: number, name: string, type: string, extra: Record<string, unknown>) {
  return {
    guid: { sessionID: 1, localID },
    name,
    type,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    ...extra,
  } as unknown as FigNode;
}

const textStyle = {
  fontFamily: "AFSGillSBCond",
  fontWeight: 700,
  fontStyle: "normal",
  fontSize: 20,
  textAlignHorizontal: "LEFT",
};

describe("render fidelity", () => {
  it("applies textCase UPPER to characters", () => {
    const node = base(1, "cta", "TEXT", {
      characters: "New TRIP",
      style: { ...textStyle, textCase: "UPPER" },
    });
    const { svg } = renderScreen(node, undefined, []);
    expect(svg).toContain("NEW TRIP");
    expect(svg).not.toContain("New TRIP");
  });

  it("preserves rotation on text via a transform matrix", () => {
    // 90° rotation: x' = -y, y' = x
    const node = base(2, "vertical", "TEXT", {
      characters: "TORIP No. 0001",
      style: textStyle,
      transform: { m00: 0, m01: -1, m02: 50, m10: 1, m11: 0, m12: 10 },
    });
    const { svg } = renderScreen(node, undefined, []);
    // renderScreen offsets content to the origin, so only assert the rotation part
    expect(svg).toMatch(/<text[^>]*transform="matrix\(0 1 -1 0 /);
  });

  it("reports fonts used by the render", () => {
    const node = base(3, "t", "TEXT", { characters: "abc", style: textStyle });
    const { usedFonts } = renderScreen(node, undefined, []);
    expect(usedFonts).toEqual([
      { family: "AFSGillSBCond", weight: 700, style: "normal" },
    ]);
  });

  it("includes fontMap fallbacks in usedFonts so the PNG pass can load them", () => {
    const node = base(15, "t", "TEXT", { characters: "abc", style: textStyle });
    const { usedFonts } = renderScreen(node, undefined, [], {
      fontMap: { AFSGillSBCond: "Oswald" },
    });
    expect(usedFonts).toContainEqual({ family: "AFSGillSBCond", weight: 700, style: "normal" });
    expect(usedFonts).toContainEqual({ family: "Oswald", weight: 700, style: "normal" });
  });

  it("adds fontMap fallbacks to font-family", () => {
    const node = base(4, "t", "TEXT", { characters: "abc", style: textStyle });
    const { svg } = renderScreen(node, undefined, [], {
      fontMap: { AFSGillSBCond: "Gill Sans" },
    });
    // Unquoted on purpose: resvg's list parser does not strip quotes
    expect(svg).toContain('font-family="AFSGillSBCond, Gill Sans"');
  });

  it("renders frame borders from strokeGeometry (dashes are baked in)", () => {
    // Figma serializes the stroke outline (incl. dash segments) as geometry
    const frame = base(5, "cta-frame", "FRAME", {
      strokes: [{ type: "SOLID", color: { r: 0.7, g: 0.5, b: 0.4, a: 1 }, visible: true }],
      strokeGeometry: [
        { windingRule: "NONZERO", commands: ["M", 0, 0, "L", 4, 0, "L", 4, 1, "L", 0, 1, "Z"] },
      ],
      children: [],
    });
    const { svg } = renderScreen(frame, undefined, []);
    expect(svg).toContain('fill="rgb(179, 128, 102)"');
  });

  it("draws nothing for frames whose strokeGeometry is degenerate", () => {
    // e.g. the "stamp" frame: visible stroke paint but a zero-area outline
    const frame = base(9, "stamp", "FRAME", {
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 1, a: 1 }, visible: true }],
      strokeGeometry: [
        { windingRule: "NONZERO", commands: ["M", 0, 20, "L", 39, 20, "L", 39, 20, "L", 0, 20, "Z"] },
      ],
      children: [
        base(10, "content", "RECTANGLE", {
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 }, visible: true }],
        }),
      ],
    });
    const { svg } = renderScreen(frame, undefined, []);
    // The degenerate outline is emitted as a zero-area path; assert the
    // renderer did NOT synthesize a rectangular border for the frame
    expect(svg).not.toMatch(/<rect[^>]*stroke=/);
    expect(svg).toContain("rgb(0, 0, 255)");
  });

  it("renders dashed strokes on rectangle shapes", () => {
    const rect = base(11, "dashed-rect", "RECTANGLE", {
      strokes: [{ type: "SOLID", color: { r: 0.7, g: 0.5, b: 0.4, a: 1 }, visible: true }],
      strokeDashes: [4, 4],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).toContain('stroke-dasharray="4 4"');
  });

  it("renders only the base operand of geometry-less SUBTRACT booleans", () => {
    const baseShape = base(6, "ring", "RECTANGLE", {
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
    });
    const subtrahend = base(7, "hole", "RECTANGLE", {
      fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 }, visible: true }],
    });
    const boolOp = base(8, "Subtract", "BOOLEAN_OPERATION", {
      booleanOperation: "SUBTRACT",
      children: [baseShape, subtrahend],
    });
    const { svg } = renderScreen(boolOp, undefined, []);
    expect(svg).toContain("rgb(255, 0, 0)");
    expect(svg).not.toContain("rgb(0, 255, 0)");
  });

  it("renders boolean operands when geometry blobs cannot be decoded", () => {
    const operand = base(12, "operand", "RECTANGLE", {
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
    });
    const boolOp = base(13, "Union", "BOOLEAN_OPERATION", {
      booleanOperation: "UNION",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
      fillGeometry: [{ windingRule: "NONZERO", commandsBlob: 999 }],
      children: [operand],
    });
    // blob 999 does not exist -> geometry decode fails -> operands must render
    const { svg } = renderScreen(boolOp, undefined, []);
    expect(svg).toContain("rgb(255, 0, 0)");
  });

  it("falls back to a synthesized border when strokeGeometry cannot be decoded", () => {
    const frame = base(14, "bordered", "FRAME", {
      strokes: [{ type: "SOLID", color: { r: 0.7, g: 0.5, b: 0.4, a: 1 }, visible: true }],
      strokeGeometry: [{ windingRule: "NONZERO", commandsBlob: 999 }],
      children: [],
    });
    const { svg } = renderScreen(frame, undefined, []);
    expect(svg).toMatch(/<rect[^>]*stroke="rgb\(179, 128, 102\)"/);
  });

  it("resolveFonts reports unknown families as missing without downloading", async () => {
    const { fontFiles, missing } = await resolveFonts(
      [{ family: "Definitely Not A Real Font 12345", weight: 400, style: "normal" }],
      { download: false },
    );
    expect(fontFiles).toEqual([]);
    expect(missing).toEqual(["Definitely Not A Real Font 12345"]);
  });
});

describe("gradient fills", () => {
  const stops = [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
  ];

  it("renders linear gradients as SVG linearGradient", () => {
    const rect = base(20, "grad", "RECTANGLE", {
      fills: [{ type: "GRADIENT_LINEAR", visible: true, stops }],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).toContain("<linearGradient");
    expect(svg).toMatch(/fill="url\(#grad-\d+\)"/);
    expect(svg).toContain('stop-color="rgb(255, 0, 0)"');
    expect(svg).toContain('stop-opacity="0.500"');
  });

  it("renders radial gradients as SVG radialGradient", () => {
    const rect = base(21, "grad-r", "RECTANGLE", {
      fills: [{ type: "GRADIENT_RADIAL", visible: true, stops }],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).toContain("<radialGradient");
    expect(svg).toMatch(/fill="url\(#grad-\d+\)"/);
  });

  it("falls back to the first stop for text fills", () => {
    const node = base(22, "grad-text", "TEXT", {
      characters: "abc",
      style: textStyle,
      fills: [{ type: "GRADIENT_LINEAR", visible: true, stops }],
    });
    const { svg } = renderScreen(node, undefined, []);
    expect(svg).toContain('fill="rgb(255, 0, 0)"');
  });
});

describe("image fill transforms", () => {
  const imageFill = {
    fills: [{ type: "IMAGE", imageHash: "img1", visible: true }],
  };
  const images = new Map([["img1", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])]]);

  it("renders mirrored image fills flipped at their real bounds", () => {
    const rect = base(30, "flipped", "RECTANGLE", {
      ...imageFill,
      width: 200,
      height: 200,
      transform: { m00: -1, m01: 0, m02: 232.5, m10: 0, m11: 1, m12: 0 },
    });
    const { svg } = renderScreen(rect, images, [], { includeImages: true });
    // the negative scale is preserved so the bitmap is actually mirrored
    expect(svg).toMatch(/<image[^>]*transform="matrix\(-1 0 0 1 /);
    expect(svg).toMatch(/<image[^>]*width="200"/);
  });

  it("keeps the full matrix for rotated image fills", () => {
    const s = Math.SQRT1_2;
    const rect = base(31, "rotated", "RECTANGLE", {
      ...imageFill,
      width: 100,
      height: 100,
      transform: { m00: s, m01: -s, m02: 50, m10: s, m11: s, m12: 0 },
    });
    const { svg } = renderScreen(rect, images, [], { includeImages: true });
    expect(svg).toMatch(/<image[^>]*transform="matrix\(/);
    expect(svg).toMatch(/<image[^>]*width="100"/);
  });
});

describe("blur effects", () => {
  it("applies layer blur (FOREGROUND_BLUR) as a gaussian filter", () => {
    const rect = base(40, "blurred", "RECTANGLE", {
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
      effects: [{ type: "FOREGROUND_BLUR", visible: true, radius: 20 }],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).toContain('<feGaussianBlur stdDeviation="10" />');
    expect(svg).toMatch(/<g filter="url\(#blur-\d+\)">/);
  });

  it("ignores background blur (no backdrop-filter in SVG) but keeps the fill", () => {
    const rect = base(41, "glass", "RECTANGLE", {
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.5 }, visible: true }],
      effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 20 }],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).not.toContain("feGaussianBlur");
    expect(svg).toContain("rgba(255, 255, 255, 0.50)");
  });
});

describe("effect and gradient composition", () => {
  it("chains layer blur with drop shadow", () => {
    const rect = base(42, "blur-shadow", "RECTANGLE", {
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
      effects: [
        { type: "FOREGROUND_BLUR", visible: true, radius: 20 },
        { type: "DROP_SHADOW", visible: true, radius: 4, offset: { x: 0, y: 2 }, color: { r: 0, g: 0, b: 0, a: 0.25 } },
      ],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).toContain("feGaussianBlur");
    expect(svg).toContain("feDropShadow");
  });

  it("does not crash on non-string paint types", () => {
    const rect = base(45, "weird-paint", "RECTANGLE", {
      fills: [{ type: 1, visible: true } as unknown as Record<string, unknown>],
    });
    expect(() => renderScreen(rect, undefined, [])).not.toThrow();
  });

  it("keeps shadow spread when chained with layer blur", () => {
    const rect = base(44, "blur-spread", "RECTANGLE", {
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
      effects: [
        { type: "FOREGROUND_BLUR", visible: true, radius: 20 },
        { type: "DROP_SHADOW", visible: true, radius: 4, spread: 6, offset: { x: 0, y: 2 }, color: { r: 0, g: 0, b: 0, a: 0.25 } },
      ],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).toContain("feGaussianBlur");
    expect(svg).toContain('<feMorphology in="blurred" operator="dilate" radius="6"');
  });

  it("rotated gradients follow the node transform via userSpaceOnUse", () => {
    const s = Math.SQRT1_2;
    const rect = base(43, "rot-grad", "RECTANGLE", {
      width: 100,
      height: 100,
      transform: { m00: s, m01: -s, m02: 100, m10: s, m11: s, m12: 0 },
      fills: [{
        type: "GRADIENT_LINEAR",
        visible: true,
        stops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
      }],
    });
    const { svg } = renderScreen(rect, undefined, []);
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
    // rotation components present in the gradient transform
    expect(svg).toMatch(/gradientTransform="matrix\(70\.710\d+ 70\.710\d+/);
  });
});
