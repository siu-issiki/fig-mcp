/**
 * Shared types and helpers for MCP tool modules.
 */

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import type { FigNode } from "../parser/types.js";
import { formatGUID, hashBytesToHex } from "../parser/index.js";

/** A category of MCP tools: schema definitions plus their handlers. */
export interface ToolModule {
  definitions: Tool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<CallToolResult>>;
}

export type ImageReference = {
  hash: string;
  kind: "image" | "thumbnail";
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodePath: string;
  paintIndex: number;
  paintType: string;
  originalWidth?: number;
  originalHeight?: number;
  scaleMode?: string;
  scale?: number;
  rotation?: number;
};

export type FillSummary = {
  paintCount: number;
  paintTypes: string[];
};

export type NodeWithFills = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodePath: string;
  fillSummary: FillSummary;
  imageRefs?: ImageReference[];
};

export function normalizeImageHash(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (Array.isArray(value) && value.length === 20) {
    const bytes = value.filter((b) => typeof b === "number") as number[];
    if (bytes.length === 20) {
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj["hash"] && typeof obj["hash"] === "object") {
      return hashBytesToHex(obj["hash"] as Record<string, number>);
    }
    const hasByteKeys = Object.keys(obj).some((key) => /^\d+$/.test(key));
    if (hasByteKeys) {
      return hashBytesToHex(obj as Record<string, number>);
    }
  }

  return null;
}

export function detectImageFormat(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xd8) return "jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "gif";
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    return "webp";
  }
  return "unknown";
}

export function normalizeNodeId(nodeId: string): string {
  // Trim whitespace
  let normalized = nodeId.trim();
  // Convert hyphen to colon if it looks like a node ID (digits-digits)
  if (/^\d+-\d+$/.test(normalized)) {
    normalized = normalized.replace('-', ':');
  }
  return normalized;
}

export function extractImageReferences(node: FigNode, nodePath: string): ImageReference[] {
  const refs: ImageReference[] = [];
  const nodeRecord = node as unknown as Record<string, unknown>;
  const fills = nodeRecord["fills"] ?? nodeRecord["fillPaints"];
  if (!Array.isArray(fills)) return refs;

  for (let i = 0; i < fills.length; i++) {
    const paint = fills[i] as Record<string, unknown>;
    if (!paint || typeof paint !== "object") continue;

    const paintType = String(paint["type"] ?? "UNKNOWN");
    const originalWidth =
      typeof paint["originalImageWidth"] === "number"
        ? paint["originalImageWidth"]
        : undefined;
    const originalHeight =
      typeof paint["originalImageHeight"] === "number"
        ? paint["originalImageHeight"]
        : undefined;
    const scaleMode =
      typeof paint["imageScaleMode"] === "string"
        ? paint["imageScaleMode"]
        : typeof paint["scaleMode"] === "string"
        ? paint["scaleMode"]
        : undefined;
    const scale = typeof paint["scale"] === "number" ? paint["scale"] : undefined;
    const rotation = typeof paint["rotation"] === "number" ? paint["rotation"] : undefined;

    const imageHash =
      normalizeImageHash(paint["image"]) ??
      normalizeImageHash(paint["imageHash"]);
    if (imageHash) {
      refs.push({
        hash: imageHash,
        kind: "image",
        nodeId: formatGUID(node.guid),
        nodeName: node.name,
        nodeType: node.type,
        nodePath,
        paintIndex: i,
        paintType,
        originalWidth,
        originalHeight,
        scaleMode,
        scale,
        rotation,
      });
    }

    const thumbHash = normalizeImageHash(paint["imageThumbnail"]);
    if (thumbHash) {
      refs.push({
        hash: thumbHash,
        kind: "thumbnail",
        nodeId: formatGUID(node.guid),
        nodeName: node.name,
        nodeType: node.type,
        nodePath,
        paintIndex: i,
        paintType,
        originalWidth,
        originalHeight,
        scaleMode,
        scale,
        rotation,
      });
    }
  }

  return refs;
}

export function summarizeFills(fills: unknown[]): FillSummary {
  const paintTypes = new Set<string>();

  for (const fill of fills) {
    if (!fill || typeof fill !== "object") continue;
    const paint = fill as Record<string, unknown>;
    paintTypes.add(String(paint["type"] ?? "UNKNOWN"));
  }

  return {
    paintCount: fills.length,
    paintTypes: Array.from(paintTypes),
  };
}

export function collectNodesWithFills(
  node: FigNode,
  nodePathIndex: Map<string, string>,
  results: NodeWithFills[],
  includeImageRefs: boolean,
  maxResults?: number
): boolean {
  if (maxResults !== undefined && results.length >= maxResults) return true;

  const nodeRecord = node as unknown as Record<string, unknown>;
  const fills = nodeRecord["fills"] ?? nodeRecord["fillPaints"];
  if (Array.isArray(fills) && fills.length > 0) {
    const nodeId = formatGUID(node.guid);
    const nodePath = nodePathIndex.get(nodeId) ?? node.name;
    const entry: NodeWithFills = {
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      nodePath,
      fillSummary: summarizeFills(fills),
    };
    if (includeImageRefs) {
      entry.imageRefs = extractImageReferences(node, nodePath);
    }
    results.push(entry);
    if (maxResults !== undefined && results.length >= maxResults) return true;
  }

  if (node.children) {
    for (const child of node.children) {
      if (
        collectNodesWithFills(
          child as FigNode,
          nodePathIndex,
          results,
          includeImageRefs,
          maxResults
        )
      ) {
        return true;
      }
    }
  }

  return false;
}
