/**
 * Integration tests against a real .fig file.
 *
 * These run only when a test file is available: set FIG_TEST_FILE, or keep
 * the default export at ~/Downloads/toritori2.0.fig. Skipped otherwise.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/mcp/server.js";
import { contentTools } from "../src/mcp/tools/content.js";
import { renderTools } from "../src/mcp/tools/render.js";

const FIG =
  process.env.FIG_TEST_FILE ?? path.join(os.homedir(), "Downloads", "toritori2.0.fig");
const hasFig = fs.existsSync(FIG);

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string };

describe.skipIf(!hasFig)("integration: real .fig file", () => {
  it("extracts component text through INSTANCE nodes", async () => {
    const result = await contentTools.handlers.get_text_content({
      filePath: FIG,
      nodePath: "Page 1/Plan select",
    });
    const data = JSON.parse((result.content[0] as TextContent).text);
    expect(data.count).toBeGreaterThan(100);
    const contents = data.texts.map((t: { content: string }) => t.content);
    expect(contents).toContain("熱海旅行");
  });

  it("renders a screen without explicit options (regression: blank PNG)", async () => {
    const result = await renderTools.handlers.render_screen({
      filePath: FIG,
      nodeId: "1:4281",
      options: { maxWidth: 400, maxHeight: 900 },
    });
    const image = result.content[0] as ImageContent;
    expect(image.type).toBe("image");
    const png = Buffer.from(image.data, "base64");
    // A blank white 393x852 PNG compresses to ~3 KB; a real render is far larger.
    expect(png.length).toBeGreaterThan(20_000);
  });

  it("rejects tool calls with missing required arguments", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "render_screen", arguments: { filePath: FIG } });
    expect(result.isError).toBe(true);
    expect((result.content as TextContent[])[0].text).toContain("Missing required argument");

    await client.close();
    await server.close();
  });
});

describe.skipIf(hasFig)("integration placeholder", () => {
  it("skips real-file tests when no .fig file is available", () => {
    expect(hasFig).toBe(false);
  });
});
