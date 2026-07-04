/**
 * Parsed .fig file cache shared by all MCP tools.
 */

import * as fs from "fs";

import {
  parseFigFile,
  buildNodeIdIndex,
  buildNodePathIndex,
  buildRawNodeIndex,
} from "../parser/index.js";
import type { FigNode } from "../parser/types.js";

export interface FigFileCacheEntry {
  document: FigNode;
  meta: Record<string, unknown>;
  images: Map<string, Uint8Array>;
  thumbnail?: Uint8Array;
  version: number;
  nodeIdIndex: Map<string, FigNode>;
  nodePathIndex: Map<string, string>;
  rawNodeIndex: Map<string, Record<string, unknown>>;
  blobs?: Array<{ bytes: Uint8Array }>;
}

const fileCache = new Map<string, FigFileCacheEntry>();

/**
 * Get or parse a fig file with caching
 */
export async function getOrParseFigFile(filePath: string): Promise<FigFileCacheEntry> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}. Provide an absolute path to a .fig file exported via Figma's "Save local copy…".`
    );
  }
  if (!fileCache.has(filePath)) {
    const parsed = await parseFigFile(filePath);
    const nodeIdIndex = buildNodeIdIndex(parsed.document);
    const nodePathIndex = buildNodePathIndex(parsed.document);
    const rawNodeIndex = parsed.rawMessage ? buildRawNodeIndex(parsed.rawMessage) : new Map();
    fileCache.set(filePath, {
      document: parsed.document,
      meta: parsed.meta,
      images: parsed.images,
      thumbnail: parsed.thumbnail,
      version: parsed.version,
      nodeIdIndex,
      nodePathIndex,
      rawNodeIndex,
      blobs: parsed.blobs,
    });
  }
  return fileCache.get(filePath)!;
}

/**
 * Clear one cached file, or all files when no path is given.
 * Returns a human-readable description of what was cleared.
 */
export function clearFigFileCache(filePath?: string): string {
  if (filePath) {
    fileCache.delete(filePath);
    return `Cleared cache for: ${filePath}`;
  }
  fileCache.clear();
  return "Cleared all cached files";
}
