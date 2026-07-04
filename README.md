# fig-mcp (siu-issiki fork)

MCP server for parsing `.fig` files. Enables AI assistants to understand and extract design information from the `.fig` file format for implementation guidance.

Forked from [bilalba/fig-mcp](https://github.com/bilalba/fig-mcp) with substantial rendering-fidelity and robustness improvements — see [Fork changes](#fork-changes).

## Installation

```bash
git clone https://github.com/siu-issiki/fig-mcp
cd fig-mcp && npm install && npm run build
```

## Quick Start

### Add to Claude

```bash
claude mcp add fig-mcp -- node /path/to/fig-mcp/dist/index.js
```

Then ask Claude to parse your `.fig` files:

> "Parse my design.fig file and show me the document structure"

### Web Viewer

Browse and preview `.fig` files in your browser:

```bash
fig-mcp viewer design.fig
# Opens http://localhost:3000
```

Features:
- Tree navigation with collapsible nodes
- SVG preview with zoom/pan
- Node details panel
- Copy node IDs for MCP tool calls

### CLI Inspector

Inspect `.fig` files from the command line:

```bash
fig-mcp inspect design.fig summary  # Show document structure
fig-mcp inspect design.fig stats    # Show node type counts
fig-mcp inspect design.fig list     # List archive contents
fig-mcp inspect design.fig json     # Output simplified JSON
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `fig-mcp` | Start MCP server (for AI assistants) |
| `fig-mcp viewer <file> [port]` | Open web viewer |
| `fig-mcp inspect <file> [cmd]` | Inspect file |
| `fig-mcp --help` | Show help |
| `fig-mcp --version` | Show version |

## MCP Tools

The MCP server exposes the following tools for AI assistants:

### Document Structure

| Tool | Description |
|------|-------------|
| `parse_fig_file` | Parse and return simplified document structure |
| `get_document_summary` | Text tree of document structure with pagination |
| `get_tree_summary` | Hierarchical summary for drill-down navigation |
| `list_pages` | List all pages (canvases) in the document |
| `get_page_contents` | Get contents of a specific page |

### Node Queries

| Tool | Description |
|------|-------------|
| `find_nodes` | Find nodes by type or name |
| `get_node_details` | Get details for a node by path |
| `get_node_by_id` | Get details for a node by GUID |
| `get_layout_info` | Get inferred layout properties |

### Content Extraction

| Tool | Description |
|------|-------------|
| `get_text_content` | Extract all text content |
| `get_colors` | Extract unique color palette |
| `list_nodes_with_fills` | List nodes with fill paints |

### Image & Rendering

| Tool | Description |
|------|-------------|
| `list_images` | List all images with metadata |
| `get_image` | Get image by hash (base64) |
| `get_thumbnail` | Get document thumbnail |
| `render_screen` | Render node subtree as PNG (see options below) |
| `get_vector` | Export vector as SVG, PDF, PNG, or WebP |

### Debugging

| Tool | Description |
|------|-------------|
| `get_schema_info` | Kiwi schema information |
| `get_raw_message` | Raw decoded message |
| `list_archive_contents` | List files in the archive |
| `clear_cache` | Clear file cache |

### render_screen options

| Option | Description |
|--------|-------------|
| `includeImages` | Embed image fills (default: false) |
| `downloadFonts` | Download missing Google Fonts for fallback text, cached in `~/.cache/fig-mcp/fonts` (default: true; sends font family names to Google — set false for fully offline rendering) |
| `fontMap` | Fallback families for non-Google fonts, e.g. `{"AFSGillSBCond": "Gill Sans"}` |
| `fontDirs` | Extra directories to scan for font files |
| `scale`, `maxWidth`, `maxHeight`, `background`, `maxDepth`, `includeText/Fills/Strokes/Shadows` | Rendering controls |

Most text renders from **glyph outlines embedded in the file** and needs no fonts at all; the font options only affect text without embedded glyph data.

## How It Works

1. `.fig` files are ZIP archives containing:
   - `canvas.fig` - Main document data (kiwi binary format)
   - `meta.json` - File metadata
   - `thumbnail.png` - Preview image
   - `images/` - Image assets

2. The `canvas.fig` uses Evan Wallace's [kiwi](https://github.com/evanw/kiwi) binary format

3. The kiwi schema is embedded in each file and extracted at parse time

4. Document data is decoded and transformed into structured information

5. Layout properties are inferred from node positions and auto-layout settings

## Features

- Parse `.fig` files locally without API access
- Extract document structure, nodes, and hierarchy
- Infer layout properties (flexbox-like direction, gap, padding, alignment)
- Extract colors, text content, and styling information
- Render nodes to PNG screenshots with near-design fidelity
- Export vectors as SVG, PDF, PNG, or WebP
- Effects (shadows, layer blur), gradients, masks, dashed borders — background/glass blur is approximated by the translucent fill (SVG has no backdrop-filter)

## Fork changes

Rendering fidelity (verified pixel-by-pixel against Figma prototype screenshots):

- **Embedded glyph rendering**: text renders from the glyph outlines stored in the file (`derivedTextData.glyphs`), reproducing exact letterforms of fonts that are not installed anywhere — including circular text on paths with per-glyph rotation
- Component INSTANCE resolution in both rendering and `get_text_content` (SYMBOL expansion with overrides, incl. `componentPropAssignments`)
- Masks become SVG clipPaths (icon "Bounding box" layers no longer paint over glyphs)
- Frame borders render from Figma's precomputed `strokeGeometry` (dashes included; invisible borders stay invisible)
- Linear/radial gradient fills, mirrored (negative-scale) nodes, `textCase`, rotated text
- Sibling z-order follows the fractional-index position (not nodeChanges order)
- Google Fonts on-demand download + `fontMap`/`fontDirs` for fallback text

Robustness:

- Schema-driven argument validation with clear error messages
- `resolveNodePath` handles node names containing `/` and reports candidates on failure
- BigInt-safe `get_raw_message`; graceful fallbacks when geometry blobs are missing
- `server.ts` split into per-category tool modules; vitest suite (`npm test`)

## Testing

```bash
npm test
```

Unit tests run standalone. Integration tests against a real file run when
`FIG_TEST_FILE` points at a `.fig` export (defaults to `~/Downloads/toritori2.0.fig`).

## Requirements

- Node.js 20 or higher

## Limitations

- The `.fig` format is undocumented and may change
- This is for local `.fig` files only (use a cloud API for hosted files)
- Some complex properties may not be fully parsed

## License

MIT

## Credits

- [Kiwi](https://github.com/evanw/kiwi) by Evan Wallace - Binary format library
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Protocol implementation
