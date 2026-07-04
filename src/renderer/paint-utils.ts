/**
 * Paint handling utilities for SVG rendering
 */

import type { FigNode, Paint, GradientStop } from "../parser/types.js";
import { colorToCSS } from "../parser/layout-inference.js";
import type { RenderContext, TransformMatrix } from "./render-types.js";
import { invertTransform, multiplyTransforms } from "./render-utils.js";

/**
 * Get paints array from a node (handles both 'fills'/'strokes' and 'fillPaints'/'strokePaints').
 */
export function getPaints(node: FigNode, key: "fills" | "strokes"): Paint[] | undefined {
  const record = node as unknown as Record<string, unknown>;
  const paints = record[key] ?? record[key === "fills" ? "fillPaints" : "strokePaints"];
  return Array.isArray(paints) ? (paints as Paint[]) : undefined;
}

/**
 * Get the first visible paint from an array.
 */
export function getVisiblePaint(paints: Paint[] | undefined): Paint | undefined {
  if (!paints) return undefined;
  return paints.find((p) => p.visible !== false);
}

/**
 * Convert a paint to a CSS color string.
 * Returns undefined if the paint is not visible or not a solid color.
 */
export function paintToColor(paint: Paint | undefined): string | undefined {
  if (!paint || paint.visible === false) return undefined;
  if (paint.type === "SOLID" && paint.color) {
    const opacity = paint.opacity ?? 1;
    const color = { ...paint.color, a: paint.color.a * opacity };
    return colorToCSS(color);
  }
  // Gradient fallback for consumers that can only use a flat color
  // (text fills, mask shapes): approximate with the first stop.
  const stops = getGradientStops(paint);
  if (stops?.length) {
    const opacity = paint.opacity ?? 1;
    const color = { ...stops[0].color, a: (stops[0].color.a ?? 1) * opacity };
    return colorToCSS(color);
  }
  return undefined;
}

function getGradientStops(paint: Paint): GradientStop[] | undefined {
  // paint.type may decode as a non-string (numeric enum) in some schemas
  if (typeof paint.type !== "string" || !paint.type.startsWith("GRADIENT")) return undefined;
  const stops = paint.stops ?? paint.gradientStops;
  return Array.isArray(stops) && stops.length > 0 ? stops : undefined;
}

/**
 * Convert a paint to an SVG fill value: a plain color for SOLID paints, or
 * a url(#…) reference for gradients (the gradient definition is pushed into
 * ctx.defs). Figma's paint transform maps normalized shape space to gradient
 * space, so the SVG gradient carries its inverse and objectBoundingBox units.
 */
export function paintToSvgFill(
  paint: Paint | undefined,
  ctx: RenderContext | undefined,
  shape?: { transform: TransformMatrix; width: number; height: number },
): string | undefined {
  if (!paint || paint.visible === false) return undefined;
  if (paint.type === "SOLID") return paintToColor(paint);

  const stops = getGradientStops(paint);
  if (!stops || !ctx) return paintToColor(paint);

  const rawT = paint.transform ?? paint.gradientTransform;
  const shapeToGradient: TransformMatrix = rawT
    ? { a: rawT.m00, b: rawT.m10, c: rawT.m01, d: rawT.m11, e: rawT.m02, f: rawT.m12 }
    : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const gradientToShape = invertTransform(shapeToGradient);
  if (!gradientToShape) return paintToColor(paint);

  const paintOpacity = paint.opacity ?? 1;
  const stopsSvg = stops
    .map((stop) => {
      const c = stop.color;
      const rgb = `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
      const alpha = (c.a ?? 1) * paintOpacity;
      const opacityAttr = alpha < 1 ? ` stop-opacity="${alpha.toFixed(3)}"` : "";
      return `<stop offset="${stop.position}" stop-color="${rgb}"${opacityAttr} />`;
    })
    .join("");

  const id = `grad-${ctx.shadowCounter++}`;

  // With the shape's world transform available, express the gradient in
  // user space: world = shapeTransform ∘ scale(w,h) maps normalized shape
  // space to user space, so the gradient follows rotated/skewed nodes.
  // objectBoundingBox would use the axis-aligned bbox and drift under
  // rotation (geometry is emitted in absolute coordinates).
  let units: string;
  let finalT: TransformMatrix;
  if (shape && shape.width > 0 && shape.height > 0) {
    units = "userSpaceOnUse";
    const normalizedToUser = multiplyTransforms(shape.transform, {
      a: shape.width,
      b: 0,
      c: 0,
      d: shape.height,
      e: 0,
      f: 0,
    });
    finalT = multiplyTransforms(normalizedToUser, gradientToShape);
  } else {
    units = "objectBoundingBox";
    finalT = gradientToShape;
  }
  const gt = `gradientTransform="matrix(${finalT.a} ${finalT.b} ${finalT.c} ${finalT.d} ${finalT.e} ${finalT.f})"`;

  if (paint.type === "GRADIENT_RADIAL" || paint.type === "GRADIENT_DIAMOND") {
    ctx.defs.push(
      `<radialGradient id="${id}" gradientUnits="${units}" cx="0.5" cy="0.5" r="0.5" ${gt}>${stopsSvg}</radialGradient>`,
    );
  } else {
    // GRADIENT_LINEAR (and GRADIENT_ANGULAR approximated as linear):
    // the gradient axis runs from (0, 0.5) to (1, 0.5) in gradient space
    ctx.defs.push(
      `<linearGradient id="${id}" gradientUnits="${units}" x1="0" y1="0.5" x2="1" y2="0.5" ${gt}>${stopsSvg}</linearGradient>`,
    );
  }
  return `url(#${id})`;
}

/**
 * Normalize an image hash from various formats to a hex string.
 * Handles: string, array of bytes, object with hash property, or object with numeric keys.
 */
export function normalizeImageHash(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.toLowerCase();

  if (Array.isArray(value) && value.length === 20) {
    const bytes = value.filter((b) => typeof b === "number") as number[];
    if (bytes.length === 20) {
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj["hash"] && typeof obj["hash"] === "object") {
      const bytes = obj["hash"] as Record<string, number>;
      return Object.keys(bytes)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => bytes[key].toString(16).padStart(2, "0"))
        .join("");
    }

    const hasByteKeys = Object.keys(obj).some((key) => /^\d+$/.test(key));
    if (hasByteKeys) {
      const bytes = obj as Record<string, number>;
      return Object.keys(bytes)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => bytes[key].toString(16).padStart(2, "0"))
        .join("");
    }
  }

  return null;
}

/**
 * Extract image hash from a paint object.
 */
export function paintToImageHash(paint: Paint | undefined): string | null {
  if (!paint) return null;
  const record = paint as unknown as Record<string, unknown>;
  return normalizeImageHash(record["image"]) ?? normalizeImageHash(record["imageHash"]);
}

/**
 * Detect image format from binary data.
 */
export function detectImageFormat(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xd8) return "jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "gif";
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return "webp";
  return "unknown";
}

/**
 * Get MIME type for image format.
 */
export function getMimeType(format: string): string {
  switch (format) {
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
}
