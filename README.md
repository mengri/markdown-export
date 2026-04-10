# markdown-export

> 将 Markdown 文件以 MPE（Markdown Preview Enhanced）风格导出为 PDF / PNG / JPG。

## ✨ 特性

- **PDF 导出** — A4 格式，含代码背景色、表格边框、打印优化
- **PNG 截图** — 全页面截图，2x 分辨率
- **JPG 截图** — 同上，JPEG 格式（文件更小）
- **代码高亮** — 支持 190+ 语言（GitHub Light 风格）
- **中文字体** — 优先使用系统雅黑 / 苹方 / Noto
- **MPE 行为一致** — 输出路径与源文件同目录、同文件名，仅扩展名不同

## 📦 安装

```bash
# PowerShell / bash / zsh
npm install

# 无需安装 Chromium，脚本会自动搜索系统已安装的 Chrome
```

## 🚀 快速开始

### CLI

```bash
# PDF（默认）
node scripts/export.js README.md

# 指定格式
node scripts/export.js README.md pdf
node scripts/export.js README.md png
node scripts/export.js README.md jpg
```

### Agent 调用

```python
import subprocess, os

skill_dir = r"{workspace_root_dir}\skills\markdown-export"
script = os.path.join(skill_dir, "scripts", "export.js")
input_md = r"C:\path\to\README.md"

result = subprocess.run(
    ["node", script, input_md],
    capture_output=True, text=True, timeout=120
)

if result.returncode == 0:
    output_path = result.stdout.strip()
    print(f"导出成功: {output_path}")
else:
    print(f"失败: {result.stderr}")
```

## 🎨 渲染效果

| 特性 | 说明 |
|------|------|
| 页面宽度 | max-width: 900px，居中 |
| 字体 | 中文优先雅黑/苹方/Noto，代码等宽字体 |
| 代码块 | GitHub Light 风格语法高亮，含背景色 |
| 表格 | 边框、斑马纹、响应式 |
| 引用/HR | 标准 GitHub Markdown 风格 |
| 打印 | A4 边距 1.5cm/2cm，代码背景色保留 |
| 深色模式 | 自动适配系统深色模式 |

## ⚠️ 注意事项

- 输入必须是 `.md` 文件
- Chrome 必须已安装（脚本会自动搜索系统路径）
- 网络图片需要在线才能加载（离线时显示占位）
- Mermaid 图表等高级扩展暂不支持

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。
