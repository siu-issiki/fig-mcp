/**
 * Node lookup tools: find by type/name, inspect by path or GUID.
 */

import type { FigNode } from "../../parser/types.js";
import {
  simplifyNode,
  findNodesByType,
  findNodesByName,
  extractInstanceContent,
  getInstanceTextList,
  resolveNodePath,
} from "../../parser/index.js";
import { getOrParseFigFile } from "../file-cache.js";
import { normalizeNodeId, extractImageReferences } from "../tool-helpers.js";
import type { ToolModule } from "../tool-helpers.js";

export const nodesTools: ToolModule = {
  definitions: [
        {
          name: "find_nodes",
          description:
            "Find nodes in the document by type or name. Useful for locating specific components, frames, or text elements.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              type: {
                type: "string",
                description:
                  "Node type to find (e.g., FRAME, TEXT, COMPONENT, INSTANCE)",
              },
              name: {
                type: "string",
                description: "Node name to search for (partial match)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_node_details",
          description:
            "Get detailed information about a specific node by its path in the document tree. Use format like 'Page 1/Frame Name/Child Name'.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Path to the node (e.g., 'Page 1/Header/Logo')",
              },
              maxDepth: {
                type: "number",
                description: "Maximum depth to traverse children (default: 1, max: 10)",
                default: 1,
              },
              includeChildren: {
                type: "boolean",
                description: "Include child nodes in response (default: true)",
                default: true,
              },
              includeStyles: {
                type: "boolean",
                description: "Include style properties (fills, strokes, effects) (default: true)",
                default: true,
              },
              includeLayout: {
                type: "boolean",
                description: "Include layout inference (gap, padding, alignment) (default: true)",
                default: true,
              },
              includeImageRefs: {
                type: "boolean",
                description: "Include image reference metadata (default: true)",
                default: true,
              },
              includeEffects: {
                type: "boolean",
                description: "Include effects (shadows, blurs) (default: true)",
                default: true,
              },
              compact: {
                type: "boolean",
                description: "Use compact JSON formatting (no indentation) (default: false)",
                default: false,
              },
            },
            required: ["filePath", "nodePath"],
          },
        },
        {
          name: "get_node_by_id",
          description:
            "Get detailed information about a specific node by its GUID. Node ID format: 'sessionID:localID' (e.g., '457:1607'). Hyphen format also accepted.",
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
              maxDepth: {
                type: "number",
                description: "Maximum depth to traverse children (default: 1, max: 10)",
                default: 1,
              },
              includeChildren: {
                type: "boolean",
                description: "Include child nodes in response (default: true)",
                default: true,
              },
              includeStyles: {
                type: "boolean",
                description: "Include style properties (fills, strokes, effects) (default: true)",
                default: true,
              },
              includeLayout: {
                type: "boolean",
                description: "Include layout inference (gap, padding, alignment) (default: true)",
                default: true,
              },
              includeImageRefs: {
                type: "boolean",
                description: "Include image reference metadata (default: true)",
                default: true,
              },
              includeEffects: {
                type: "boolean",
                description: "Include effects (shadows, blurs) (default: true)",
                default: true,
              },
              compact: {
                type: "boolean",
                description: "Use compact JSON formatting (no indentation) (default: false)",
                default: false,
              },
            },
            required: ["filePath", "nodeId"],
          },
        },
        {
          name: "get_layout_info",
          description:
            "Get layout and spacing information for a node. Returns inferred flexbox-like properties including direction, gap, padding, and alignment.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Path to the node",
              },
            },
            required: ["filePath", "nodePath"],
          },
        },
  ],
  handlers: {
    find_nodes: async (args) => {
          const { filePath, type, name: nodeName } = args as {
            filePath: string;
            type?: string;
            name?: string;
          };
          const { document } = await getOrParseFigFile(filePath);

          let results: FigNode[] = [];
          if (type) {
            results = findNodesByType(document, type);
          }
          if (nodeName) {
            const byName = findNodesByName(document, nodeName);
            if (results.length > 0) {
              // Intersection if both type and name specified
              const nameSet = new Set(byName);
              results = results.filter((n) => nameSet.has(n));
            } else {
              results = byName;
            }
          }

          // Simplify results
          const simplified = results.map((n) => simplifyNode(n, 0, 2));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: simplified.length,
                    nodes: simplified,
                  },
                  null,
                  2
                ),
              },
            ],
          };
    },
    get_node_details: async (args) => {
          const {
            filePath,
            nodePath,
            maxDepth = 1,
            includeChildren = true,
            includeStyles = true,
            includeLayout = true,
            includeImageRefs = true,
            includeEffects = true,
            compact = false,
          } = args as {
            filePath: string;
            nodePath: string;
            maxDepth?: number;
            includeChildren?: boolean;
            includeStyles?: boolean;
            includeLayout?: boolean;
            includeImageRefs?: boolean;
            includeEffects?: boolean;
            compact?: boolean;
          };

          // Validate maxDepth
          const safeMaxDepth = Math.min(Math.max(maxDepth, 0), 10);

          const { document } = await getOrParseFigFile(filePath);

          const resolution = resolveNodePath(document, nodePath);
          if (!resolution.node) {
            return {
              content: [{ type: "text", text: `Error: ${resolution.error}` }],
              isError: true,
            };
          }
          const current = resolution.node;

          // Pass filtering options to simplifyNode
          const simplified = simplifyNode(
            current,
            0,
            includeChildren ? safeMaxDepth : 0,
            {
              includeStyles,
              includeLayout,
              includeEffects,
            }
          );

          const resolvedPath = resolution.path.join("/");

          // Conditionally include image refs
          const imageRefs = includeImageRefs
            ? extractImageReferences(
                current,
                resolvedPath.length > 0 ? resolvedPath : current.name
              )
            : undefined;

          const response = {
            ...simplified,
            ...(imageRefs && imageRefs.length > 0 && { imageRefs }),
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, compact ? 0 : 2),
              },
            ],
          };
    },
    get_node_by_id: async (args) => {
          const {
            filePath,
            nodeId,
            maxDepth = 1,
            includeChildren = true,
            includeStyles = true,
            includeLayout = true,
            includeImageRefs = true,
            includeEffects = true,
            compact = false,
          } = args as {
            filePath: string;
            nodeId: string;
            maxDepth?: number;
            includeChildren?: boolean;
            includeStyles?: boolean;
            includeLayout?: boolean;
            includeImageRefs?: boolean;
            includeEffects?: boolean;
            compact?: boolean;
          };

          // Validate maxDepth
          const safeMaxDepth = Math.min(Math.max(maxDepth, 0), 10);

          const { nodeIdIndex, nodePathIndex, rawNodeIndex } = await getOrParseFigFile(filePath);

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

          // Pass filtering options to simplifyNode
          const simplified = simplifyNode(
            node,
            0,
            includeChildren ? safeMaxDepth : 0,
            {
              includeStyles,
              includeLayout,
              includeEffects,
            }
          );

          const nodePath = nodePathIndex.get(normalizedId) ?? node.name;

          // Conditionally include image refs
          const imageRefs = includeImageRefs
            ? extractImageReferences(node, nodePath)
            : undefined;

          // For INSTANCE nodes, extract text content from symbolOverrides
          let instanceContent: { textContent: string[]; symbolId: string } | undefined;
          if (node.type === "INSTANCE") {
            const rawNode = rawNodeIndex.get(normalizedId);
            if (rawNode) {
              const resolved = extractInstanceContent(node, rawNode);
              if (resolved && resolved.textContent.length > 0) {
                instanceContent = {
                  symbolId: resolved.symbolId,
                  textContent: getInstanceTextList(resolved),
                };
              }
            }
          }

          const response = {
            ...simplified,
            nodePath,
            ...(imageRefs && imageRefs.length > 0 && { imageRefs }),
            ...(instanceContent && { instanceContent }),
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, compact ? 0 : 2),
              },
            ],
          };
    },
    get_layout_info: async (args) => {
          const { filePath, nodePath } = args as {
            filePath: string;
            nodePath: string;
          };
          const { document } = await getOrParseFigFile(filePath);

          const resolution = resolveNodePath(document, nodePath);
          if (!resolution.node) {
            return {
              content: [{ type: "text", text: `Error: ${resolution.error}` }],
              isError: true,
            };
          }

          const simplified = simplifyNode(resolution.node, 0, 1);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    name: simplified?.name,
                    type: simplified?.type,
                    bounds: simplified?.bounds,
                    layout: simplified?.layout,
                    style: simplified?.style,
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
