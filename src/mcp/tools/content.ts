/**
 * Content extraction tools: text, colors, and fill inventories.
 */

import type { FigNode } from "../../parser/types.js";
import { resolveNodePath, collectTexts } from "../../parser/index.js";
import { getOrParseFigFile } from "../file-cache.js";
import { collectNodesWithFills } from "../tool-helpers.js";
import type { NodeWithFills, ToolModule } from "../tool-helpers.js";

export const contentTools: ToolModule = {
  definitions: [
        {
          name: "get_text_content",
          description:
            "Extract all text content from the document or a specific node path.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Optional path to limit text extraction scope",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_colors",
          description:
            "Extract all unique colors used in the document, including fills and strokes.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "list_nodes_with_fills",
          description:
            "List nodes that have fill paints, with summary of paint types and optional image references.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              includeImageRefs: {
                type: "boolean",
                description: "Include image hash references for IMAGE fills",
              },
              maxResults: {
                type: "number",
                description: "Optional cap on number of nodes returned",
              },
            },
            required: ["filePath"],
          },
        },
  ],
  handlers: {
    get_text_content: async (args) => {
          const { filePath, nodePath } = args as {
            filePath: string;
            nodePath?: string;
          };
          const { document, nodeIdIndex, rawNodeIndex } = await getOrParseFigFile(filePath);

          let startNode: FigNode = document;
          if (nodePath) {
            const resolution = resolveNodePath(document, nodePath);
            if (!resolution.node) {
              return {
                content: [{ type: "text", text: `Error: ${resolution.error}` }],
                isError: true,
              };
            }
            startNode = resolution.node;
          }

          // Collect text, expanding INSTANCE nodes into their SYMBOL
          // definitions (with overrides) so component text is included.
          const texts = collectTexts(startNode, nodeIdIndex, rawNodeIndex);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { scope: startNode.name, count: texts.length, texts },
                  null,
                  2
                ),
              },
            ],
          };
    },
    get_colors: async (args) => {
          const { filePath } = args as { filePath: string };
          const { document } = await getOrParseFigFile(filePath);

          const colors = new Set<string>();

          function extractColors(node: FigNode): void {
            const sceneNode = node as unknown as {
              fills?: Array<{ color?: { r: number; g: number; b: number; a: number } }>;
              strokes?: Array<{ color?: { r: number; g: number; b: number; a: number } }>;
            };

            if (sceneNode.fills) {
              for (const fill of sceneNode.fills) {
                if (fill.color) {
                  const { r, g, b, a } = fill.color;
                  colors.add(
                    `rgba(${Math.round(r * 255)}, ${Math.round(
                      g * 255
                    )}, ${Math.round(b * 255)}, ${a.toFixed(2)})`
                  );
                }
              }
            }

            if (sceneNode.strokes) {
              for (const stroke of sceneNode.strokes) {
                if (stroke.color) {
                  const { r, g, b, a } = stroke.color;
                  colors.add(
                    `rgba(${Math.round(r * 255)}, ${Math.round(
                      g * 255
                    )}, ${Math.round(b * 255)}, ${a.toFixed(2)})`
                  );
                }
              }
            }

            if (node.children) {
              for (const child of node.children) {
                extractColors(child as FigNode);
              }
            }
          }

          extractColors(document);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { colors: Array.from(colors).sort() },
                  null,
                  2
                ),
              },
            ],
          };
    },
    list_nodes_with_fills: async (args) => {
          const { filePath, includeImageRefs, maxResults } = args as {
            filePath: string;
            includeImageRefs?: boolean;
            maxResults?: number;
          };
          const { document, nodePathIndex } = await getOrParseFigFile(filePath);

          const nodes: NodeWithFills[] = [];
          collectNodesWithFills(
            document,
            nodePathIndex,
            nodes,
            includeImageRefs ?? false,
            maxResults
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: nodes.length,
                    nodes,
                  },
                  null,
                  2
                ),
              },
            ],
          };
    },
  },
};
