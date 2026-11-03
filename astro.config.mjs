// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/**
 * Astro 7 的默认 Markdown 处理器是 @astrojs/markdown-satteri。
 * remark-math / rehype-katex 需要 unified 管道，因此显式切换处理器
 * （@astrojs/markdown-remark 已作为直接依赖安装）。
 * KaTeX 锁在 0.16.x：rehype-katex@7 的 peer 依赖是 katex ^0.16.0。
 */
export default defineConfig({
  site: 'https://hxtqy.com',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [react(), mdx(), sitemap()],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [[rehypeKatex, { throwOnError: false, strict: false, output: 'html' }]],
    }),
    shikiConfig: {
      theme: 'github-dark-dimmed',
      wrap: false,
    },
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
