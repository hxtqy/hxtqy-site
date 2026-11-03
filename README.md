# hxtqy-site

个人站点：一台会看向你的光学仪器（粒子虹膜首页）+ 一间长期堆放笔记的房间（CS / AI / Math / Poem）。

- 线上：<https://hxtqy.com>
- 调研与设计依据：`../hxtqy-design-research.md`、`../design-research/browser-validation.md`

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Astro 7（`output: 'static'`） | 全站静态生成，零服务端依赖 |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite`）+ 原生 CSS 令牌 | 设计令牌在 `src/styles/global.css` |
| 交互 | Astro 原生 `<script>` + GSAP / ScrollTrigger | 首页之外不加载动画库 |
| 粒子 | three.js（`Points` + 自定义 `ShaderMaterial`） | 按能力探测后才动态 `import()` |
| 内容 | Content Collections（`glob()` loader + Zod） | Markdown / MDX |
| 数学 | remark-math + rehype-katex（`katex@0.16.x`） | 通过 `markdown.processor: unified()` 接入 |
| 高亮 | Shiki（Astro 内置，`github-dark-dimmed`） | 复制按钮由 `src/scripts/ui.ts` 渐进增强 |
| 字体 | `@fontsource` 自托管（Literata / Public Sans / IBM Plex Mono） | 中文回落系统衬线，不下载 CJK 字库 |

## 本地开发

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 输出到 dist/
npm run preview    # 预览构建产物
```

Node 版本见 `.nvmrc`（22）。

## 目录结构

```text
src/
  content.config.ts        # 集合定义（posts）
  content/posts/<分类>/    # 文章：cs / ai / math / poem
  data/
    categories.ts          # 分类元数据（单一数据源）
    profile.ts             # About 页内容（含占位标记）
    projects.ts            # 项目列表
  layouts/BaseLayout.astro # html / meta / 主题 / 导航 / 页脚
  components/
    site/Nav.astro  site/Footer.astro
    home/Hero.astro        # 静态虹膜 + canvas + 入口编排
    writing/PostRow.astro  writing/CategoryBar.astro
    prose/Figure.astro  Callout.astro  Theorem.astro  Paper.astro
  scripts/
    ui.ts                  # 导航、主题、复制按钮、目录高亮、进度条
    iris/renderer.ts       # three.js 渲染器（动态加载）
  pages/
    index.astro  about.astro  projects.astro  404.astro  rss.xml.ts
    writing/index.astro  writing/[category].astro  writing/[category]/[id].astro
    tags/[tag].astro
  styles/global.css        # 设计令牌 + 组件样式
```

## 写一篇新文章

1. 在 `src/content/posts/<分类>/` 下新建 `.md` 或 `.mdx`：

```yaml
---
title: 标题
summary: 一句话摘要（≤160 字）
date: 2026-11-02
category: cs          # cs | ai | math | poem
tags: [标签]
lang: zh-Hans         # zh-Hans | en
---
```

2. 需要组件（图注、提示块、定理、论文卡）时用 `.mdx` 并显式 import：

```mdx
import Figure from '../../../components/prose/Figure.astro';
import Theorem from '../../../components/prose/Theorem.astro';

<Figure src="/images/x.png" alt="说明" caption="图注" index={1} wide />

<Theorem kind="theorem" number="2.1">…</Theorem>
```

3. 数学公式：行内 `$a^2+b^2$`，块级 `$$ … \tag{1} $$`。
4. 诗歌用 `.md`，每行之间写 `<br />`，节与节之间空一行（正文容器带 `data-kind="poem"`）。
5. 草稿：frontmatter 加 `draft: true`，构建时会被排除。

## 维护点

| 想改什么 | 改哪里 |
| --- | --- |
| 首页标题 / 标语 / 简介 | `src/data/profile.ts` |
| 分类名称、色相、简介 | `src/data/categories.ts` |
| 项目列表 | `src/data/projects.ts` |
| 颜色、字号、间距、栅格 | `src/styles/global.css` 顶部 `@theme` 与 `:root` |
| 粒子数量、配色、缓动 | `src/scripts/iris/renderer.ts`（`TIER_CONFIG` / uniforms） |

About 页里标有「占位」的条目是明确的占位内容，替换 `profile.ts` 即可。

## 部署

Cloudflare Pages：构建命令 `npm run build`，输出目录 `dist`，Node 22。
`public/_headers` 已为 `/_astro/*` 配置 `immutable` 长缓存；`public/robots.txt` 指向 `sitemap-index.xml`。
