# 技术栈（锁定）

Vite · React 19 · TypeScript strict · Tailwind v4 · Zustand（仅 UI 壳）· Dexie（IndexedDB）· Canvas 2D · OpenCV.js（**动态 import，仅配准**）· jsPDF + JSZip · Vitest · Playwright · react-router（**Hash 路由**）

## 禁止引入
Next.js、任何 UI 组件库（MUI / AntD / shadcn）、图表库、CSS-in-JS、axios、lodash、moment/dayjs、任何分析或监控 SDK。

## 目录
```
apps/web/src/
  app/ features/ domain/ lib/ content/ ui/ demo/
functions/vision/    # FC 代理
```
`domain/` 不得 import React、Dexie、fetch 或浏览器 API —— 必须能在 Node 跑单测。

## 命令
`npm run dev` / `build` / `preview` / `test` / `test:cov` / `e2e`
提交前三绿：`build`、`test`、`e2e`。

## 关键阈值
图片长边 1600 / JPEG 0.82；缩略图 320 / WebP 0.75；SSIM 8×8 / 0.72；差异上限 8 个；ORB 内点下限 20；VLM 超时 25s 重试 1 次；初始 JS < 250KB gzip。
