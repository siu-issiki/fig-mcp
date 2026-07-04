/**
 * Text extraction that sees through INSTANCE nodes.
 *
 * TEXT nodes inside components are not serialized under INSTANCE nodes in
 * .fig files — the INSTANCE only references a SYMBOL definition plus
 * overrides. Extracting text therefore requires expanding each INSTANCE
 * into its (override-applied) SYMBOL subtree while walking.
 */

import type { FigNode, SceneNode, GUID } from "./types.js";
import { formatGUID } from "./kiwi-parser.js";
import { resolveInstanceChildren } from "./instance-resolver.js";

export interface ExtractedText {
  /** Node name of the TEXT node */
  name: string;
  /** The text characters */
  content: string;
  /** Name of the nearest enclosing INSTANCE, when the text came from an expanded component */
  instance?: string;
}

/**
 * Collect all text content under `root`, expanding INSTANCE nodes into their
 * SYMBOL definitions (with overrides applied) when indexes are provided.
 * Symbol recursion is guarded per traversal path.
 */
export function collectTexts(
  root: FigNode,
  nodeIndex?: Map<string, FigNode>,
  rawNodeIndex?: Map<string, Record<string, unknown>>,
): ExtractedText[] {
  const results: ExtractedText[] = [];

  function walk(node: FigNode, instanceName: string | undefined, symbolStack: Set<string>): void {
    if (node.type === "TEXT") {
      const characters = (node as unknown as { characters?: string }).characters;
      if (typeof characters === "string" && characters.length > 0) {
        results.push({
          name: node.name,
          content: characters,
          ...(instanceName ? { instance: instanceName } : {}),
        });
      }
      return;
    }

    let children = node.children as FigNode[] | undefined;
    let enteredSymbol: string | null = null;
    let nextInstanceName = instanceName;

    const sceneNode = node as SceneNode;
    if (
      node.type === "INSTANCE" &&
      (!children || children.length === 0) &&
      sceneNode.symbolData?.symbolID &&
      nodeIndex
    ) {
      const symbolId = formatGUID(sceneNode.symbolData.symbolID as GUID);
      const symbolNode = nodeIndex.get(symbolId);
      if (symbolNode?.children && !symbolStack.has(symbolId)) {
        enteredSymbol = symbolId;
        nextInstanceName = node.name;
        if (rawNodeIndex) {
          children =
            resolveInstanceChildren(node, symbolNode, rawNodeIndex, nodeIndex) ??
            (symbolNode.children as FigNode[]);
        } else {
          children = symbolNode.children as FigNode[];
        }
      }
    }

    if (!children) return;
    if (enteredSymbol) symbolStack.add(enteredSymbol);
    for (const child of children) {
      walk(child as FigNode, nextInstanceName, symbolStack);
    }
    if (enteredSymbol) symbolStack.delete(enteredSymbol);
  }

  walk(root, undefined, new Set());
  return results;
}
