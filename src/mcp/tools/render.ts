/**
 * Rendering tools: raster screenshots and vector export.
 */

import { renderScreen, generateScreenshot, resolveFonts } from "../../renderer/index.js";
import { isVectorNode, exportVector } from "../../vector-export.js";
import type { VectorFormat } from "../../vector-export.js";
import { getOrParseFigFile } from "../file-cache.js";
import { normalizeNodeId } from "../tool-helpers.js";
import type { ToolModule } from "../tool-helpers.js";

export const renderTools: ToolModule = {
  definitions: [
        {
          name: "render_screen",
          description:
            "Experimental: render a node subtree to a PNG screenshot using its bounds, fills, strokes, shadows, and text. Node ID format: 'sessionID:localID' (e.g., '457:1607'). Hyphen format also accepted.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodeId: {
                type: "string",
                description: "GUID string in format 'sessionID:localID' (e.g., '457:1607') or 'sessionID-localID'",
              },
              options: {
                type: "object",
                description: "Rendering options",
                properties: {
                  maxDepth: { type: "number" },
                  includeText: { type: "boolean" },
                  includeFills: { type: "boolean" },
                  includeStrokes: { type: "boolean" },
                  includeImages: { type: "boolean" },
                  includeShadows: { type: "boolean", description: "Include drop shadows and inner shadows (default: true)" },
                  background: { type: "string" },
                  scale: { type: "number" },
                  maxWidth: { type: "number", description: "Maximum width in pixels (default: 800)" },
                  maxHeight: { type: "number", description: "Maximum height in pixels (default: 600)" },
                  downloadFonts: {
                    type: "boolean",
                    description:
                      "Opt in to downloading missing font families from Google Fonts (sends the design's font family names to Google; cached in ~/.cache/fig-mcp/fonts, default: false). Cached fonts are always used without network access.",
                  },
                  fontDirs: {
                    type: "array",
                    items: { type: "string" },
                    description: "Additional directories to scan for font files",
                  },
                  fontMap: {
                    type: "object",
                    additionalProperties: { type: "string" },
                    description:
                      'Fallback font families for fonts unavailable on this machine, e.g. {"AFSGillSBCond": "Gill Sans"}',
                  },
                },
              },
            },
            required: ["filePath", "nodeId"],
          },
        },
        {
          name: "get_vector",
          description:
            "Export a vector node as SVG, PDF, PNG, or WebP. SVG returns the vector path directly. PDF returns a vector-based PDF (ideal for iOS). PNG/WebP returns a rasterized image at specified dimensions.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodeId: {
                type: "string",
                description: "GUID string in format 'sessionID:localID' (e.g., '457:1682') or 'sessionID-localID'",
              },
              format: {
                type: "string",
                enum: ["svg", "pdf", "png", "webp"],
                description: "Output format: svg (vector), pdf (vector for iOS), png/webp (raster)",
              },
              width: {
                type: "number",
                description: "Output width in pixels (required for png/webp, optional for pdf)",
              },
              height: {
                type: "number",
                description: "Output height in pixels (required for png/webp, optional for pdf)",
              },
              includeStyles: {
                type: "boolean",
                description: "Include fill/stroke styles from node (default: true)",
                default: true,
              },
            },
            required: ["filePath", "nodeId", "format"],
          },
        },
  ],
  handlers: {
    render_screen: async (args) => {
          const { filePath, nodeId, options } = args as {
            filePath: string;
            nodeId: string;
            options?: Record<string, unknown>;
          };
          const { nodeIdIndex, rawNodeIndex, images, blobs } = await getOrParseFigFile(filePath);

          const normalizedId = normalizeNodeId(nodeId);
          const node = nodeIdIndex.get(normalizedId);

          if (!node) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node not found for id: ${nodeId}`,
                },
              ],
              isError: true,
            };
          }

          const result = renderScreen(node, images, blobs, {
            maxDepth: typeof options?.maxDepth === "number" ? options.maxDepth : undefined,
            includeText: typeof options?.includeText === "boolean" ? options.includeText : undefined,
            includeFills:
              typeof options?.includeFills === "boolean" ? options.includeFills : undefined,
            includeStrokes:
              typeof options?.includeStrokes === "boolean" ? options.includeStrokes : undefined,
            includeImages:
              typeof options?.includeImages === "boolean" ? options.includeImages : undefined,
            includeShadows:
              typeof options?.includeShadows === "boolean" ? options.includeShadows : undefined,
            background: typeof options?.background === "string" ? options.background : undefined,
            scale: typeof options?.scale === "number" ? options.scale : undefined,
            fontMap:
              options?.fontMap && typeof options.fontMap === "object"
                ? (options.fontMap as Record<string, string>)
                : undefined,
            nodeIndex: nodeIdIndex,
            rawNodeIndex,
          });

          // Make design fonts available to resvg. Network fetch is opt-in:
          // downloading would send the design's font family names to Google
          // Fonts, so by default only already-cached fonts are used.
          const { fontFiles } = await resolveFonts(result.usedFonts, {
            download: options?.downloadFonts === true,
          });

          // Convert SVG to PNG
          const screenshot = await generateScreenshot(result.svg, {
            maxWidth: typeof options?.maxWidth === "number" ? options.maxWidth : undefined,
            maxHeight: typeof options?.maxHeight === "number" ? options.maxHeight : undefined,
            fontFiles,
            fontDirs: Array.isArray(options?.fontDirs)
              ? (options.fontDirs as string[])
              : undefined,
          });

          return {
            content: [
              {
                type: "image",
                data: screenshot.base64,
                mimeType: screenshot.mimeType,
              },
            ],
          };
    },
    get_vector: async (args) => {
          const {
            filePath,
            nodeId,
            format,
            width,
            height,
            includeStyles = true,
          } = args as {
            filePath: string;
            nodeId: string;
            format: VectorFormat;
            width?: number;
            height?: number;
            includeStyles?: boolean;
          };

          const { nodeIdIndex, blobs } = await getOrParseFigFile(filePath);
          const normalizedId = normalizeNodeId(nodeId);
          const node = nodeIdIndex.get(normalizedId);

          if (!node) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node not found for id: ${nodeId}`,
                },
              ],
              isError: true,
            };
          }

          // Check if node is a vector type
          if (!isVectorNode(node)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Node ${nodeId} (${node.type}) is not a vector node. Vector export requires VECTOR, LINE, STAR, ELLIPSE, REGULAR_POLYGON, or BOOLEAN_OPERATION nodes, or nodes with fillGeometry/strokeGeometry.`,
                },
              ],
              isError: true,
            };
          }

          // Validate dimensions for raster formats
          if ((format === "png" || format === "webp") && (!width || !height)) {
            return {
              content: [
                {
                  type: "text",
                  text: `width and height are required for ${format} format`,
                },
              ],
              isError: true,
            };
          }

          try {
            const result = await exportVector(node, blobs, format, {
              width,
              height,
              includeStyles,
            });

            if (format === "svg") {
              // Return SVG directly as text
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      format: "svg",
                      width: result.width,
                      height: result.height,
                      mimeType: result.mimeType,
                      svg: result.data as string,
                    }, null, 2),
                  },
                ],
              };
            } else {
              // For binary formats (PDF, PNG, WebP), return as base64
              const buffer = result.data as Buffer;
              const base64 = buffer.toString("base64");

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      format: result.format,
                      width: result.width,
                      height: result.height,
                      mimeType: result.mimeType,
                      size: buffer.length,
                      data: base64,
                    }, null, 2),
                  },
                ],
              };
            }
          } catch (exportError) {
            return {
              content: [
                {
                  type: "text",
                  text: `Vector export failed: ${exportError instanceof Error ? exportError.message : String(exportError)}`,
                },
              ],
              isError: true,
            };
          }
    },
  },
};
