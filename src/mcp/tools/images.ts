/**
 * Image asset tools: enumerate, fetch, and thumbnail access.
 */

import type { FigNode } from "../../parser/types.js";
import { getOrParseFigFile } from "../file-cache.js";
import { detectImageFormat, extractImageReferences } from "../tool-helpers.js";
import type { ImageReference, ToolModule } from "../tool-helpers.js";
import { config } from "../../shared-config.js";

export const imagesTools: ToolModule = {
  definitions: [
        {
          name: "list_images",
          description:
            "List all images in the .fig file with their metadata. Returns image hashes, dimensions, and which nodes reference them.",
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
          name: "get_image",
          description:
            "Get a specific image from the .fig file as a resource. Use the hash from list_images.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .fig file",
              },
              imageHash: {
                type: "string",
                description: "The 40-character hex hash of the image",
              },
            },
            required: ["filePath", "imageHash"],
          },
        },
        {
          name: "get_thumbnail",
          description:
            "Get the document thumbnail image as a resource.",
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
  ],
  handlers: {
    list_images: async (args) => {
          const { filePath } = args as { filePath: string };
          const { document, images } = await getOrParseFigFile(filePath);

          const entries = new Map<
            string,
            {
              hash: string;
              byteLength: number;
              format: string;
              references: ImageReference[];
              dimensions: Set<string>;
            }
          >();

          for (const [hash, data] of images) {
            entries.set(hash, {
              hash,
              byteLength: data.length,
              format: detectImageFormat(data),
              references: [],
              dimensions: new Set(),
            });
          }

          const missingRefs = new Map<string, ImageReference[]>();

          function walk(node: FigNode, path: string): void {
            const nodePath = path ? `${path}/${node.name}` : node.name;
            const refs = extractImageReferences(node, nodePath);
            for (const ref of refs) {
              const entry = entries.get(ref.hash);
              if (entry) {
                entry.references.push(ref);
                if (ref.originalWidth !== undefined && ref.originalHeight !== undefined) {
                  entry.dimensions.add(`${ref.originalWidth}x${ref.originalHeight}`);
                }
              } else {
                if (!missingRefs.has(ref.hash)) {
                  missingRefs.set(ref.hash, []);
                }
                missingRefs.get(ref.hash)!.push(ref);
              }
            }
            if (node.children) {
              for (const child of node.children) {
                walk(child as FigNode, nodePath);
              }
            }
          }

          walk(document, "");

          const imagesList = Array.from(entries.values())
            .sort((a, b) => a.hash.localeCompare(b.hash))
            .map((entry) => ({
              hash: entry.hash,
              byteLength: entry.byteLength,
              format: entry.format,
              referenceCount: entry.references.length,
              dimensions: Array.from(entry.dimensions).map((dim) => {
                const [width, height] = dim.split("x").map((n) => Number(n));
                return { width, height };
              }),
              references: entry.references,
            }));

          const unresolvedReferences = Array.from(missingRefs.entries()).map(
            ([hash, references]) => ({
              hash,
              referenceCount: references.length,
              references,
            })
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: imagesList.length,
                    images: imagesList,
                    unresolvedReferences,
                  },
                  null,
                  2
                ),
              },
            ],
          };
    },
    get_image: async (args) => {
          const { filePath, imageHash } = args as {
            filePath: string;
            imageHash: string;
          };
          const { images } = await getOrParseFigFile(filePath);
          const normalized = imageHash.toLowerCase();
          const data = images.get(normalized) ?? images.get(imageHash);

          if (!data) {
            return {
              content: [
                {
                  type: "text",
                  text: `Image not found for hash: ${imageHash}`,
                },
              ],
              isError: true,
            };
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

          // Return HTTP URL instead of blob
          const httpUrl = `http://localhost:${config.httpPort}/image/${encodeURIComponent(filePath)}/${normalized}`;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  url: httpUrl,
                  hash: normalized,
                  format: mimeType,
                  size: data.length,
                }),
              },
            ],
          };
    },
    get_thumbnail: async (args) => {
          const { filePath } = args as { filePath: string };
          const { thumbnail } = await getOrParseFigFile(filePath);
          if (!thumbnail) {
            return {
              content: [
                {
                  type: "text",
                  text: "No thumbnail.png found in the .fig file",
                },
              ],
              isError: true,
            };
          }

          // Return HTTP URL instead of blob
          const httpUrl = `http://localhost:${config.httpPort}/thumbnail/${encodeURIComponent(filePath)}`;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  url: httpUrl,
                  format: "image/png",
                  size: thumbnail.length,
                }),
              },
            ],
          };
    },
  },
};
