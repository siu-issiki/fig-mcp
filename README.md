# fig-mcp

ローカルの Figma ファイル（.fig）を AI に読ませるための MCP サーバーです。

Figma 公式の Remote MCP は Free プランだと制限が強く、実用になりませんでした。そこで、Figma から「Save local copy...」でダウンロードした `.fig` ファイルを直接読む MCP を作りました。アカウント連携も API キーも不要で、すべて手元のマシンで完結します。

## できること

- 画面の構造・テキスト・色・レイアウトを AI が読み取れる
- 画面をほぼ見た目どおりの PNG にできる（フォントが手元になくても、ファイル内の文字データから原物どおりに描画）
- アイコンなどを SVG / PDF / PNG / WebP で書き出せる

## 使い方

Claude Code に登録：

```bash
claude mcp add fig-mcp -- npx -y @siu-issiki/fig-mcp
```

あとは Claude に頼むだけです：

> 「~/Downloads/design.fig を読んで、画面の構造を教えて」

> 「この .fig の『ホーム画面』を PNG で見せて」

### ブラウザで直接眺める

MCP を使わずに、ビューアでデザインを確認することもできます：

```bash
npx -y @siu-issiki/fig-mcp viewer design.fig
# http://localhost:3000 が開きます
```

## AI が使えるツール

21個のツールを提供します。AI が自分で選んで使うので、覚える必要はありません。

| 分類 | ツール |
|------|------|
| 構造を読む | `parse_fig_file`, `get_document_summary`, `get_tree_summary`, `list_pages`, `get_page_contents` |
| 部品を探す | `find_nodes`, `get_node_details`, `get_node_by_id`, `get_layout_info` |
| 中身を抜き出す | `get_text_content`, `get_colors`, `list_nodes_with_fills` |
| 画像にする | `render_screen`, `get_vector`, `list_images`, `get_image`, `get_thumbnail` |
| 調査用 | `get_schema_info`, `get_raw_message`, `list_archive_contents`, `clear_cache` |

### render_screen の主なオプション

| オプション | 説明 |
|--------|------|
| `includeImages` | 写真などの画像も埋め込む（初期値: off） |
| `downloadFonts` | 足りないフォントを Google Fonts から自動取得（初期値: on）。`~/.cache/fig-mcp/fonts` に保存され、2回目以降は通信しません。オフライン動作させたい場合は off に |
| `fontMap` | 手に入らないフォントの身代わりを指定（例: `{"AFSGillSBCond": "Gill Sans"}`） |
| `scale` / `maxWidth` / `maxHeight` / `background` など | 画像サイズや背景色の調整 |

ほとんどのテキストはファイルに埋め込まれた文字の形をそのまま描画するため、フォントが無くても原物どおりに表示されます。

## 仕組み

`.fig` ファイルの正体は ZIP で、デザインデータ本体（Figma 独自のバイナリ形式）と画像素材が入っています。データの読み方（スキーマ）もファイルに同梱されているので、それを取り出して解読し、AI が扱いやすい形に変換しています。バイナリ形式には Figma の元CTO Evan Wallace 氏の [kiwi](https://github.com/evanw/kiwi) が使われています。

## 制限事項

- `.fig` 形式は非公開仕様のため、Figma のアップデートで読めなくなる可能性があります
- ローカルに保存した `.fig` ファイル専用です
- 背面ぼかし（すりガラス表現）は SVG の制約で再現できず、半透明の板として描画されます

## 開発者向け

```bash
git clone https://github.com/siu-issiki/fig-mcp
cd fig-mcp && npm install && npm run build
npm test
```

実ファイルを使う統合テストは、環境変数 `FIG_TEST_FILE` に `.fig` のパスを設定すると実行されます。

動作要件: Node.js 20 以上

## ライセンス

MIT

## クレジット

- フォーク元: [bilalba/fig-mcp](https://github.com/bilalba/fig-mcp)
- [Kiwi](https://github.com/evanw/kiwi) by Evan Wallace — バイナリ形式ライブラリ
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — プロトコル実装
