# gpt-image-mcp-server

本地 MCP server，透過 stdio 把 OpenAI 的 `gpt-image-2` 圖片生成 / 編輯功能提供給 Claude Code、Claude Desktop 等 MCP client 使用。

## 安裝

```bash
cd gpt-image-mcp-server
npm install
npm run build
```

## 環境變數

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 是 | OpenAI API key |
| `OPENAI_IMAGE_MODEL` | 否 | 預設 `gpt-image-2`；若帳號尚未開通可改成 `gpt-image-1` |
| `GPT_IMAGE_OUTPUT_DIR` | 否 | 預設輸出目錄，預設 `./generated-images` |

## 設定到 Claude Code

```bash
claude mcp add gpt-image -e OPENAI_API_KEY=sk-xxx -- node /絕對路徑/seasonflavor/gpt-image-mcp-server/dist/index.js
```

或在專案的 `.mcp.json`：

```json
{
  "mcpServers": {
    "gpt-image": {
      "command": "node",
      "args": ["/絕對路徑/seasonflavor/gpt-image-mcp-server/dist/index.js"],
      "env": { "OPENAI_API_KEY": "sk-xxx" }
    }
  }
}
```

Claude Desktop 的 `claude_desktop_config.json` 格式相同。

## 工具

### `generate_image`
用文字 prompt 生成圖片並存到本地。

參數：`prompt`（必填）、`n`（1-10）、`size`（`auto` / `1024x1024` / `1536x1024` / `1024x1536`）、`quality`（`auto` / `low` / `medium` / `high`）、`background`（`auto` / `opaque` / `transparent`）、`output_format`（`png` / `jpeg` / `webp`）、`output_directory`、`filename_prefix`。

### `edit_image`
用 prompt 編輯、局部重繪（搭配 `mask_path`）或合成多張本地圖片，結果以 PNG 存到本地。

參數：`prompt`、`image_paths`（必填，最多 16 張）、`mask_path`、`n`、`size`、`quality`、`background`、`output_directory`、`filename_prefix`。

兩個工具都會回傳存檔路徑，並把前 4 張圖以內嵌圖片附回給 client 預覽。

## 範例

> 幫我用 gpt-image 生成一張秋季季節限定菜單的橫幅，1536x1024，存到 images/

Claude 會呼叫 `generate_image` 並把檔案寫進 `images/`。
