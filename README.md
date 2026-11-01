# hxtqy-site
for personal website

## 技术栈

- [Astro](https://astro.build/) 7（静态站点）
- [React](https://react.dev/) 19（交互组件）
- [Tailwind CSS](https://tailwindcss.com/) 4（样式，经 `@tailwindcss/vite` 接入）
- [GSAP](https://gsap.com/)（动效）

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
```

## 构建

```bash
npm run build    # 输出到 dist/
npm run preview  # 本地预览构建产物
```

## Cloudflare Pages 部署

| 配置项 | 值 |
| --- | --- |
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | 22（见 `.nvmrc`） |

推送到 `main` 分支后，在 Cloudflare Pages 连接该仓库即可自动部署。

## 目录结构

```
src/
  components/Hero.tsx     首页主视觉（React + GSAP）
  layouts/BaseLayout.astro  HTML 骨架与 meta
  pages/index.astro        首页入口
  styles/global.css        Tailwind 入口与主题变量
public/                    favicon 等静态资源
```
