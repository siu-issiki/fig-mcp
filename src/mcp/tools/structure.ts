/**
 * Document-structure tools: overviews, trees, and page listings.
 */

import type { FigNode } from "../../parser/types.js";
import { parseFigFileSimplified, getDocumentSummary, simplifyNode, resolveNodePath } from "../../parser/index.js";
import { getOrParseFigFile } from "../file-cache.js";
import type { ToolModule } from "../tool-helpers.js";

export const structureTools: ToolModule = {
  definitions: [
        {
          name: "parse_fig_file",
          description:
            "Parse a .fig file and return its document structure. Returns a simplified representation suitable for understanding the design hierarchy, layout, and styling.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              maxDepth: {
                type: "number",
                description: "Maximum depth to traverse (default: 10)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_document_summary",
          description:
            "Get a text summary of the document structure showing node types, names, and dimensions in a tree format. Supports pagination to handle large documents.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              maxNodes: {
                type: "number",
                description: "Maximum number of nodes to return (default: 100)",
              },
              offset: {
                type: "number",
                description: "Number of nodes to skip for pagination (default: 0)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_tree_summary",
          description:
            "Get hierarchical summary with child counts for drill-down navigation. Returns high-level structure without full node details.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              nodePath: {
                type: "string",
                description: "Optional path to start from (e.g., 'Page 1'). If not provided, starts from root.",
              },
              depth: {
                type: "number",
                description: "Levels to show (default: 2)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "list_pages",
          description: "List all pages (canvases) in the .fig file.",
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
          name: "get_page_contents",
          description:
            "Get the contents of a specific page, including all top-level frames and their immediate children.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              pageName: {
                type: "string",
                description: "Name of the page to get contents for",
              },
            },
            required: ["filePath", "pageName"],
          },
        },
  ],
  handlers: {
    parse_fig_file: async (args) => {
          const { filePath, maxDepth = 10 } = args as {
            filePath: string;
            maxDepth?: number;
          };
          const result = await parseFigFileSimplified(filePath, maxDepth);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
    },
    get_document_summary: async (args) => {
          const { filePath, maxNodes = 100, offset = 0 } = args as {
            filePath: string;
            maxNodes?: number;
            offset?: number;
          };
          const { document } = await getOrParseFigFile(filePath);
          const fullSummary = getDocumentSummary(document);
          const lines = fullSummary.split('\n');
          const totalNodes = lines.length;
          const paginatedLines = lines.slice(offset, offset + maxNodes);

          let resultText = paginatedLines.join('\n');
          if (totalNodes > maxNodes || offset > 0) {
            const start = offset + 1;
            const end = Math.min(offset + maxNodes, totalNodes);
            resultText = `Showing nodes ${start}-${end} of ${totalNodes}\n\n${resultText}`;
            if (end < totalNodes) {
              resultText += `\n\n... (${totalNodes - end} more nodes)`;
            }
          }

          return {
            content: [
              {
                type: "text",
                text: resultText,
              },
            ],
          };
    },
    get_tree_summary: async (args) => {
          const { filePath, nodePath, depth = 2 } = args as {
            filePath: string;
            nodePath?: string;
            depth?: number;
          };
          const { document, nodePathIndex } = await getOrParseFigFile(filePath);

          // Find starting node
          let startNode = document;
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

          // Generate tree summary
          const generateTreeSummary = (node: FigNode, currentDepth = 0, maxDepth = 2, prefix = ""): string => {
            if (currentDepth > maxDepth) return "";

            const childCount = node.children?.length ?? 0;
            const childSuffix = childCount > 0 ? ` [${childCount} children]` : "";
            let result = `${prefix}${node.name} (${node.type})${childSuffix}\n`;

            if (currentDepth < maxDepth && node.children && node.children.length > 0) {
              const isLast = (i: number) => i === node.children!.length - 1;
              node.children.forEach((child, i) => {
                const childPrefix = prefix + (isLast(i) ? "└── " : "├── ");
                const grandchildPrefix = prefix + (isLast(i) ? "    " : "│   ");
                result += generateTreeSummary(child, currentDepth + 1, maxDepth, childPrefix);
              });
            }

            return result;
          };

          const summary = generateTreeSummary(startNode, 0, depth);
          return {
            content: [
              {
                type: "text",
                text: summary,
              },
            ],
          };
    },
    list_pages: async (args) => {
          const { filePath } = args as { filePath: string };
          const { document } = await getOrParseFigFile(filePath);

          const pages = document.children?.map((c) => ({
            name: (c as FigNode).name,
            type: (c as FigNode).type,
            childCount: (c as FigNode).children?.length ?? 0,
          }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ pages }, null, 2),
              },
            ],
          };
    },
    get_page_contents: async (args) => {
          const { filePath, pageName } = args as {
            filePath: string;
            pageName: string;
          };
          const { document } = await getOrParseFigFile(filePath);

          const page = document.children?.find((c) =>
            (c as FigNode).name.toLowerCase().includes(pageName.toLowerCase())
          ) as FigNode | undefined;

          if (!page) {
            return {
              content: [
                {
                  type: "text",
                  text: `Page not found: ${pageName}`,
                },
              ],
            };
          }

          const simplified = simplifyNode(page, 0, 3);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(simplified, null, 2),
              },
            ],
          };
    },
  },
};
