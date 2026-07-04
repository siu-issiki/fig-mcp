/**
 * Render Screen - Improved vector rendering
 *
 * Key improvements:
 * 1. For stroked vectors: Use vectorNetworkBlob or normalizedSize to get centerline, NOT strokeGeometry
 * 2. strokeGeometry contains pre-outlined stroke - only use as fallback
 * 3. Proper transform composition for rotated/positioned vectors
 * 4. Better detection of stroked vs filled vectors
 * 5. Mask rendering support (isMask flag handling)
 * 6. Image embedding support
 * 7. Full text styling (font-style, letter-spacing, etc.)
 */

import type {
  FigNode,
  SceneNode,
  TextStyle,
  Paint,
  DerivedTextData,
  Effect,
  Color,
  GUID,
} from "../parser/types.js";
import { formatGUID } from "../parser/kiwi-parser.js";
import { extractInstanceContent, resolveInstanceChildren, type ResolvedInstanceContent } from "../parser/instance-resolver.js";
import type {
  TransformMatrix,
  BlobEntry,
  RenderContext,
  RenderScreenOptions,
  RenderScreenResult,
} from "./render-types.js";
import { DEFAULT_RENDER_OPTIONS, IDENTITY_TRANSFORM } from "./render-types.js";
import {
  escapeXml,
  multiplyTransforms,
  getLocalTransform,
  transformPoint,
} from "./render-utils.js";
import {
  getPaints,
  getVisiblePaint,
  paintToColor,
  paintToSvgFill,
  paintToImageHash,
  detectImageFormat,
  getMimeType,
} from "./paint-utils.js";
import {
  isStrokedVector,
  renderStrokedVector,
  renderFilledVector,
  renderStrokeGeometryFill,
  buildCenterlinePathD,
  decodePathCommands,
} from "./vector-renderer.js";
import { buildSvgPath } from "./render-utils.js";

// Re-export types for external consumers
export type {
  RenderScreenOptions,
  RenderScreenResult,
} from "./render-types.js";

// ============================================================================
// Shadow/Effect Rendering
// ============================================================================

/**
 * Convert a color to an rgba() string for SVG
 */
function colorToRgba(color: Color | undefined): string {
  if (!color) return "rgba(0,0,0,0.25)";
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a ?? 1;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/**
 * Generate an SVG filter definition for a drop shadow effect.
 * Returns the filter ID.
 */
function generateDropShadowFilter(
  effect: Effect,
  ctx: RenderContext,
): string {
  const filterId = `shadow-${ctx.shadowCounter++}`;
  const x = effect.offset?.x ?? 0;
  const y = effect.offset?.y ?? 0;
  const blur = effect.radius ?? 0;
  const spread = effect.spread ?? 0;
  const color = colorToRgba(effect.color);

  // For SVG, we use feDropShadow or a combination of feGaussianBlur + feOffset + feFlood
  // feDropShadow is simpler but has less control over spread
  // We'll use a more complex filter to support spread

  if (spread === 0) {
    // Simple drop shadow without spread
    ctx.defs.push(
      `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feDropShadow dx="${x}" dy="${y}" stdDeviation="${blur / 2}" flood-color="${color}" />` +
      `</filter>`
    );
  } else {
    // Drop shadow with spread - use morphology to expand/contract
    // stdDeviation is blur/2 because SVG blur is roughly 2x CSS blur
    const stdDev = blur / 2;
    ctx.defs.push(
      `<filter id="${filterId}" x="-100%" y="-100%" width="300%" height="300%">` +
      // Create the shadow
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${stdDev}" result="blur" />` +
      // Apply spread using morphology (dilate for positive, erode for negative)
      (spread !== 0
        ? `<feMorphology in="blur" operator="${spread > 0 ? 'dilate' : 'erode'}" radius="${Math.abs(spread)}" result="spread" />`
        : `<feOffset in="blur" result="spread" />`) +
      // Offset the shadow
      `<feOffset in="spread" dx="${x}" dy="${y}" result="offsetBlur" />` +
      // Color the shadow
      `<feFlood flood-color="${color}" result="color" />` +
      `<feComposite in="color" in2="offsetBlur" operator="in" result="shadow" />` +
      // Merge with original
      `<feMerge>` +
      `<feMergeNode in="shadow" />` +
      `<feMergeNode in="SourceGraphic" />` +
      `</feMerge>` +
      `</filter>`
    );
  }

  return filterId;
}

/**
 * Generate an SVG filter definition for an inner shadow effect.
 * Returns the filter ID.
 */
function generateInnerShadowFilter(
  effect: Effect,
  ctx: RenderContext,
): string {
  const filterId = `inner-shadow-${ctx.shadowCounter++}`;
  const x = effect.offset?.x ?? 0;
  const y = effect.offset?.y ?? 0;
  const blur = effect.radius ?? 0;
  const color = colorToRgba(effect.color);
  const stdDev = blur / 2;

  // Inner shadow is created by:
  // 1. Invert the alpha of the source
  // 2. Apply blur and offset
  // 3. Clip to original shape
  ctx.defs.push(
    `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">` +
    // Invert the source alpha to get the "outside" shape
    `<feComponentTransfer in="SourceAlpha" result="inverse">` +
    `<feFuncA type="table" tableValues="1 0" />` +
    `</feComponentTransfer>` +
    // Blur the inverted shape
    `<feGaussianBlur in="inverse" stdDeviation="${stdDev}" result="blur" />` +
    // Offset the blur
    `<feOffset in="blur" dx="${x}" dy="${y}" result="offsetBlur" />` +
    // Color the shadow
    `<feFlood flood-color="${color}" result="color" />` +
    `<feComposite in="color" in2="offsetBlur" operator="in" result="shadow" />` +
    // Clip to original shape
    `<feComposite in="shadow" in2="SourceAlpha" operator="in" result="innerShadow" />` +
    // Merge with original
    `<feMerge>` +
    `<feMergeNode in="SourceGraphic" />` +
    `<feMergeNode in="innerShadow" />` +
    `</feMerge>` +
    `</filter>`
  );

  return filterId;
}

/**
 * Generate SVG filter(s) for a node's effects.
 * Returns the filter ID to apply, or undefined if no filters needed.
 */
function generateEffectFilters(
  node: SceneNode,
  ctx: RenderContext,
  includeShadows: boolean,
): string | undefined {
  if (!includeShadows || !node.effects || node.effects.length === 0) {
    return undefined;
  }

  // Collect visible effects
  const dropShadows = node.effects.filter(
    (e) => e.type === "DROP_SHADOW" && e.visible !== false
  );
  const innerShadows = node.effects.filter(
    (e) => e.type === "INNER_SHADOW" && e.visible !== false
  );
  // Layer blur ("FOREGROUND_BLUR" in the kiwi schema) blurs the node itself.
  // BACKGROUND_BLUR/GLASS blur what is BEHIND the node, which SVG cannot
  // express in a single pass; their translucent fill still renders.
  const layerBlurs = node.effects.filter(
    (e) =>
      (e.type === "FOREGROUND_BLUR" || e.type === "LAYER_BLUR") &&
      e.visible !== false &&
      (e.radius ?? 0) > 0
  );

  if (layerBlurs.length > 0) {
    const filterId = `blur-${ctx.shadowCounter++}`;
    const stdDev = (layerBlurs[0].radius ?? 0) / 2;
    if (dropShadows.length > 0) {
      // Chain: blur the node, then drop-shadow the blurred result, so
      // blur + shadow layers keep both effects.
      const e = dropShadows[0];
      const spread = e.spread ?? 0;
      const shadowStd = (e.radius ?? 0) / 2;
      const dx = e.offset?.x ?? 0;
      const dy = e.offset?.y ?? 0;
      const shadowChain =
        spread === 0
          ? `<feDropShadow in="blurred" dx="${dx}" dy="${dy}" stdDeviation="${shadowStd}" flood-color="${colorToRgba(e.color)}" />`
          : // Same morphology-based spread handling as the shadow-only path,
            // but fed from the blurred source instead of SourceAlpha.
            `<feMorphology in="blurred" operator="${spread > 0 ? "dilate" : "erode"}" radius="${Math.abs(spread)}" result="spreaded" />` +
            `<feGaussianBlur in="spreaded" stdDeviation="${shadowStd}" result="shadowBlur" />` +
            `<feOffset in="shadowBlur" dx="${dx}" dy="${dy}" result="offsetBlur" />` +
            `<feFlood flood-color="${colorToRgba(e.color)}" result="color" />` +
            `<feComposite in="color" in2="offsetBlur" operator="in" result="shadow" />` +
            `<feMerge><feMergeNode in="shadow" /><feMergeNode in="blurred" /></feMerge>`;
      ctx.defs.push(
        `<filter id="${filterId}" x="-100%" y="-100%" width="300%" height="300%">` +
          `<feGaussianBlur in="SourceGraphic" stdDeviation="${stdDev}" result="blurred" />` +
          shadowChain +
          `</filter>`
      );
      return filterId;
    }
    // Inner shadow + layer blur is not composed; the blur dominates visually.
    ctx.defs.push(
      `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feGaussianBlur stdDeviation="${stdDev}" />` +
        `</filter>`
    );
    return filterId;
  }

  if (dropShadows.length === 0 && innerShadows.length === 0) {
    return undefined;
  }

  // For simplicity, we'll handle the first drop shadow and first inner shadow
  // A more complete implementation would combine multiple effects
  if (dropShadows.length > 0) {
    return generateDropShadowFilter(dropShadows[0], ctx);
  }
  if (innerShadows.length > 0) {
    return generateInnerShadowFilter(innerShadows[0], ctx);
  }

  return undefined;
}

// ============================================================================
// Text Rendering
// ============================================================================

/** Apply Figma textCase to a string */
function applyTextCase(value: string, textCase: string | undefined): string {
  switch (textCase) {
    case "UPPER":
      return value.toUpperCase();
    case "LOWER":
      return value.toLowerCase();
    case "TITLE":
      return value.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
    default:
      return value;
  }
}

/**
 * Build a font-family attribute value with an optional fallback from fontMap.
 * Family names are deliberately NOT quoted: resvg's font-family list parser
 * does not strip quotes, so a quoted fallback never matches. Unquoted names
 * with spaces are valid CSS and resolve correctly.
 */
function buildFontFamilyValue(
  family: string,
  fontMap: Record<string, string> | undefined,
): string {
  const fallback = fontMap?.[family];
  return fallback && fallback !== family
    ? `${escapeXml(family)}, ${escapeXml(fallback)}`
    : escapeXml(family);
}

/**
 * Render text from the glyph outlines embedded in the file
 * (derivedTextData.glyphs). This reproduces the exact letterforms of the
 * original font without needing it installed. Returns false when no usable
 * glyph data exists so callers can fall back to <text> rendering.
 */
function renderTextGlyphs(
  node: SceneNode,
  transform: TransformMatrix,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
  output: string[],
): boolean {
  const glyphs = node.derivedTextData?.glyphs;
  if (!glyphs?.length || !blobs?.length) return false;

  const fills = getPaints(node as FigNode, "fills");
  const fillColor = paintToColor(getVisiblePaint(fills)) ?? "#000";

  const paths: string[] = [];
  for (const glyph of glyphs) {
    if (typeof glyph.commandsBlob !== "number" || !glyph.position) continue;
    const commands = decodePathCommands(glyph.commandsBlob, blobs, ctx);
    if (!commands) continue;

    const fontSize = glyph.fontSize ?? 12;
    // Glyph outlines are in em units, y-up from the baseline: scale by
    // fontSize with a y-flip, optionally rotate, then move to the baseline
    // position (multiplyTransforms applies the child transform first).
    let local: TransformMatrix = {
      a: fontSize,
      b: 0,
      c: 0,
      d: -fontSize,
      e: glyph.position.x,
      f: glyph.position.y,
    };
    if (glyph.rotation) {
      const cos = Math.cos(glyph.rotation);
      const sin = Math.sin(glyph.rotation);
      local = multiplyTransforms(
        { a: cos, b: sin, c: -sin, d: cos, e: glyph.position.x, f: glyph.position.y },
        { a: fontSize, b: 0, c: 0, d: -fontSize, e: 0, f: 0 },
      );
    }
    const pathD = buildSvgPath(commands, multiplyTransforms(transform, local));
    if (pathD) paths.push(pathD);
  }

  if (paths.length === 0) return false;

  const opacityAttr =
    node.opacity !== undefined && node.opacity < 1 ? ` opacity="${node.opacity}"` : "";
  output.push(
    `<g fill="${fillColor}" fill-rule="nonzero"${opacityAttr}>` +
      paths.map((d) => `<path d="${d}" />`).join("") +
      `</g>`,
  );
  return true;
}

function renderText(
  node: SceneNode,
  transform: TransformMatrix,
  output: string[],
  ctx: RenderContext,
  fontMap?: Record<string, string>,
  blobs?: BlobEntry[],
): boolean {
  // Prefer embedded glyph outlines: exact letterforms without the font
  if (renderTextGlyphs(node, transform, blobs, ctx, output)) {
    return true;
  }

  const text = node.characters;
  if (!text) return false;

  const fills = getPaints(node as FigNode, "fills");
  const fillColor = paintToColor(getVisiblePaint(fills)) ?? "#000";

  const style = node.style as TextStyle | undefined;
  const fontSize = style?.fontSize ?? 14;
  const rawFamily = style?.fontFamily ?? "Inter";
  const fontFamily = buildFontFamilyValue(rawFamily, fontMap);
  const fontWeight = style?.fontWeight ?? 400;
  const fontStyle = style?.fontStyle ?? "normal";
  const defaultLineHeight = style?.lineHeightPx ?? fontSize * 1.2;
  const letterSpacing = style?.letterSpacing ?? 0;
  const textCase = (style as { textCase?: string } | undefined)?.textCase;

  ctx.usedFonts.add(`${rawFamily}|${fontWeight}|${fontStyle}`);
  // Fallback families must also be resolvable to font files for the PNG pass
  const mappedFamily = fontMap?.[rawFamily];
  if (mappedFamily && mappedFamily !== rawFamily) {
    ctx.usedFonts.add(`${mappedFamily}|${fontWeight}|${fontStyle}`);
  }

  // Pure translations keep absolute coordinates. Rotated/scaled text uses
  // local coordinates and carries the full matrix in a transform attribute
  // so the rotation is preserved (e.g. vertical ticket-stub text).
  const isTranslationOnly =
    Math.abs(transform.b) < 1e-6 &&
    Math.abs(transform.c) < 1e-6 &&
    Math.abs(transform.a - 1) < 1e-6 &&
    Math.abs(transform.d - 1) < 1e-6;
  const pos = isTranslationOnly ? transformPoint(0, 0, transform) : { x: 0, y: 0 };

  // Handle text alignment
  const anchor = style?.textAlignHorizontal?.toLowerCase() ?? "left";
  const textAnchor =
    anchor === "center" ? "middle" : anchor === "right" ? "end" : "start";
  const width = node.width ?? 0;
  const baseX =
    textAnchor === "middle"
      ? pos.x + width / 2
      : textAnchor === "end"
        ? pos.x + width
        : pos.x;

  const attrs: string[] = [
    `x="${baseX}"`,
    `y="${pos.y}"`,
    `font-family="${fontFamily}"`,
    `font-size="${fontSize}"`,
    `font-weight="${fontWeight}"`,
    `font-style="${fontStyle}"`,
    `fill="${fillColor}"`,
    `dominant-baseline="text-before-edge"`,
    `text-anchor="${textAnchor}"`,
  ];

  if (!isTranslationOnly) {
    attrs.push(
      `transform="matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})"`,
    );
  }

  if (letterSpacing !== 0) {
    attrs.push(`letter-spacing="${letterSpacing}"`);
  }

  if (node.opacity !== undefined && node.opacity < 1) {
    attrs.push(`opacity="${node.opacity}"`);
  }

  if (style?.fontPostScriptName) {
    attrs.push(`data-postscript="${escapeXml(style.fontPostScriptName)}"`);
  }

  // Use derivedTextData.baselines for wrapped text if available
  const derivedTextData = node.derivedTextData as DerivedTextData | undefined;
  let spans: string;

  if (derivedTextData?.baselines && derivedTextData.baselines.length > 0) {
    // Use baselines for proper text wrapping
    spans = derivedTextData.baselines
      .map((baseline, index) => {
        // Extract the substring for this line
        const lineText = text.substring(
          baseline.firstCharacter,
          baseline.endCharacter,
        );
        const safeLineText = escapeXml(applyTextCase(lineText.trim(), textCase)); // Trim to remove trailing spaces/newlines

        if (index === 0) {
          return `<tspan x="${baseX}" dy="0">${safeLineText}</tspan>`;
        } else {
          // Use lineHeight for spacing between lines
          const dy = baseline.lineHeight;
          return `<tspan x="${baseX}" dy="${dy}">${safeLineText}</tspan>`;
        }
      })
      .join("");
  } else {
    // Fallback: split by newlines (for text with explicit line breaks)
    const safeText = escapeXml(applyTextCase(text, textCase));
    const lines = safeText.split(/\r?\n/);
    spans = lines
      .map((line, index) => {
        const dy = index === 0 ? 0 : defaultLineHeight;
        return `<tspan x="${baseX}" dy="${dy}">${line}</tspan>`;
      })
      .join("");
  }

  output.push(`<text ${attrs.join(" ")}>${spans}</text>`);
  return true;
}

/**
 * Render a TEXT_PATH node (text laid out along a vector path, e.g. circular
 * stamp text) using an SVG <textPath>.
 */
function renderTextPath(
  node: SceneNode,
  transform: TransformMatrix,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
  output: string[],
  fontMap?: Record<string, string>,
): boolean {
  const text = node.characters;
  if (!text) return false;

  // Embedded glyph outlines carry per-glyph rotation and reproduce the
  // exact circular layout (including reversed arcs) without the font.
  if (renderTextGlyphs(node, transform, blobs, ctx, output)) {
    return true;
  }

  const pathD = buildCenterlinePathD(node, transform, blobs, ctx);
  if (!pathD) return false;

  const fills = getPaints(node as FigNode, "fills");
  const fillColor = paintToColor(getVisiblePaint(fills)) ?? "#000";

  const style = node.style as TextStyle | undefined;
  const fontSize = style?.fontSize ?? 12;
  const rawFamily = style?.fontFamily ?? "Inter";
  const fontWeight = style?.fontWeight ?? 400;
  const fontStyle = style?.fontStyle ?? "normal";
  const textCase = (style as { textCase?: string } | undefined)?.textCase;
  ctx.usedFonts.add(`${rawFamily}|${fontWeight}|${fontStyle}`);
  // Fallback families must also be resolvable to font files for the PNG pass
  const mappedPathFamily = fontMap?.[rawFamily];
  if (mappedPathFamily && mappedPathFamily !== rawFamily) {
    ctx.usedFonts.add(`${mappedPathFamily}|${fontWeight}|${fontStyle}`);
  }

  const pathId = `textpath-${ctx.clipCounter++}`;
  ctx.defs.push(`<path id="${pathId}" d="${pathD}" fill="none" />`);

  // Known limitation: textPathStart.forward (reversed path direction) is
  // not applied — SVG textPath cannot flip direction without reversing the
  // path itself, so reversed circular text renders mirrored along the arc.
  const tValue = node.textPathStart?.tValue ?? 0;
  const startOffset = `${Math.round((((tValue % 1) + 1) % 1) * 100)}%`;

  const attrs = [
    `font-family="${buildFontFamilyValue(rawFamily, fontMap)}"`,
    `font-size="${fontSize}"`,
    `font-weight="${fontWeight}"`,
    `font-style="${fontStyle}"`,
    `fill="${fillColor}"`,
  ];
  if (node.opacity !== undefined && node.opacity < 1) {
    attrs.push(`opacity="${node.opacity}"`);
  }

  const content = escapeXml(applyTextCase(text, textCase));
  output.push(
    `<text ${attrs.join(" ")}><textPath href="#${pathId}" startOffset="${startOffset}">${content}</textPath></text>`,
  );
  return true;
}

// ============================================================================
// Rectangle Rendering
// ============================================================================

function renderRectangle(
  node: SceneNode,
  transform: TransformMatrix,
  images: Map<string, Uint8Array> | undefined,
  includeImages: boolean,
  output: string[],
  includeFills = true,
  includeStrokes = true,
  ctx?: RenderContext,
): boolean {
  // Fills are always read so image paints stay renderable when
  // includeImages is on but includeFills is off; only the solid fill
  // colour is gated by includeFills.
  const fills = getPaints(node as FigNode, "fills");
  const strokes = includeStrokes ? getPaints(node as FigNode, "strokes") : undefined;
  const fillPaint = getVisiblePaint(fills);
  const gradientShape = {
    transform,
    width: node.width ?? 0,
    height: node.height ?? 0,
  };
  const fillColor = includeFills ? paintToSvgFill(fillPaint, ctx, gradientShape) : undefined;
  const strokeColor = paintToSvgFill(getVisiblePaint(strokes), ctx, gradientShape);

  // Check for image fill
  let hasImageFill = false;
  if (includeImages && fillPaint?.type === "IMAGE" && images) {
    const hash = paintToImageHash(fillPaint);
    const imageData = hash ? images.get(hash) : undefined;
    if (imageData) {
      hasImageFill = true;
      const format = detectImageFormat(imageData);
      const mimeType = getMimeType(format);
      const base64 = Buffer.from(imageData).toString("base64");

      const scaleMode =
        (fillPaint as unknown as { imageScaleMode?: string }).imageScaleMode ??
        fillPaint.scaleMode;
      const preserve =
        scaleMode === "FIT"
          ? "xMidYMid meet"
          : scaleMode === "STRETCH"
            ? "none"
            : "xMidYMid slice";

      const imgW = node.width ?? 0;
      const imgH = node.height ?? 0;
      const isAxisAlignedImage =
        Math.abs(transform.b) < 0.01 && Math.abs(transform.c) < 0.01;

      const attrs: string[] = [
        `preserveAspectRatio="${preserve}"`,
        `href="data:${mimeType};base64,${base64}"`,
      ];
      if (isAxisAlignedImage) {
        // Transform both corners so mirrored nodes (negative scale, e.g.
        // horizontally flipped images) render at their real bounds instead
        // of extending away from the anchor. The mirroring itself is not
        // applied to the pixels; position/size fidelity matters more here.
        const c0 = transformPoint(0, 0, transform);
        const c1 = transformPoint(imgW, imgH, transform);
        attrs.push(
          `x="${Math.min(c0.x, c1.x)}"`,
          `y="${Math.min(c0.y, c1.y)}"`,
          `width="${Math.abs(c1.x - c0.x)}"`,
          `height="${Math.abs(c1.y - c0.y)}"`,
        );
      } else {
        // Rotated/skewed: keep local coordinates and carry the full matrix
        attrs.push(
          `x="0"`,
          `y="0"`,
          `width="${imgW}"`,
          `height="${imgH}"`,
          `transform="matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})"`,
        );
      }

      if (node.opacity !== undefined && node.opacity < 1) {
        attrs.push(`opacity="${node.opacity}"`);
      }

      output.push(`<image ${attrs.join(" ")} />`);
    }
  }

  if (hasImageFill) return true;
  if (!fillColor && !strokeColor) return false;

  const width = node.width ?? 0;
  const height = node.height ?? 0;

  // Transform the four corners
  const p0 = transformPoint(0, 0, transform);
  const p1 = transformPoint(width, 0, transform);
  const p2 = transformPoint(width, height, transform);
  const p3 = transformPoint(0, height, transform);

  // Check if it's still axis-aligned (no rotation)
  const isAxisAligned =
    Math.abs(p0.y - p1.y) < 0.01 && Math.abs(p1.x - p2.x) < 0.01;

  if (isAxisAligned) {
    // min/abs so mirrored (negative-scale) nodes keep their real bounds
    const attrs: string[] = [
      `x="${Math.min(p0.x, p2.x)}"`,
      `y="${Math.min(p0.y, p2.y)}"`,
      `width="${Math.abs(p2.x - p0.x)}"`,
      `height="${Math.abs(p2.y - p0.y)}"`,
    ];

    if (fillColor) attrs.push(`fill="${fillColor}"`);
    else attrs.push(`fill="none"`);

    if (strokeColor) {
      attrs.push(`stroke="${strokeColor}"`);
      attrs.push(`stroke-width="${node.strokeWeight ?? 1}"`);
      if (node.strokeDashes?.length) {
        attrs.push(`stroke-dasharray="${node.strokeDashes.join(" ")}"`);
      }
    }

    const cornerRadius =
      typeof node.cornerRadius === "number" ? node.cornerRadius : undefined;
    if (cornerRadius) {
      // Clamp to ensure circular arcs (not elliptical)
      // SVG clamps rx/ry independently which creates elliptical corners
      // when cornerRadius > min(width, height)/2, producing a tapered "football" shape.
      // By clamping ourselves, we ensure proper pill/stadium shapes.
      const maxRadius = Math.min(Math.abs(p2.x - p0.x), Math.abs(p2.y - p0.y)) / 2;
      const clampedRadius = Math.min(cornerRadius, maxRadius);
      attrs.push(`rx="${clampedRadius}"`);
      attrs.push(`ry="${clampedRadius}"`);
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      attrs.push(`opacity="${node.opacity}"`);
    }

    output.push(`<rect ${attrs.join(" ")} />`);
  } else {
    // Rotated - use path
    const pathD = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`;

    const attrs: string[] = [`d="${pathD}"`];
    if (fillColor) attrs.push(`fill="${fillColor}"`);
    else attrs.push(`fill="none"`);
    if (strokeColor) {
      attrs.push(`stroke="${strokeColor}"`);
      attrs.push(`stroke-width="${node.strokeWeight ?? 1}"`);
      if (node.strokeDashes?.length) {
        attrs.push(`stroke-dasharray="${node.strokeDashes.join(" ")}"`);
      }
    }
    if (node.opacity !== undefined && node.opacity < 1) {
      attrs.push(`opacity="${node.opacity}"`);
    }

    output.push(`<path ${attrs.join(" ")} />`);
  }

  return true;
}

// ============================================================================
// Main Node Rendering
// ============================================================================

const VECTOR_TYPES = new Set([
  "VECTOR",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "ELLIPSE",
  "BOOLEAN_OPERATION",
]);
const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "COMPONENT", "INSTANCE", "SYMBOL"]);

/**
 * Render a mask node to create a clipPath definition.
 * Returns the clip path content for the mask.
 */
function renderMaskContent(
  node: SceneNode,
  transform: TransformMatrix,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
): string {
  const maskOutput: string[] = [];
  const width = node.width ?? 0;
  const height = node.height ?? 0;

  // Try to render the mask using vector geometry if available
  if (node.fillGeometry?.length) {
    const tempOutput: string[] = [];
    const rendered = renderFilledVector(
      node,
      transform,
      blobs,
      ctx,
      tempOutput,
    );
    if (rendered && tempOutput.length > 0) {
      // Convert fill to white for mask
      return tempOutput.join("").replace(/fill="[^"]*"/g, 'fill="white"');
    }
  }

  // Fallback to simple rectangle
  const pos = transformPoint(0, 0, transform);
  return `<rect x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" fill="white" />`;
}

// ============================================================================
// Instance Content Rendering
// ============================================================================

/**
 * Convert Color to CSS rgba string
 */
function colorToCss(color: Color | undefined): string | undefined {
  if (!color) return undefined;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a ?? 1;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/**
 * Render content extracted from an INSTANCE's symbolOverrides.
 * This renders text and visual elements based on the override data.
 */
function renderInstanceContent(
  resolved: ResolvedInstanceContent,
  transform: TransformMatrix,
  options: ResolvedOptions,
  output: string[],
): boolean {
  const instance = resolved.instance as SceneNode;
  const width = instance.width ?? 0;
  const height = instance.height ?? 0;

  if (width === 0 || height === 0) return false;

  const pos = transformPoint(0, 0, transform);
  let rendered = false;

  // Render text content from overrides
  // We arrange text vertically within the instance bounds
  if (options.includeText && resolved.textContent.length > 0) {
    let yOffset = 0;
    const lineHeight = 20; // Default line height

    for (const textItem of resolved.textContent) {
      const fillColor = colorToCss(textItem.fillColor) ?? "#fff";
      const fontSize = textItem.fontSize ?? 14;
      const fontFamily = escapeXml(textItem.fontFamily ?? "Inter");

      const textY = pos.y + yOffset + fontSize;

      output.push(
        `<text x="${pos.x}" y="${textY}" ` +
        `font-family="${fontFamily}" font-size="${fontSize}" ` +
        `fill="${fillColor}" dominant-baseline="text-before-edge">` +
        `${escapeXml(textItem.text)}</text>`
      );

      yOffset += lineHeight;
      rendered = true;
    }
  }

  // Render rectangle elements
  if (options.includeFills) {
    for (const el of resolved.elements) {
      if (el.type === "rectangle" && el.fillColor) {
        const elSize = el.size ?? { x: width, y: 30 };
        const fillColor = colorToCss(el.fillColor);
        const strokeColor = el.strokeColor ? colorToCss(el.strokeColor) : undefined;
        const radius = el.cornerRadius ?? 0;

        const attrs: string[] = [
          `x="${pos.x}"`,
          `y="${pos.y}"`,
          `width="${elSize.x}"`,
          `height="${elSize.y}"`,
        ];

        if (fillColor) attrs.push(`fill="${fillColor}"`);
        else attrs.push(`fill="none"`);

        if (strokeColor) {
          attrs.push(`stroke="${strokeColor}"`);
          attrs.push(`stroke-width="1"`);
        }

        if (radius > 0) {
          attrs.push(`rx="${radius}"`);
          attrs.push(`ry="${radius}"`);
        }

        output.push(`<rect ${attrs.join(" ")} />`);
        rendered = true;
      }
    }
  }

  return rendered;
}

type ResolvedOptions = Required<Omit<RenderScreenOptions, 'nodeIndex' | 'rawNodeIndex' | 'fontMap'>> & Pick<RenderScreenOptions, 'nodeIndex' | 'rawNodeIndex' | 'fontMap'>;

function renderNode(
  node: FigNode,
  parentTransform: TransformMatrix,
  depth: number,
  options: ResolvedOptions,
  images: Map<string, Uint8Array> | undefined,
  blobs: BlobEntry[] | undefined,
  ctx: RenderContext,
  output: string[],
): void {
  if (depth > options.maxDepth) return;
  if (node.visible === false) return;

  const sceneNode = node as SceneNode;
  const localTransform = getLocalTransform(sceneNode);
  const worldTransform = multiplyTransforms(parentTransform, localTransform);

  // Generate shadow filter if this node has effects
  const filterId = generateEffectFilters(sceneNode, ctx, options.includeShadows);

  // Use a temporary output array if we need to wrap with a filter
  const nodeOutput: string[] = filterId ? [] : output;
  let rendered = false;

  // Handle different node types
  if (node.type === "TEXT" && options.includeText) {
    rendered = renderText(sceneNode, worldTransform, nodeOutput, ctx, options.fontMap, blobs);
  } else if (node.type === "TEXT_PATH") {
    if (options.includeText) {
      rendered = renderTextPath(sceneNode, worldTransform, blobs, ctx, nodeOutput, options.fontMap);
    }
  } else if (VECTOR_TYPES.has(node.type ?? "")) {
    if (options.includeStrokes && isStrokedVector(sceneNode)) {
      rendered = renderStrokedVector(
        sceneNode,
        worldTransform,
        blobs,
        ctx,
        nodeOutput,
      );
    }
    if (!rendered && options.includeFills) {
      rendered = renderFilledVector(
        sceneNode,
        worldTransform,
        blobs,
        ctx,
        nodeOutput,
      );
    }
  } else if (node.type === "RECTANGLE" || node.type === "ROUNDED_RECTANGLE") {
    if (
      options.includeFills ||
      options.includeStrokes ||
      options.includeImages
    ) {
      rendered = renderRectangle(
        sceneNode,
        worldTransform,
        images,
        options.includeImages,
        nodeOutput,
        options.includeFills,
        options.includeStrokes,
        ctx,
      );
    }
  } else if (CONTAINER_TYPES.has(node.type ?? "")) {
    const hasStrokeGeometry = Boolean(sceneNode.strokeGeometry?.length);
    if (options.includeFills || options.includeImages) {
      const fills = getPaints(node, "fills");
      const fillPaint = getVisiblePaint(fills);
      const fillColor = paintToColor(fillPaint);
      const hasImageFill = fillPaint?.type === "IMAGE";
      if (
        (fillColor || (options.includeImages && hasImageFill)) &&
        sceneNode.width &&
        sceneNode.height
      ) {
        // Strokes are rendered from strokeGeometry below when available
        rendered = renderRectangle(
          sceneNode,
          worldTransform,
          images,
          options.includeImages,
          nodeOutput,
          options.includeFills,
          false,
          ctx,
        );
      }
    }
    if (options.includeStrokes) {
      // Container strokes prefer Figma's precomputed strokeGeometry: it
      // carries dash segments and collapses to nothing for effectively
      // invisible borders, which a synthesized rect outline would get wrong.
      let strokeRendered = false;
      if (hasStrokeGeometry) {
        strokeRendered = renderStrokeGeometryFill(
          sceneNode,
          worldTransform,
          blobs,
          ctx,
          nodeOutput,
        );
      }
      // Fall back to a synthesized rectangular border when there is no
      // usable geometry (missing, or its blobs could not be decoded).
      if (!strokeRendered && sceneNode.width && sceneNode.height) {
        const strokeColor = paintToColor(getVisiblePaint(getPaints(node, "strokes")));
        if (strokeColor) {
          strokeRendered = renderRectangle(
            sceneNode,
            worldTransform,
            images,
            false,
            nodeOutput,
            false,
            true,
            ctx,
          );
        }
      }
      rendered = rendered || strokeRendered;
    }
  }

  // Render children with mask support
  // When we have a filter, children should render to nodeOutput so the filter applies to everything
  const baseOutput = filterId ? nodeOutput : output;

  // For INSTANCE nodes, resolve children from SYMBOL definition
  // The SYMBOL provides proper layout structure; symbolOverrides have values but no positions
  let resolvedChildren: FigNode[] | undefined = node.children as FigNode[] | undefined;
  if (
    node.type === "INSTANCE" &&
    (!node.children || node.children.length === 0) &&
    sceneNode.symbolData?.symbolID &&
    options.nodeIndex
  ) {
    const symbolId = formatGUID(sceneNode.symbolData.symbolID as GUID | null);
    const symbolNode = options.nodeIndex.get(symbolId);
    if (symbolNode?.children) {
      if (options.rawNodeIndex) {
        const resolved = resolveInstanceChildren(node, symbolNode, options.rawNodeIndex, options.nodeIndex);
        if (resolved && resolved.length > 0) {
          resolvedChildren = resolved;
        } else {
          resolvedChildren = symbolNode.children as FigNode[];
        }
      } else {
        resolvedChildren = symbolNode.children as FigNode[];
      }
    }
  }

  // BOOLEAN_OPERATION: when the combined geometry rendered, drawing the
  // operand children too would double-paint. Without geometry, approximate
  // SUBTRACT/INTERSECT/XOR with the base operand only (drawing subtrahends
  // literally paints shapes the operation was meant to remove).
  if (node.type === "BOOLEAN_OPERATION" && resolvedChildren && resolvedChildren.length > 0) {
    if (rendered) {
      resolvedChildren = undefined;
    } else {
      const op = sceneNode.booleanOperation;
      if (op && op !== "UNION") {
        resolvedChildren = [resolvedChildren[0] as FigNode];
      }
    }
  }

  // If no SYMBOL children could be resolved, try rendering extracted instance content
  // This is a fallback that stacks text vertically (not ideal but better than nothing)
  let instanceContentRendered = false;
  if (
    node.type === "INSTANCE" &&
    (!resolvedChildren || resolvedChildren.length === 0) &&
    sceneNode.symbolData?.symbolID &&
    options.rawNodeIndex
  ) {
    const nodeId = formatGUID(node.guid);
    const rawNode = options.rawNodeIndex.get(nodeId);
    if (rawNode) {
      const resolved = extractInstanceContent(node, rawNode);
      if (resolved && (resolved.textContent.length > 0 || resolved.elements.length > 0)) {
        instanceContentRendered = renderInstanceContent(resolved, worldTransform, options, nodeOutput);
      }
    }
  }

  if (resolvedChildren && resolvedChildren.length > 0) {
    const children = resolvedChildren;
    const childOutput: string[] = [];
    const targetOutput = sceneNode.clipsContent ? childOutput : baseOutput;

    let index = 0;
    while (index < children.length) {
      const child = children[index] as FigNode;
      const childScene = child as SceneNode;

      // Handle mask nodes
      if (childScene.isMask) {
        const maskId = `mask-${ctx.clipCounter++}`;
        const childTransform = multiplyTransforms(
          worldTransform,
          getLocalTransform(childScene),
        );

        // Create mask clipPath
        const maskContent = renderMaskContent(
          childScene,
          childTransform,
          blobs,
          ctx,
        );
        ctx.defs.push(
          `<clipPath id="${maskId}" clipPathUnits="userSpaceOnUse">${maskContent}</clipPath>`,
        );

        // Collect all siblings until the next mask
        const groupOutput: string[] = [];
        index += 1;
        while (index < children.length) {
          const sibling = children[index] as FigNode;
          const siblingScene = sibling as SceneNode;
          if (siblingScene.isMask) break;
          renderNode(
            sibling,
            worldTransform,
            depth + 1,
            options,
            images,
            blobs,
            ctx,
            groupOutput,
          );
          index += 1;
        }

        // Wrap masked content in a group with the clip-path
        targetOutput.push(
          `<g clip-path="url(#${maskId})">${groupOutput.join("")}</g>`,
        );
        continue;
      }

      renderNode(
        child,
        worldTransform,
        depth + 1,
        options,
        images,
        blobs,
        ctx,
        targetOutput,
      );
      index += 1;
    }

    // Handle clipping - wrap childOutput in clip-path if needed
    if (sceneNode.clipsContent && sceneNode.width && sceneNode.height) {
      const clipId = `clip-${ctx.clipCounter++}`;
      const p0 = transformPoint(0, 0, worldTransform);
      ctx.defs.push(
        `<clipPath id="${clipId}"><rect x="${p0.x}" y="${p0.y}" width="${sceneNode.width}" height="${sceneNode.height}" /></clipPath>`,
      );
      baseOutput.push(`<g clip-path="url(#${clipId})">${childOutput.join("")}</g>`);
    }
  }

  // If we have a filter, wrap all node content (including children) with the filter
  if (filterId && nodeOutput.length > 0) {
    output.push(`<g filter="url(#${filterId})">${nodeOutput.join("")}</g>`);
  }
}

// ============================================================================
// Bounds Calculation
// ============================================================================

function collectBounds(
  node: FigNode,
  parentTransform: TransformMatrix,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (node.visible === false) return null;

  const sceneNode = node as SceneNode;
  const localTransform = getLocalTransform(sceneNode);
  const worldTransform = multiplyTransforms(parentTransform, localTransform);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  // Skip CANVAS/DOCUMENT bounds - they represent pages, not visual content
  // Only include actual content node bounds
  const isPageNode = node.type === "CANVAS" || node.type === "DOCUMENT";

  if (
    !isPageNode &&
    sceneNode.width !== undefined &&
    sceneNode.height !== undefined
  ) {
    const corners = [
      transformPoint(0, 0, worldTransform),
      transformPoint(sceneNode.width, 0, worldTransform),
      transformPoint(sceneNode.width, sceneNode.height, worldTransform),
      transformPoint(0, sceneNode.height, worldTransform),
    ];
    for (const p of corners) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  // Include children bounds
  if (node.children) {
    for (const child of node.children as FigNode[]) {
      const childBounds = collectBounds(child, worldTransform);
      if (childBounds) {
        minX = Math.min(minX, childBounds.minX);
        minY = Math.min(minY, childBounds.minY);
        maxX = Math.max(maxX, childBounds.maxX);
        maxY = Math.max(maxY, childBounds.maxY);
      }
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Render a node subtree to SVG.
 *
 * @param node - The root node to render
 * @param images - Optional map of image hash -> image data for embedding
 * @param blobs - Optional array of blob data for vector paths
 * @param options - Rendering options
 * @returns The rendered SVG and metadata
 */
export function renderScreen(
  node: FigNode,
  images?: Map<string, Uint8Array>,
  blobs?: BlobEntry[],
  options: RenderScreenOptions = {},
): RenderScreenResult {
  // Strip undefined values so callers passing explicit `undefined`
  // (e.g. `{ includeText: undefined }`) don't clobber the defaults.
  const definedOptions = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as RenderScreenOptions;
  const resolved = { ...DEFAULT_RENDER_OPTIONS, ...definedOptions };
  const ctx: RenderContext = { defs: [], clipCounter: 0, shadowCounter: 0, warnings: [], usedFonts: new Set() };

  // Calculate bounds
  const bounds = collectBounds(node, IDENTITY_TRANSFORM);

  if (!bounds) {
    ctx.warnings.push("No bounds found for node subtree");
    return { svg: "", width: 0, height: 0, warnings: ctx.warnings, usedFonts: [] };
  }

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  // Offset transform to bring content to origin
  const offsetTransform: TransformMatrix = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: -bounds.minX,
    f: -bounds.minY,
  };

  // Render
  const output: string[] = [];
  if (resolved.background) {
    output.push(
      `<rect width="100%" height="100%" fill="${resolved.background}" />`,
    );
  }

  renderNode(node, offsetTransform, 0, resolved, images, blobs, ctx, output);

  // Build SVG
  const defs = ctx.defs.length > 0 ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const scaledWidth = width * resolved.scale;
  const scaledHeight = height * resolved.scale;

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scaledWidth}" height="${scaledHeight}" viewBox="0 0 ${width} ${height}">` +
    `${defs}${output.join("")}</svg>`;

  const usedFonts = Array.from(ctx.usedFonts).map((key) => {
    const [family, weight, style] = key.split("|");
    return { family, weight: Number(weight) || 400, style };
  });

  return { svg, width, height, warnings: ctx.warnings, usedFonts };
}
