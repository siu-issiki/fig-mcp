# fig-mcp

**ローカルの Figma ファイル（.fig）を、AIが読めるようにするMCPサーバー**です。

Figma で「Save local copy...」した `.fig` ファイルを渡すと、Claude などのAIアシスタントがデザインの中身（画面の構造・テキスト・色・レイアウト）を直接読み取れるようになります。Figma のアカウント連携やAPIキーは不要で、すべて手元のマシンで完結します。

「このデザインどおりに実装して」とAIに頼むとき、スクリーンショットを見せる代わりに `.fig` ファイルそのものを読ませられる、と考えるとイメージしやすいと思います。

[bilalba/fig-mcp](https://github.com/bilalba/fig-mcp) をフォークして、描画の再現度と安定性を大きく改善したものです（詳細は[フォークでの改善点](#フォークでの改善点)）。

## できること

- **デザインの構造を読む** — 画面にどんなフレームや部品がどう並んでいるかをツリーで取得
- **テキストを抜き出す** — ボタンのラベルや見出しなど、画面上の文字をすべて取得（コンポーネント内の上書きテキストも対応）
- **色やレイアウトを調べる** — 使われている色の一覧や、余白・整列などのレイアウト情報を取得
- **画面をPNG画像にする** — デザインをほぼ見た目どおりに画像化。フォントが手元になくても、ファイル内に埋め込まれた文字の形をそのまま使うので原物どおりに描画されます
- **アイコンをSVGで書き出す** — ベクター要素を SVG / PDF / PNG / WebP に変換

## インストール

npm に公開済みなので、インストール作業は不要です。Claude Code なら次の1コマンドで使えるようになります：

```bash
claude mcp add fig-mcp -- npx -y @siu-issiki/fig-mcp
```

あとは Claude にこう頼むだけです：

> 「~/Downloads/design.fig を読んで、画面の構造を教えて」

> 「この .fig の『ホーム画面』をPNGでレンダリングして見せて」

## MCPを使わずに直接使う

### ブラウザでデザインを眺める（Webビューア）

```bash
npx -y @siu-issiki/fig-mcp viewer design.fig
# ブラウザで http://localhost:3000 が開きます
```

ツリーをたどりながらプレビューでき、MCPツールに渡すノードIDのコピーもできます。

### ターミナルで中身を確認する

```bash
npx -y @siu-issiki/fig-mcp inspect design.fig summary  # 画面構造をツリー表示
npx -y @siu-issiki/fig-mcp inspect design.fig stats    # 部品の種類ごとの数
npx -y @siu-issiki/fig-mcp inspect design.fig json     # JSONで出力
```

## AIが使えるツール一覧

MCPサーバーとして、AIに以下の21個のツールを提供します。ふだん使う分には意識する必要はありません（AIが自分で選んで使います）。

### 構造を読む

| ツール | 説明 |
|------|------|
| `parse_fig_file` | ファイル全体を簡略化した構造で返す |
| `get_document_summary` | 構造をテキストのツリーで返す（ページ送り対応） |
| `get_tree_summary` | 子要素の数つきの階層サマリー。深掘りの起点に |
| `list_pages` | ページの一覧 |
| `get_page_contents` | 特定ページの中身 |

### 部品を探す・調べる

| ツール | 説明 |
|------|------|
| `find_nodes` | 名前や種類で部品を検索 |
| `get_node_details` | パス（例: `Page 1/ホーム/ヘッダー`）で部品の詳細を取得 |
| `get_node_by_id` | ID（例: `457:1607`）で部品の詳細を取得 |
| `get_layout_info` | 余白・整列などのレイアウト情報（CSSのflexbox風） |

### 中身を抜き出す

| ツール | 説明 |
|------|------|
| `get_text_content` | テキストをすべて抽出 |
| `get_colors` | 使われている色の一覧 |
| `list_nodes_with_fills` | 塗りを持つ部品の一覧 |

### 画像にする

| ツール | 説明 |
|------|------|
| `render_screen` | 画面をPNG画像にする（オプションは下記） |
| `get_vector` | ベクター要素を SVG / PDF / PNG / WebP で書き出す |
| `list_images` | ファイル内の画像素材の一覧 |
| `get_image` | 画像素材を取り出す |
| `get_thumbnail` | ファイルのサムネイルを取得 |

### 調査・デバッグ用

| ツール | 説明 |
|------|------|
| `get_schema_info` / `get_raw_message` / `list_archive_contents` / `clear_cache` | ファイル形式の調査やキャッシュ操作に使う低レベルツール |

### render_screen のオプション

| オプション | 説明 |
|--------|------|
| `includeImages` | 写真などの画像も埋め込む（初期値: off） |
| `downloadFonts` | 足りないフォントを Google Fonts から自動取得（初期値: on）。取得したフォントは `~/.cache/fig-mcp/fonts` に保存され、2回目以降は通信しません。フォント名がGoogleに送られるのが気になる場合は off に |
| `fontMap` | 手に入らないフォントの身代わりを指定（例: `{"AFSGillSBCond": "Gill Sans"}`） |
| `fontDirs` | フォントファイルを追加で探すフォルダ |
| `scale` / `maxWidth` / `maxHeight` / `background` など | 画像サイズや背景色の調整 |

なお、ほとんどのテキストは**ファイルに埋め込まれた文字の形（グリフ）をそのまま描画**するため、フォントが無くても原物どおりに表示されます。フォント関連のオプションが効くのは、埋め込みデータを持たない一部のテキストだけです。

## 仕組み（ざっくり）

`.fig` ファイルの正体は ZIP で、中にはデザインデータ本体（Figma 独自のバイナリ形式）と画像素材が入っています。ありがたいことにデータの読み方（スキーマ）自体もファイルに同梱されているので、それを取り出して解読し、AIが扱いやすい形に変換しています。バイナリ形式には Figma の元CTO Evan Wallace 氏の [kiwi](https://github.com/evanw/kiwi) が使われています。

## フォークでの改善点

本家からフォークして、実際のデザインファイルとFigmaプロトタイプのスクリーンショットを見比べながら改善を重ねました。

**見た目の再現度：**

- ファイル埋め込みの文字の形（グリフ）で描画し、未所持フォントでも原物どおりの文字に（円形に沿った文字も回転込みで再現）
- コンポーネントのインスタンス展開（上書きされたテキストや表示/非表示も反映）
- マスク、破線の枠線、グラデーション（回転追従）、レイヤーブラー、反転・回転した画像に対応
- 重なり順（z順）を正しく再現

**安定性：**

- 引数の間違いに分かりやすいエラーメッセージを返す
- `/` を含む名前の部品も正しくパスで辿れる。見つからないときは候補を提示
- データの欠けに対して落ちずにフォールバック
- テストスイートを整備（`npm test`）

## 制限事項

- `.fig` 形式は非公開仕様のため、Figma のアップデートで読めなくなる可能性があります
- ローカルに保存した `.fig` ファイル専用です（クラウド上のファイルは Figma 公式のMCPをどうぞ）
- 背面ぼかし（すりガラス表現）は SVG の制約で再現できず、半透明の板として描画されます

## 開発者向け

```bash
git clone https://github.com/siu-issiki/fig-mcp
cd fig-mcp && npm install && npm run build
npm test
```

単体テストはそのまま動きます。実ファイルを使う統合テストは、環境変数 `FIG_TEST_FILE` に `.fig` ファイルのパスを設定すると実行されます。

動作要件: Node.js 20 以上

## ライセンス

MIT

## クレジット

- [Kiwi](https://github.com/evanw/kiwi) by Evan Wallace — バイナリ形式ライブラリ
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — プロトコル実装
- フォーク元: [bilalba/fig-mcp](https://github.com/bilalba/fig-mcp)
