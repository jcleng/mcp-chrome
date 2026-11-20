# GitHub Pages 站点源

这里的内容会被 `.github/workflows/pages.yml` 发布到 GitHub Pages。

- `index.html` —— 站点首页（下载入口 + 本版本新增能力说明）
- `releases/` —— 构建产物（由 workflow 从仓库根目录的 `releases/` 复制过来）

本地更新扩展包后，重新运行 **Actions → Deploy GitHub Pages → Run workflow** 即可刷新下载链接。
