/**
 * MCP Server for .fig file parsing
 *
 * Thin wiring layer: tool schemas and handlers live in ./tools/*, the
 * parsed-file cache in ./file-cache.ts, and shared helpers in
 * ./tool-helpers.ts. This module registers everything with the MCP SDK
 * and validates required arguments before dispatch.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getOrParseFigFile } from "./file-cache.js";
import { detectImageFormat, normalizeImageHash } from "./tool-helpers.js";
import type { ToolModule } from "./tool-helpers.js";
import { structureTools } from "./tools/structure.js";
import { nodesTools } from "./tools/nodes.js";
import { contentTools } from "./tools/content.js";
import { imagesTools } from "./tools/images.js";
import { renderTools } from "./tools/render.js";
import { inspectionTools } from "./tools/inspection.js";

// Re-exports kept for existing consumers (http-server, debug scripts)
export { getOrParseFigFile } from "./file-cache.js";
export { detectImageFormat, normalizeImageHash } from "./tool-helpers.js";

const toolModules: ToolModule[] = [
  structureTools,
  nodesTools,
  contentTools,
  imagesTools,
  renderTools,
  inspectionTools,
];

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: "fig-mcp",
      version: "2.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  const toolDefinitions = toolModules.flatMap((mod) => mod.definitions);
  const handlers = new Map(
    toolModules.flatMap((mod) => Object.entries(mod.handlers))
  );
  const requiredArgsByTool = new Map<string, string[]>(
    toolDefinitions.map((tool) => [
      tool.name,
      (tool.inputSchema as { required?: string[] }).required ?? [],
    ]),
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = handlers.get(name);
    if (!handler) {
      return {
        content: [{ type: "text", text: `Error: Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Validate required arguments up front so handlers can assume they exist,
    // and callers get a clear message instead of an internal TypeError.
    const requiredArgs = requiredArgsByTool.get(name) ?? [];
    const argRecord = (args ?? {}) as Record<string, unknown>;
    const missing = requiredArgs.filter((key) => {
      const value = argRecord[key];
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
      );
    });
    if (missing.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: `Missing required argument(s) for ${name}: ${missing.join(", ")}. Required: ${requiredArgs.join(", ")}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      return await handler(argRecord);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List resources (fig files in common locations could be listed here)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: [] };
  });

  // List resource templates
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: "fig://{filePath}/images/{imageHash}",
          name: "Fig Image",
          description:
            "Image asset from a .fig file. filePath should be URL-encoded.",
          mimeType: "image/*",
        },
        {
          uriTemplate: "fig://{filePath}/thumbnail",
          name: "Fig Thumbnail",
          description:
            "Thumbnail preview of a .fig file. filePath should be URL-encoded.",
          mimeType: "image/png",
        },
      ],
    };
  });

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    // Parse fig:// URIs
    // Format: fig://{encodedFilePath}/images/{imageHash}
    // Format: fig://{encodedFilePath}/thumbnail
    if (uri.startsWith("fig://")) {
      const path = uri.slice("fig://".length);

      // Check for thumbnail
      if (path.endsWith("/thumbnail")) {
        const encodedFilePath = path.slice(0, -"/thumbnail".length);
        const filePath = decodeURIComponent(encodedFilePath);

        const { thumbnail } = await getOrParseFigFile(filePath);
        if (!thumbnail) {
          throw new Error(`No thumbnail found in: ${filePath}`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: "image/png",
              blob: Buffer.from(thumbnail).toString("base64"),
            },
          ],
        };
      }

      // Check for image
      const imageMatch = path.match(/^(.+)\/images\/([a-fA-F0-9]{40})$/);
      if (imageMatch) {
        const [, encodedFilePath, imageHash] = imageMatch;
        const filePath = decodeURIComponent(encodedFilePath);

        const { images } = await getOrParseFigFile(filePath);
        const normalized = imageHash.toLowerCase();
        const data = images.get(normalized) ?? images.get(imageHash);

        if (!data) {
          throw new Error(`Image not found: ${imageHash} in ${filePath}`);
        }

        const format = detectImageFormat(data);
        const mimeType =
          format === "jpeg"
            ? "image/jpeg"
            : format === "png"
              ? "image/png"
              : format === "gif"
                ? "image/gif"
                : format === "webp"
                  ? "image/webp"
                  : "application/octet-stream";

        return {
          contents: [
            {
              uri,
              mimeType,
              blob: Buffer.from(data).toString("base64"),
            },
          ],
        };
      }
    }

    throw new Error(`Resource not found: ${uri}`);
  });

  return server;
}

/**
 * Start the MCP server
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Fig MCP server started");
}
