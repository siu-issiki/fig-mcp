import { describe, expect, it } from "vitest";

import { collectTexts } from "../src/parser/text-extraction.js";
import { buildNodeIdIndex } from "../src/parser/index.js";
import type { FigNode } from "../src/parser/types.js";

let nextId = 1;
function node(
  name: string,
  type: string,
  extra: Record<string, unknown> = {},
  children?: FigNode[],
): FigNode {
  return {
    guid: { sessionID: 1, localID: nextId++ },
    name,
    type,
    children,
    ...extra,
  } as unknown as FigNode;
}

describe("collectTexts", () => {
  it("collects characters from plain TEXT nodes", () => {
    const tree = node("Frame", "FRAME", {}, [
      node("Title", "TEXT", { characters: "こんにちは" }),
      node("Empty", "TEXT", { characters: "" }),
      node("NoChars", "TEXT"),
    ]);

    expect(collectTexts(tree)).toEqual([{ name: "Title", content: "こんにちは" }]);
  });

  it("expands INSTANCE nodes into their SYMBOL definition", () => {
    const symbol = node("Card", "SYMBOL", {}, [
      node("Label", "TEXT", { characters: "コンポーネント内テキスト" }),
    ]);
    const instance = node("Card Instance", "INSTANCE", {
      symbolData: { symbolID: symbol.guid },
    });
    const root = node("Document", "DOCUMENT", {}, [
      node("Page 1", "CANVAS", {}, [instance]),
      node("Internal", "CANVAS", {}, [symbol]),
    ]);
    const nodeIndex = buildNodeIdIndex(root);

    const texts = collectTexts(root.children![0] as FigNode, nodeIndex, new Map());
    expect(texts).toEqual([
      { name: "Label", content: "コンポーネント内テキスト", instance: "Card Instance" },
    ]);
  });

  it("does not expand INSTANCE nodes without an index", () => {
    const symbol = node("Card", "SYMBOL", {}, [
      node("Label", "TEXT", { characters: "hidden" }),
    ]);
    const instance = node("Card Instance", "INSTANCE", {
      symbolData: { symbolID: symbol.guid },
    });

    expect(collectTexts(instance)).toEqual([]);
  });

  it("applies text overrides that exist only as componentPropAssignments", () => {
    const propDef = { sessionID: 5, localID: 50 };
    const label = node("Label", "TEXT", { characters: "デフォルト" });
    const symbol = node("Card", "SYMBOL", {}, [label]);
    const instance = node("Card Instance", "INSTANCE", {
      symbolData: { symbolID: symbol.guid },
    });
    const root = node("Document", "DOCUMENT", {}, [instance, symbol]);
    const nodeIndex = buildNodeIdIndex(root);

    const guidKey = (g: unknown) => {
      const { sessionID, localID } = g as { sessionID: number; localID: number };
      return `${sessionID}:${localID}`;
    };
    const rawNodeIndex = new Map<string, Record<string, unknown>>([
      [
        guidKey(instance.guid),
        {
          guid: instance.guid,
          componentPropAssignments: [
            { defID: propDef, value: { textValue: { characters: "上書きテキスト" } } },
          ],
        },
      ],
      [
        guidKey(label.guid),
        {
          guid: label.guid,
          componentPropRefs: [{ defID: propDef, componentPropNodeField: "TEXT_DATA" }],
        },
      ],
    ]);

    const texts = collectTexts(instance, nodeIndex, rawNodeIndex);
    expect(texts).toEqual([
      { name: "Label", content: "上書きテキスト", instance: "Card Instance" },
    ]);
  });

  it("guards against recursive symbol references", () => {
    const symbolGuid = { sessionID: 9, localID: 99 };
    const symbol = node("Recursive", "SYMBOL", {}, [
      node("Self", "INSTANCE", { symbolData: { symbolID: symbolGuid } }),
      node("Label", "TEXT", { characters: "once" }),
    ]);
    (symbol as unknown as { guid: unknown }).guid = symbolGuid;
    const instance = node("Entry", "INSTANCE", {
      symbolData: { symbolID: symbolGuid },
    });
    const root = node("Document", "DOCUMENT", {}, [instance, symbol]);
    const nodeIndex = buildNodeIdIndex(root);

    const texts = collectTexts(instance, nodeIndex, new Map());
    expect(texts).toEqual([{ name: "Label", content: "once", instance: "Entry" }]);
  });
});
