/**
 * Introspection tools: kiwi schema, raw message, archive listing, cache control.
 */

import { getFigSchema, getFigRawMessage, listFigContents } from "../../parser/index.js";
import { clearFigFileCache } from "../file-cache.js";
import type { ToolModule } from "../tool-helpers.js";

export const inspectionTools: ToolModule = {
  definitions: [
        {
          name: "get_schema_info",
          description:
            "Get the kiwi schema information from the .fig file. Useful for debugging and understanding the file format.",
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
          name: "get_raw_message",
          description:
            "Get the raw decoded message from the .fig file. Warning: can be very large. Use for debugging only.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              maxSize: {
                type: "number",
                description:
                  "Maximum size in characters to return (default: 50000)",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "list_archive_contents",
          description: "List all files contained in the .fig archive.",
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
          name: "clear_cache",
          description:
            "Clear the file cache. Useful if the .fig file has been modified.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description:
                  "Path to clear from cache (optional, clears all if not specified)",
              },
            },
          },
        },
  ],
  handlers: {
    get_schema_info: async (args) => {
          const { filePath } = args as { filePath: string };
          const result = await getFigSchema(filePath);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
    },
    get_raw_message: async (args) => {
          const { filePath, maxSize = 50000 } = args as {
            filePath: string;
            maxSize?: number;
          };
          const result = await getFigRawMessage(filePath);
          // Kiwi uint64 fields decode to BigInt, which JSON.stringify rejects
          let text = JSON.stringify(
            result,
            (_key, value) => (typeof value === "bigint" ? value.toString() : value),
            2
          );
          if (text.length > maxSize) {
            text =
              text.substring(0, maxSize) +
              `\n\n... [truncated, total size: ${text.length} chars]`;
          }
          return {
            content: [
              {
                type: "text",
                text,
              },
            ],
          };
    },
    list_archive_contents: async (args) => {
          const { filePath } = args as { filePath: string };
          const contents = await listFigContents(filePath);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ files: contents }, null, 2),
              },
            ],
          };
    },
    clear_cache: async (args) => {
          const { filePath } = args as { filePath?: string };
          return {
            content: [
              {
                type: "text",
                text: clearFigFileCache(filePath),
              },
            ],
          };
    },
  },
};
