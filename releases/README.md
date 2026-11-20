# Chrome MCP Server Extension - Latest Release

> 构建版本：**1.0.0**（含新增工具 `chrome_find_by_text` 与紧凑 `chrome_read_page` 输出）
>
> 历史版本：「releases/chrome-extension/」目录下按构建日期归档，文件名形如 `chrome-mcp-server-YYYYMMDD.zip`。

## 🔄 发布流程（CI 自动完成）

推送版本 tag 即可自动构建并发布：

```bash
git tag v1.0.1 && git push origin v1.0.1
```

`.github/workflows/release-extension.yml` 会依次：

1. 安装依赖（只装 `chrome-mcp-server` 与 `chrome-mcp-shared`，跳过 `native-server` 的 postinstall）
2. 构建 shared → 构建扩展 → `wxt zip`
3. 质量门：校验 zip 完整性、确认打包后的注入脚本含 `findByText`
4. 创建 GitHub Release（`v*` tag）并附加 `chrome-mcp-server-<version>-chrome.zip` 与 `chrome-mcp-server-latest.zip`
5. 把新包写入 `releases/`（`latest/` + 按日期归档目录）并提交回 `master`
6. 触发 `pages.yml` 刷新站点下载链接

也可手工触发（Actions → **Build and Release Extension** → Run workflow），填写 `tag` 才会发布 Release，留空则只构建并上传 artifact。

## 🚀 快速安装

> **重要：扩展和 bridge 必须成对安装。**
> 工具清单（`chrome_find_by_text` 等）由 bridge 里的 `chrome-mcp-shared` 提供，扩展只负责实现。
> 只装扩展而 bridge 还是 npm 官方版，工具就不会出现在 MCP 客户端里。

### 1. 安装 bridge（MCP 服务端）

npm 上的 `mcp-chrome-bridge` **不含**本仓库新增的工具，必须用本仓库构建的版本。

任选一种：

**方式 A：从源码构建并全局链接（推荐，便于后续 `git pull` 升级）**

```bash
# 1) 克隆并装依赖（只装需要的两个包，跳过 native-server 的 postinstall）
git clone https://github.com/jcleng/mcp-chrome && cd mcp-chrome
pnpm --filter mcp-chrome-bridge... --filter chrome-mcp-shared install --no-frozen-lockfile

# 2) 构建 shared 和 bridge（上一步 postinstall 会报错，属正常，构建后即修复）
pnpm --filter chrome-mcp-shared build
pnpm --filter mcp-chrome-bridge build

# 3) 全局安装（pnpm 特有，无需发布到 npm；首次可能需先 pnpm setup）
cd app/native-server
pnpm link --global
```

之后更新代码只需重新执行第 2 步的 build，全局命令立即是新版。

**方式 B：使用 Release 附带的本地包**

```bash
npm install -g ./mcp-chrome-bridge-<version>-local.tgz
```

> 注意：`npm install -g github:...#path:app/native-server` 或 pnpm 等价写法**不可用**，
> 因为子包依赖 `chrome-mcp-shared: workspace:*`，单包安装无法解析该协议。

### 2. 注册 Native Messaging Host

```bash
mcp-chrome-bridge register
# 注册失败时可加 --detect 自动探测浏览器
mcp-chrome-bridge register --detect
```

### 3. 下载并加载扩展

下载 [chrome-mcp-server-latest.zip](/releases/chrome-extension/latest/chrome-mcp-server-latest.zip)

（旧链接 `/releases/chrome-extension/latest/chrome-mcp-server-lastest.zip` 同样可用，指向同一个包。）

1. 解压 zip
2. 打开 `chrome://extensions/`，开启「开发者模式」
3. 「加载已解压的扩展程序」，选择解压后的目录

### 4. 核对扩展 ID（最容易出错的一步）

在 `chrome://extensions/` 记下扩展 ID，然后检查注册文件：

```bash
# Linux
cat ~/.config/google-chrome/NativeMessagingHosts/com.chromemcp.nativehost.json
# 系统级注册时
cat /etc/opt/chrome/native-messaging-hosts/com.chromemcp.nativehost.json
# macOS
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.chromemcp.nativehost.json
```

`allowed_origins` 里的 ID 必须与实际扩展 ID 一致，否则浏览器会报：

```
Native connection disconnected {message: 'Access to the specified native messaging host is forbidden.'}
```

**不一致时**，把该文件里的 ID 改成你的实际 ID，然后**完全退出并重启 Chrome**（刷新扩展无效）：

```bash
sed -i 's/<旧ID>/<你的ID>/g' <上面那个 json 路径>
```

### 5. 连接 MCP 客户端

扩展弹窗里确认端口（默认 `12306`），点连接。MCP 客户端配置为 Streamable HTTP：

```
http://127.0.0.1:12306/mcp
```

验证工具已就位：

```bash
curl -sS -X POST http://127.0.0.1:12306/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o chrome_find_by_text
```

---

## 🧭 推荐使用流程

新加了按文字定位的能力，日常操作建议这样组合，能显著省 token：

### 场景一：知道要点什么

直接按文字找，不要先拉整页大纲：

```jsonc
// 1) 按文字定位
{ "name": "chrome_find_by_text", "arguments": { "text": "提交订单" } }
// → { "count": 1, "matches": [{ "ref": "ref_12", "role": "button", ... }] }

// 2) 拿 ref 直接操作
{ "name": "chrome_fill_or_select", "arguments": { "ref": "ref_12", "value": "..." } }
// 或 { "name": "chrome_click_element", "arguments": { "ref": "ref_12" } }
```

实用参数：

| 参数 | 用途 |
| --- | --- |
| `exact: true` | 要求文字完全一致，不接受模糊匹配 |
| `tag: "button"` | 只在该标签里找（`a` / `input` / `button` / `label`） |
| `maxResults` | 返回条数，默认 5 |
| `minScore` | 模糊匹配下限，默认 0.6 |

### 场景二：不知道页面上有什么

先用紧凑大纲看清结构，再用 ref 操作：

```jsonc
{ "name": "chrome_read_page", "arguments": { "filter": "interactive" } }
// 输出每行一个元素，可操作节点带 [ref=ref_N]，静态文本合并为 "- text: ..."
```

### 场景三：只想要正文文字

```jsonc
{ "name": "chrome_read_page", "arguments": {} }
```

### 行为说明（实测）

- 两个工具返回**同一套 ref**，可互换使用；ref 在同一页面生命周期内稳定
- `find_by_text` 优先返回**最内层**元素，再上溯到可操作控件（`<label>` → 其对应的 input/button）
- 自动覆盖 open shadow DOM 与同源 iframe
- 代码示例（`<pre>` / `<code>`）里的文字会被大幅降权，避免命中文档示例
- 仅在无精确/包含命中时才启用模糊匹配；传 `tag` 时不启用模糊兜底
- **元素不在视口时 `fill` 会报 “not visible”**，先用 `chrome_computer` 的 `scroll_to`（可传 `ref`）滚过去

### 效果（实测数据）

| 场景 | `read_page` 全量 | `find_by_text` | 节省 |
| --- | --- | --- | --- |
| 400 行表格页面找「删除」 | 25453 字符 | 881 字符 | **96%** |
| 类维基页面整页大纲 | — | — | 体积降 84–90% |

---

## 🔧 故障排除

### 1. `Access to the specified native messaging host is forbidden.`

最常见的问题，分两种原因：

**a) bridge 没装或没注册** —— 检查 host 文件是否存在：

```bash
ls ~/.config/google-chrome/NativeMessagingHosts/com.chromemcp.nativehost.json \
   /etc/opt/chrome/native-messaging-hosts/com.chromemcp.nativehost.json 2>/dev/null
```

都没有就执行 `mcp-chrome-bridge register`。

**b) 扩展 ID 与 `allowed_origins` 不一致**（装本仓库构建的包时几乎必然发生）

本仓库构建的 `manifest.json` 未写入固定 `key`，Chrome 会按解压目录路径派生 ID。核对方法：

```
chrome://extensions/ 里看到的 ID  ←→  manifest 里 allowed_origins 的 ID
```

不一致就改 JSON 里的 ID，然后**完全退出 Chrome 再启动**（仅刷新扩展无效）。

### 2. 工具列表里没有 `chrome_find_by_text`

说明 MCP 服务端（bridge）还是 npm 官方版。工具清单由 bridge 内的 `chrome-mcp-shared` 提供：

```bash
# 确认当前安装的版本和工具数
node -e "const s=require('/usr/lib/node_modules/mcp-chrome-bridge/node_modules/chrome-mcp-shared'); \
console.log(s.TOOL_SCHEMAS.length, s.TOOL_SCHEMAS.some(t=>t.name==='chrome_find_by_text'))"
```

输出应为 `28 true`。若是 `27 false`，按上面「安装 bridge」的方式 A 或 B 重装，然后重启 Chrome。

### 3. `Already connected to a transport`

bridge 的 MCP 服务是单实例，上一个客户端断开不彻底时会残留会话。重启 bridge 即可：

```bash
pkill -f "mcp-chrome-bridge/dist/index.js"   # 扩展会自动重新拉起
```

### 4. `Element with selector "undefined" is not visible`

元素存在但不在视口内。先滚动过去再操作：

```jsonc
{ "name": "chrome_computer", "arguments": { "action": "scroll_to", "ref": "ref_12" } }
```

### 5. 改了代码怎么生效

| 改了什么 | 需要做什么 |
| --- | --- |
| 扩展代码（`app/chrome-extension/`） | 重新 `pnpm --filter chrome-mcp-server zip`，替换解压目录，`chrome://extensions/` 点刷新 |
| bridge / 工具清单（`packages/shared/`） | 重新 `pnpm --filter chrome-mcp-shared build && pnpm --filter mcp-chrome-bridge build`，重启 Chrome |

## ⚙️ 配置说明

### Native Server 连接

1. 确保 Native Server 正在运行（默认端口 12306）
2. 在扩展 popup 中输入正确的端口号
3. 点击"连接"按钮测试连接

## 📞 技术支持

遇到问题请：

1. 查看浏览器控制台错误信息
2. 在 GitHub Issues 中搜索相似问题
3. 提交新的 Issue 并附上详细信息

## ⚠️ 安全提醒

- 此扩展具有较高权限，请确保从可信来源下载
