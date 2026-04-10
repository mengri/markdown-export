#!/usr/bin/env node
/**
 * markdown-export — Markdown Preview Enhanced 风格的导出工具
 * 
 * 将 Markdown 文件导出为 PDF / PNG / JPG，
 * 输出路径与源文件同目录、同文件名，仅扩展名不同。
 * 
 * 用法:
 *   node export.js <input.md> [pdf|png|jpg]
 *   node export.js README.md pdf
 *   node export.js screenshot.png png
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ---------------------------------------------------------------------------
// 依赖（使用 skill 本地 node_modules，通过 __dirname 定位）
// ---------------------------------------------------------------------------
const SKILL_ROOT = path.resolve(__dirname, '..');
const LOCAL_MODULES = path.join(SKILL_ROOT, 'node_modules');

const puppeteer = require(path.join(LOCAL_MODULES, 'puppeteer-core'));
const { marked } = require(path.join(LOCAL_MODULES, 'marked'));
const hljs = require(path.join(LOCAL_MODULES, 'highlight.js'));

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 系统 Chrome 搜索路径（优先级从高到低） */
function findChromePath() {
  const extraPaths = [];
  if (process.platform === 'win32') {
    extraPaths.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
    // 遍历 Program Files 下所有可能版本
    const appDir = 'C:\\Program Files\\Google\\Chrome\\Application';
    if (fs.existsSync(appDir)) {
      fs.readdirSync(appDir).forEach(name => {
        const full = path.join(appDir, name, 'chrome.exe');
        if (fs.existsSync(full)) extraPaths.push(full);
      });
    }
  } else if (process.platform === 'darwin') {
    extraPaths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    );
  } else {
    extraPaths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    );
  }

  for (const p of extraPaths) {
    if (p && fs.existsSync(p)) return p;
  }

  // 尝试 puppeteer-core 内置搜索
  const found = puppeteer.executablePath();
  if (found && fs.existsSync(found)) return found;

  throw new Error(
    `无法找到 Chrome/Chromium。请确认已安装 Google Chrome。\n` +
    `搜索过的路径: ${extraPaths.filter(Boolean).join(', ')}`
  );
}

/** marked 配置：代码高亮 */
marked.use({
  renderer: {
    code(token) {
      const lang = (token.lang || '').split(':')[0].trim();
      const code = token.text;
      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(code, { language: lang }).value;
          return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>\n`;
        } catch (_) {}
      }
      const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<pre><code>${escaped}</code></pre>\n`;
    }
  }
});

// ---------------------------------------------------------------------------
// HTML 模板（MPE 风格，含中文字体和打印优化）
// ---------------------------------------------------------------------------

function buildHtmlTemplate(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Export</title>
  <style>
    /* ===================== 基本重置 ===================== */
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      font-size: 14px;
      color: #24292e;
    }

    /* ===================== 字体（中文优先） ===================== */
    body {
      font-family: -apple-system, BlinkMacSystemFont,
                   "Segoe UI Variable", "Segoe UI", system-ui,
                   "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB",
                   "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
      line-height: 1.7;
    }

    /* ===================== 容器（MPE 风格） ===================== */
    #preview {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 60px 60px;
    }

    /* ===================== 标题 ===================== */
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.25;
      color: #1a1a1a;
    }
    h1 { font-size: 2em;    border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em;  border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1em; }

    /* ===================== 段落与列表 ===================== */
    p  { margin: 0.8em 0; }
    ul, ol { padding-left: 2em; margin: 0.8em 0; }
    li { margin: 0.25em 0; }
    li > p { margin: 0.3em 0; } /* 列表内的紧凑段落 */

    /* ===================== 代码 ===================== */
    code {
      font-family: "Cascadia Code", "Fira Code", "Source Code Pro", "JetBrains Mono", monospace;
      font-size: 0.875em;
      background: rgba(135, 131, 120, 0.12);
      border-radius: 3px;
      padding: 0.15em 0.35em;
    }
    pre {
      background: #f6f8fa;
      border: 1px solid #e1e4e8;
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      margin: 1em 0;
      line-height: 1.5;
    }
    pre code {
      background: none;
      padding: 0;
      font-size: 0.9em;
      border-radius: 0;
    }

    /* ===================== 代码高亮（GitHub Light 风格） ===================== */
    .hljs { display: block; overflow-x: auto; color: #24292e; }
    .hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-addition { color: #d73a49; }
    .hljs-number, .hljs-string, .hljs-meta .hljs-meta-string,
    .hljs-literal, .hljs-doctag, .hljs-regexp { color: #032f62; }
    .hljs-title, .hljs-section, .hljs-name, .hljs-selector-id,
    .hljs-selector-class { color: #6f42c1; }
    .hljs-attribute, .hljs-attr, .hljs-variable,
    .hljs-template-variable, .hljs-class .hljs-title,
    .hljs-type { color: #005cc5; }
    .hljs-symbol, .hljs-bullet, .hljs-subst, .hljs-meta,
    .hljs-meta .hljs-keyword, .hljs-link { color: #e36209; }
    .hljs-built_in, .hljs-deletion { color: #22863a; }
    .hljs-formula { background: #f6f8fa; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong  { font-weight: bold; }

    /* ===================== 表格 ===================== */
    table {
      border-collapse: collapse;
      border-spacing: 0;
      width: 100%;
      margin: 1em 0;
      font-size: 0.9em;
      overflow: auto;
      display: block;
    }
    th, td {
      border: 1px solid #dfe2e5;
      padding: 6px 13px;
    }
    th {
      background: #f6f8fa;
      font-weight: 600;
    }
    tr:nth-child(2n) { background: #f6f8fa; }

    /* ===================== 引用 ===================== */
    blockquote {
      margin: 1em 0;
      padding: 0 1em;
      color: #6a737d;
      border-left: 4px solid #dfe2e5;
    }
    blockquote > :first-child { margin-top: 0; }
    blockquote > :last-child  { margin-bottom: 0; }

    /* ===================== HR ===================== */
    hr {
      border: none;
      border-top: 1px solid #eaecef;
      margin: 1.5em 0;
    }

    /* ===================== 图片 ===================== */
    img {
      max-width: 100%;
      height: auto;
      display: block;
      border-radius: 4px;
    }

    /* ===================== 链接 ===================== */
    a { color: #0366d6; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ===================== Mermaid / 数学（占位，不影响渲染） ===================== */
    .mermaid svg, .math { display: block; margin: 1em auto; }

    /* ===================== 打印优化（MPE 核心） ===================== */
    @media print {
      @page {
        margin: 1.5cm 2cm;
        size: A4;
      }
      body {
        font-size: 12px;
      }
      #preview {
        padding: 0;
        max-width: 100%;
      }
      h1 { font-size: 1.6em; }
      h2 { font-size: 1.3em; }
      h3 { font-size: 1.1em; }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #f6f8fa !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      code {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      /* 代码背景色必须打印 */
      pre code { background: #f6f8fa !important; }
    }

    /* ===================== 深色模式支持 ===================== */
    @media (prefers-color-scheme: dark) {
      body { background: #0d1117; color: #c9d1d9; }
      h1, h2, h3, h4 { color: #f0f6fc; }
      h1 { border-bottom-color: #30363d; }
      h2 { border-bottom-color: #30363d; }
      pre { background: #161b22; border-color: #30363d; }
      th { background: #161b22; }
      tr:nth-child(2n) { background: #161b22; }
      blockquote { border-left-color: #30363d; color: #8b949e; }
      hr { border-top-color: #30363d; }
      table { border-color: #30363d; }
      th, td { border-color: #30363d; }
      a { color: #58a6ff; }
    }
  </style>
</head>
<body>
<div id="preview">
${bodyHtml}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 导出函数
// ---------------------------------------------------------------------------

/**
 * 将 Markdown 文件导出为 PDF/PNG/JPG
 * 
 * @param {string} inputPath   - 输入 .md 文件路径
 * @param {string} fileType     - 'pdf' | 'png' | 'jpg'
 * @param {object} options
 * @param {number} options.timeout - 等待渲染完成的超时（ms）
 */
async function exportMarkdown(inputPath, fileType = 'pdf', options = {}) {
  const timeout = options.timeout || 30000;

  // 解析路径
  const parsed = path.parse(inputPath);
  if (parsed.ext.toLowerCase() !== '.md') {
    throw new Error(`输入文件必须是 .md 文件: ${inputPath}`);
  }

  // 输出路径：同目录、同文件名、不同扩展名
  const outputPath = path.join(parsed.dir, parsed.name + '.' + fileType);

  // 读取 Markdown
  if (!fs.existsSync(inputPath)) {
    throw new Error(`文件不存在: ${inputPath}`);
  }
  const markdown = fs.readFileSync(inputPath, 'utf-8');

  // 渲染为 HTML
  let bodyHtml;
  try {
    bodyHtml = marked.parse(markdown, { breaks: true, gfm: true });
  } catch (err) {
    throw new Error(`Markdown 解析失败: ${err.message}`);
  }

  // 组装完整 HTML
  const fullHtml = buildHtmlTemplate(bodyHtml);

  // 启动 Chrome
  const chromePath = findChromePath();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
    ],
    protocolTimeout: timeout,
  });

  let tmpHtml = null;
  try {
    const page = await browser.newPage();

    // 视口（影响 PNG/JPG 截图宽度）
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });

    // 写入临时 HTML
    tmpHtml = path.join(os.tmpdir(), `markdown-export-${Date.now()}-${process.pid}.html`);
    fs.writeFileSync(tmpHtml, fullHtml, 'utf-8');

    // 加载页面
    const fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/');
    await page.goto(fileUrl, {
      waitUntil: 'networkidle0',
      timeout,
    });

    // 等待一小段时间确保字体/高亮完全渲染
    await new Promise(r => setTimeout(r, 500));

    // 导出
    if (fileType === 'pdf') {
      const pdfOptions = {
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top:    '1.5cm',
          bottom: '1.5cm',
          left:   '2cm',
          right:  '2cm',
        },
        displayHeaderFooter: false,
        scale: 1.0,
        timeout,
      };

      await page.pdf(pdfOptions);

    } else {
      // PNG / JPG
      const screenshotOptions = {
        path:       outputPath,
        fullPage:   true,
        type:       fileType === 'jpg' ? 'jpeg' : 'png',
        omitBackground: false,
        timeout,
      };

      await page.screenshot(screenshotOptions);
    }

    await page.close();
    return outputPath;

  } finally {
    // 清理临时文件
    if (tmpHtml && fs.existsSync(tmpHtml)) {
      try { fs.unlinkSync(tmpHtml); } catch (_) {}
    }
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('用法: node export.js <input.md> [pdf|png|jpg]');
    console.error('示例: node export.js README.md pdf');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const fileType  = (args[1] || 'pdf').toLowerCase();

  if (!['pdf', 'png', 'jpg'].includes(fileType)) {
    console.error(`不支持的格式: ${fileType}，支持: pdf, png, jpg`);
    process.exit(1);
  }

  console.error(`[markdown-export] 输入: ${inputPath}`);
  console.error(`[markdown-export] 格式: ${fileType}`);

  const start = Date.now();
  try {
    const outputPath = await exportMarkdown(inputPath, fileType);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(outputPath); // stdout: 输出文件路径（供调用方捕获）
    console.error(`[markdown-export] ✅ 完成 (${elapsed}s)`);
  } catch (err) {
    console.error(`[markdown-export] ❌ 失败: ${err.message}`);
    process.exit(1);
  }
}

main();
