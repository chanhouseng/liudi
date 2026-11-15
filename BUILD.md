# BUILD.md · 构建记录

> 按 `AGENTS.md §13` 约定：每完成一批任务卡追加一条。给提交帖「用 Qoder 的过程」攒素材。

---

## 2026-11-15 · T01 初始化 + T02 设计系统

**做了什么**

- `apps/web`：Vite 7 + React 19 + TypeScript strict + Tailwind v4，npm workspaces（`apps/web` + `functions/vision`），根命令 `dev / build / preview / test / test:cov / lint`
- `functions/vision`：空壳（仅 package.json，Node >= 20），T15 再填实现
- ESLint 9 flat config + typescript-eslint + react-hooks；路径别名 `@/` → `src/*`
- `ui/tokens.css`：SCREENS.md §0 全部 token 落地为 CSS 变量，经 Tailwind v4 `@theme inline` 映射为工具类（`bg-paper` / `text-ink-2` / `border-rule` / `rounded-doc` / `font-serif`）
- 九个原子组件：Button / Field / Card / Rule / Badge / Stat / Table / Sheet / Skeleton

**遇到的问题与解法**

1. **DESIGN.md §2 不是 token 表**——T02 卡写"按 DESIGN.md §2 的 token 表实现"，但 DESIGN.md §2 实际是"为什么是这件事"。按文档优先级（PRD > SCREENS > PLAN > DESIGN）改以 `SCREENS.md §0` 实现，两处 token 值一致，无实际冲突。
2. **Tailwind v4 默认调色板会泄漏**（`red-500` 等会绕过设计系统）。解法：`@theme inline` 里用 `--color-*: initial` 清空默认色板，只重新注册规范内的 12 个颜色 + 黑白；`--radius-*: initial` 同理，只留 `rounded-doc`（2px）。构建产物 CSS 验证：唯一非 2px 圆角是两个刻意的正圆（Button 加载环、Sheet 拖拽把手）。
3. **"只许三个动效"与组件加载态冲突**：去掉了 Sheet 的入场过渡和拖拽回弹动画（纯位移跳变），Button 加载环保留 `animate-spin`（功能性指示，非装饰动效）。
4. **npm allow-scripts 拦截了 esbuild postinstall**：实测 Vite 7.3.8 构建不受影响（运行时从 `@esbuild/win32-x64` 解析二进制），未放行。
5. **焦点可见性统一收口**：在 tokens.css 全局 `:focus-visible { outline: 2px solid var(--accent) }`，避免每个组件各写一套（NFR-4）。

**遗留**

- 字体文件（Noto Serif SC / Noto Sans SC / JetBrains Mono）未打包，当前用系统字体栈兜底；打包归属后续打磨卡（M6），tokens.css 已留位
- `e2e` 命令未接入（Playwright 归 M1+ 的卡），根 scripts 暂无此命令
- npm 报告 13 个依赖漏洞（11 moderate / 2 critical），全部在 dev 工具链，未运行 `audit fix --force`（避免破坏性升级）
- eslint@9.39.5 提示"不再支持"，属 9.x 尾版本提示，暂不处理

**验收数据**

- `npm run build`：JS 69.52KB + CSS 3.46KB + HTML 0.42KB = **73.4KB gzip**（T01 上限 200KB ✅）
- 内置浏览器实测（preview + DOM 快照 + 计算样式）：底色 `#FBFAF7`、正文 15px/1.7、标题衬线 600、容器 480px 居中、左右 20px，控制台零报错、网络面板无第三方请求
