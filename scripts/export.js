#!/usr/bin/env node
/**
 * markdown-export — Markdown Preview Enhanced 风格的导出工具
 *
 * 将 Markdown 文件导出为 PDF / PNG / JPG，
 * 输出路径与源文件同目录、同文件名，仅扩展名不同。
 *
 * 高级特性：
 *   - KaTeX 数学公式（行内 $...$ + 块级 $$...$$）
 *   - Mermaid 流程图 / 时序图 / 甘特图
 *   - YAML Front-matter 解析（封面、标题、作者、日期）
 *   - 任务列表美化（带圆角 checkbox 样式）
 *
 * 用法:
 *   node export.js <input.md> [pdf|png|jpg]
 *   node export.js README.md pdf
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ---------------------------------------------------------------------------
// 依赖（使用 skill 本地 node_modules，通过 __dirname 定位）
// ---------------------------------------------------------------------------
const SKILL_ROOT    = path.resolve(__dirname, '..');
const LOCAL_MODULES = path.join(SKILL_ROOT, 'node_modules');

const puppeteer = require(path.join(LOCAL_MODULES, 'puppeteer-core'));
const { marked } = require(path.join(LOCAL_MODULES, 'marked'));
const hljs      = require(path.join(LOCAL_MODULES, 'highlight.js'));

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 简单的 YAML front-matter 解析（支持基本标量，不含嵌套结构） */
function parseFrontmatter(text) {
  const fmRe = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = text.match(fmRe);
  if (!match) return { frontmatter: null, body: text };

  const raw  = match[1];
  const body = text.slice(match[0].length);
  const data = {};

  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key   = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) data[key] = value;
  }

  return { frontmatter: data, body };
}

/** 系统 Chrome 搜索路径（优先级从高到低） */
function findChromePath() {
  const extraPaths = [];
  if (process.platform === 'win32') {
    extraPaths.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
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

  const found = puppeteer.executablePath();
  if (found && fs.existsSync(found)) return found;

  throw new Error(
    `无法找到 Chrome/Chromium。请确认已安装 Google Chrome。\n` +
    `搜索过的路径: ${extraPaths.filter(Boolean).join(', ')}`
  );
}

// ---------------------------------------------------------------------------
// marked 配置
// ---------------------------------------------------------------------------

/** HTML 转义（用于纯文本代码块内） */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** marked extensions */
const MARKDOWN_EXTENSIONS = [
  // ---- 1. KaTeX 数学：行内 $...$ ----
  {
    name: 'inlineMath',
    level: 'inline',
    start(src) { return src.indexOf('$'); },
    tokenizer(src) {
      const match = src.match(/^\$([^$\n]+?)\$/);
      if (match) {
        return {
          type:  'inlineMath',
          raw:   match[0],
          math:  match[1].trim(),
        };
      }
    },
    renderer(token) {
      return `<span class="math-inline">\\(${escapeHtml(token.math)}\\)</span>`;
    },
  },

  // ---- 2. KaTeX 数学：块级 $$...$$ ----
  {
    name: 'mathBlock',
    level: 'block',
    start(src) { return src.indexOf('$$'); },
    tokenizer(src) {
      const match = src.match(/^\$\$\$([^$]+?)\$\$\$\s*(?:\n|$)/);
      if (match) {
        return {
          type:  'mathBlock',
          raw:   match[0],
          math:  match[1].trim(),
        };
      }
    },
    renderer(token) {
      return `<div class="math-block">\\[${escapeHtml(token.math)}\\]</div>\n`;
    },
  },

  // ---- 3. Mermaid 图表 ----
  {
    name: 'mermaid',
    level: 'block',
    start(src) { return src.indexOf('```mermaid'); },
    tokenizer(src) {
      const match = src.match(/^```mermaid\s*\n([\s\S]*?)\n```/);
      if (match) {
        return {
          type: 'mermaid',
          raw:  match[0],
          code: match[1],
        };
      }
    },
    renderer(token) {
      return `<div class="mermaid">${escapeHtml(token.code)}</div>\n`;
    },
  },
];

marked.use({
  extensions: MARKDOWN_EXTENSIONS,
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
      return `<pre><code>${escapeHtml(code)}</code></pre>\n`;
    },

    // 任务列表 checkbox 美化
    listitem(text, task, checked) {
      if (!task) return `<li>${text}</li>\n`;
      const cls  = checked ? 'task-checked' : 'task-unchecked';
      const icon = checked
        ? '&#10003;'  // ✔
        : '&#9634;';  // ▢
      const checkedAttr = checked ? ' checked' : '';
      const disabledAttr = ' onclick="return false;" onkeydown="return false;"';
      // 替换原生 checkbox
      const cleaned = text
        .replace(/<input[^>]*type="checkbox"[^>]*>/, '')
        .trim();
      return `<li class="${cls}">` +
        `<span class="task-icon" aria-hidden="true">${icon}</span>` +
        `<span class="task-text">${cleaned}</span>` +
        `</li>\n`;
    },
  },
});

// ---------------------------------------------------------------------------
// HTML 模板
// ---------------------------------------------------------------------------

function buildHtmlTemplate({ bodyHtml, frontmatter, hasMermaid, hasMath }) {
  // 从 front-matter 提取元数据
  const fm = frontmatter || {};
  const title      = fm.title    || '';
  const author     = fm.author   || '';
  const date       = fm.date     || '';
  const cover      = fm.cover    || fm['cover-image'] || '';
  const abstract   = fm.abstract || fm.description || '';
  const docTitle   = title || 'Markdown Export';

  // 封面 HTML
  const coverHtml = cover
    ? `<div class="fm-cover"><img src="${escapeHtml(cover)}" alt="cover" /></div>`
    : '';

  // 元信息条（作者 + 日期）
  const metaHtml = (author || date)
    ? `<div class="fm-meta">${[author, date].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>`
    : '';

  // 摘要
  const abstractHtml = abstract
    ? `<div class="fm-abstract">${escapeHtml(abstract)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(docTitle)}</title>

  <!-- KaTeX CSS（数学公式必需） -->
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
        integrity="sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5"
        crossorigin="anonymous">

  <!-- KaTeX JS（渲染数学公式） -->
  <script defer
          src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"
          integrity="sha384-Ji9XZUoMuU8T1Z6t1t4M1sP2k5XklZQ5rO8Ymq8S3K4QRzP6S7fZOEnuMV6rzY"
          crossorigin="anonymous"></script>
  <script defer
          src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
          integrity="sha384-6GhotF8rJT4YqLuKF6aK0yYz3y3rJWPgPSA8Q4LQVukLOe3VMYqRABR6TdH8GZ"
          crossorigin="anonymous"></script>

  <!-- Mermaid JS（流程图 / 时序图 / 甘特图） -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>

  <style>
    /* ===================== 基本重置 ===================== */
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
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

    /* ===================== 容器 ===================== */
    #preview {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 60px 60px;
    }

    /* ===================== 封面（Front-matter） ===================== */
    .fm-cover {
      margin: -40px -60px 2em;
      overflow: hidden;
      max-height: 380px;
    }
    .fm-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .fm-meta {
      font-size: 0.85em;
      color: #6a737d;
      margin-bottom: 0.5em;
    }
    .fm-abstract {
      font-size: 1em;
      color: #586069;
      border-left: 3px solid #dfe2e5;
      padding-left: 1em;
      margin-bottom: 1.5em;
      font-style: italic;
    }

    /* ===================== 标题 ===================== */
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.25;
      color: #1a1a1a;
    }
    h1 {
      font-size: 2em;
      border-bottom: 1px solid #eaecef;
      padding-bottom: 0.3em;
    }
    h2 {
      font-size: 1.5em;
      border-bottom: 1px solid #eaecef;
      padding-bottom: 0.3em;
    }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1em; }

    /* ===================== 段落与列表 ===================== */
    p  { margin: 0.8em 0; }
    ul, ol { padding-left: 2em; margin: 0.8em 0; }
    li { margin: 0.25em 0; }
    li > p { margin: 0.3em 0; }

    /* ===================== 任务列表美化 ===================== */
    li.task-checked,
    li.task-unchecked {
      list-style: none;
      margin-left: -1.5em;
      display: flex;
      align-items: baseline;
      gap: 0.5em;
    }
    .task-icon {
      flex-shrink: 0;
      font-size: 1em;
      line-height: 1.4;
      width: 1.2em;
      text-align: center;
    }
    li.task-checked .task-icon { color: #22863a; }
    li.task-unchecked .task-icon { color: #6a737d; }
    li.task-checked .task-text {
      color: #6a737d;
      text-decoration: line-through;
    }
    li.task-unchecked .task-text { color: inherit; }

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

    /* ===================== 代码高亮（GitHub Light） ===================== */
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
    th { background: #f6f8fa; font-weight: 600; }
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

    /* ===================== KaTeX 数学公式样式 ===================== */
    .math-block {
      text-align: center;
      margin: 1.5em 0;
      padding: 0.8em 0;
      overflow-x: auto;
    }
    .math-inline { padding: 0 0.1em; }

    /* ===================== Mermaid 图表样式 ===================== */
    .mermaid {
      text-align: center;
      margin: 1.5em 0;
      background: #fafbfc;
      border: 1px solid #e1e4e8;
      border-radius: 6px;
      padding: 1.5em 1em;
    }
    .mermaid svg {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      height: auto;
    }

    /* ===================== 打印优化 ===================== */
    @media print {
      @page {
        margin: 1.5cm 2cm;
        size: A4;
      }
      body { font-size: 12px; }
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
      code, pre code {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        background: #f6f8fa !important;
      }
      .fm-cover { max-height: 200px; }
      .mermaid {
        background: #fafbfc !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    /* ===================== 深色模式 ===================== */
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
      .mermaid { background: #161b22; border-color: #30363d; }
      .fm-meta { color: #8b949e; }
      .fm-abstract { border-left-color: #30363d; color: #8b949e; }
    }
  </style>
</head>
<body>

${coverHtml}
${metaHtml}
${abstractHtml}

<div id="preview">
${bodyHtml}
</div>

<!-- KaTeX 自动渲染（处理 math-inline / math-block） -->
<script>
  document.addEventListener('DOMContentLoaded', function () {
    // KaTeX auto-render
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$',  right: '$$',  display: true  },
          { left: '$',   right: '$',   display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true  },
        ],
        throwOnError: false,
        errorColor: '#cc0000',
        trust: true,
        strict: false,
      });
    }

    // Mermaid 初始化
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad:       true,
        theme:             window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
        securityLevel:     'loose',
        fontFamily:        '"Segoe UI Variable","Segoe UI",system-ui,"Microsoft YaHei",sans-serif',
        flowchart:         { curve: 'basis', padding: 20 },
        sequence:          { actorMargin: 50, showSequenceNumbers: false },
        gantt:             { titleTopMargin: 25, barHeight: 30, barGap: 6, topPadding: 50, leftPadding: 120, gridLineStartPadding: 35, fontSize: 14, sectionFontSize: 16 },
      });
    }
  });
</script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 导出函数
// ---------------------------------------------------------------------------

/**
 * 将 Markdown 文件导出为 PDF/PNG/JPG
 *
 * @param {string} inputPath  - 输入 .md 文件路径
 * @param {string} fileType   - 'pdf' | 'png' | 'jpg'
 * @param {object} options
 * @param {number} options.timeout - 等待渲染完成的超时（ms）
 */
async function exportMarkdown(inputPath, fileType = 'pdf', options = {}) {
  const timeout = options.timeout || 45000;

  const parsed = path.parse(inputPath);
  if (!parsed.ext || parsed.ext.toLowerCase() !== '.md') {
    throw new Error(`输入文件必须是 .md 文件: ${inputPath}`);
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`文件不存在: ${inputPath}`);
  }

  const outputPath = path.join(parsed.dir, parsed.name + '.' + fileType);

  // 1) 读取并解析 YAML front-matter
  const rawMarkdown = fs.readFileSync(inputPath, 'utf-8');
  const { frontmatter, body: markdownBody } = parseFrontmatter(rawMarkdown);

  // 2) 渲染 Markdown → HTML
  let bodyHtml;
  try {
    bodyHtml = marked.parse(markdownBody, { breaks: true, gfm: true });
  } catch (err) {
    throw new Error(`Markdown 解析失败: ${err.message}`);
  }

  // 3) 组装完整 HTML（含封面、元数据、数学、Mermaid）
  const fullHtml = buildHtmlTemplate({
    bodyHtml,
    frontmatter,
    hasMath:    /\$[^$]/.test(markdownBody),
    hasMermaid: /```mermaid/i.test(markdownBody),
  });

  // 4) 启动 Chrome
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
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });

    // 临时文件
    tmpHtml = path.join(os.tmpdir(), `markdown-export-${Date.now()}-${process.pid}.html`);
    fs.writeFileSync(tmpHtml, fullHtml, 'utf-8');

    const fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout });

    // 等待 JS 渲染（数学公式 + Mermaid 图表）
    await new Promise(r => setTimeout(r, 1500));

    // 5) 导出
    if (fileType === 'pdf') {
      await page.pdf({
        path:    outputPath,
        format:  'A4',
        printBackground: true,
        margin:  { top: '1.5cm', bottom: '1.5cm', left: '2cm', right: '2cm' },
        displayHeaderFooter: false,
        scale:   1.0,
        timeout,
      });
    } else {
      await page.screenshot({
        path:    outputPath,
        fullPage: true,
        type:    fileType === 'jpg' ? 'jpeg' : 'png',
        omitBackground: false,
        timeout,
      });
    }

    await page.close();
    return outputPath;

  } finally {
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
    console.log(outputPath); // stdout: 输出路径（供调用方捕获）
    console.error(`[markdown-export] ✅ 完成 (${elapsed}s)`);
  } catch (err) {
    console.error(`[markdown-export] ❌ 失败: ${err.message}`);
    process.exit(1);
  }
}

main();
