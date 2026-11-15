# AGENTS.md

本文件是这个仓库对 AI 编码代理（Qoder / Claude Code / Codex 等）的**操作手册**。
开始任何任务前，先读这一页。它与 `.qoder/rules/*.md` 内容一致，后者是按主题拆分的版本。

---

## 1. 项目是什么

**留底** —— 中国租客的退租押金维权工具。只做四步：**取证 → 对比 → 定损 → 谈判**。

不做找房、合同审查、补贴匹配、房东端。**范围外的功能一律不要加**，哪怕它看起来很小。

比赛：2026 Qoder 高校创造力大赛 · LifeHack。截止 2026-11-30 18:00。

---

## 2. 先读哪份文档

| 你要做的事 | 读这份 |
|---|---|
| 搞清楚要做什么、验收标准 | `PRD.md`（**契约**） |
| 搞清楚每个页面长什么样 | `SCREENS.md` |
| 领任务、看提示词与依赖 | `PLAN.md`（32 张任务卡） |
| 用法条、规则、价格、话术 | `CONTENT.md`（**事实来源**） |
| 演示案例、脚本、拍摄清单 | `DEMO.md` |
| 为什么这么设计 | `DESIGN.md`（背景，冲突时以 PRD 为准） |

**冲突优先级**：`PRD > SCREENS > PLAN > DESIGN`。`CONTENT.md` 里的事实（法条原文、价格区间）**永远优先于代码里写死的值**。

---

## 3. 技术栈（锁定，不要替换）

| 层 | 选择 |
|---|---|
| 构建 | Vite |
| 框架 | React 19 + TypeScript（strict） |
| 样式 | Tailwind v4 + CSS 变量 |
| 状态 | Zustand（仅 UI 壳）+ Dexie `liveQuery`（数据） |
| 存储 | IndexedDB via Dexie |
| 图像 | Canvas 2D；OpenCV.js **动态 import**（仅配准用） |
| 导出 | jsPDF + JSZip |
| 测试 | Vitest（domain 层）+ Playwright（1 条主流程） |
| 路由 | react-router（Hash 路由，兼容静态托管） |
| 代理 | 阿里云函数计算 FC（Node 20，独立目录 `functions/`） |

**禁止引入**：Next.js、任何 UI 组件库（MUI/AntD/shadcn）、任何图表库、任何 CSS-in-JS、axios、lodash、moment/dayjs（用 `Intl`）、任何分析/监控 SDK。

**理由**：包体、离线承诺、以及"长得不像模板"。

---

## 4. 目录结构

```
apps/web/src/
  app/          路由、壳、错误边界
  features/     case | capture | compare | judge | valuation | negotiate | export
  domain/       types.ts, rules.ts, valuation.ts, repo.ts   ← 纯逻辑
  lib/          hash.ts, image.ts, idb.ts, api/, format.ts
  content/      legal.ts, prices.ts, channels.ts, scripts.ts, roomTemplates.ts
  ui/           Button, Field, Card, Badge, Stat, Table, Sheet, Skeleton
  demo/         预置案例 + 预烘焙 JSON
functions/vision/   FC 代理
docs/               DESIGN / PRD / SCREENS / PLAN / CONTENT / DEMO / TESTPLAN
```

**硬规则**：`domain/` 不得 import React、Dexie、fetch、任何浏览器 API（除了 `structuredClone` 这类通用能力）。它必须能在 Node 里跑单测。

---

## 5. 命令

```bash
npm install
npm run dev          # 本地开发
npm run build        # 产物必须能静态托管
npm run preview      # 预览产物
npm run test         # vitest
npm run test:cov     # 覆盖率
npm run e2e          # playwright
```

提交前必须三条全绿：`build` / `test` / `e2e`。

---

## 6. 十条硬规则

1. **金额一律用「分」的整数**。任何浮点金额都是 bug。展示时才除以 100。
2. **数字不经 LLM**。所有金额、数量、天数由代码计算。LLM 只负责措辞，生成后必须做数字回填校验。
3. **观察与判定分离**。视觉模型只描述可见事实，不下责任结论；判定由 `domain/rules.ts` 完成。
4. **不编造事实**。法条原文、价格区间只从 `CONTENT.md` / `content/*.ts` 取。缺数据就显示"待补充"，不要猜。
5. **不承诺结果**。UI 里禁止出现"保证退款""一定能要回""必赢"。
6. **照片默认不出设备**。只有用户点击"AI 分析"时才上传当前这一张，且请求体不含其他照片、不含地址、不含姓名。
7. **每个异步都有三态**：加载（骨架屏）、成功、失败（中文人话 + 可重试）。没有空状态的页面不算做完。
8. **降级优先于报错**。摄像头不可用→文件上传；OpenCV 失败→手动对齐；VLM 失败→人工判定。任何单点失败都不能让流程断掉。
9. **不引第三方网络请求，不加载 webfont**。中文用系统字体栈（见 `SCREENS.md §0`），无 CDN，无统计，无错误上报。唯一例外：导出 PDF 时懒加载子集字体。
10. **改 `content/` 必须同步 `CONTENT.md`**。事实只有一份。

---

## 7. 代码规范

- TypeScript `strict: true`，不用 `any`；实在要用写 `// eslint-disable-next-line` 并说明原因
- 组件文件用 PascalCase，逻辑文件 camelCase
- 一个文件一个主要导出；超过 300 行就拆
- 样式只用 Tailwind class + CSS 变量，**不写行内 style 里的颜色值**
- 所有用户可见文案写中文，集中在组件内常量或 `content/`，不要散落
- 注释只写"为什么"，不写"是什么"
- 不写 `console.log` 提交；调试用 `console.debug` 并在 PR 前删掉

**设计系统必读**：`SCREENS.md §0`。所有页面必须遵守：2px 圆角、无阴影、1px 线分层、纸白底、衬线标题。

---

## 8. 完成定义（Definition of Done）

一张任务卡算完成，必须同时满足：

- [ ] 真机上点过（Chrome DevTools 移动模拟不算）
- [ ] 空 / 加载 / 失败 三态都有
- [ ] 断网时行为符合 `PRD.md §7` 降级矩阵
- [ ] `npm run build` 通过，初始 JS < 250KB gzip
- [ ] 相关单测通过；改了规则引擎则覆盖率 100% 规则
- [ ] 没有新增第三方网络请求（Network 面板确认）
- [ ] 金额显示为 `¥1,234` 格式，等宽数字
- [ ] 免责声明在涉及金额/判定的页面可见

**任何一条不满足，不要标记完成。**

---

## 9. 不要做的事

- ❌ 不要"顺手"重构已完成模块
- ❌ 不要新增 PRD 里没有的页面或字段
- ❌ 不要为了让测试通过而改测试预期（除非测试本身写错了，且要在回复里说明）
- ❌ 不要一次提交超过 2 张任务卡的改动
- ❌ 不要把照片 base64 塞进 localStorage
- ❌ 不要在 `domain/` 里写副作用

---

## 10. 不确定时怎么办

**停下来问，不要猜。** 尤其是：

- 需求有歧义（PRD 两处说法冲突）
- 缺数据（价格库里没有这个项目）
- 涉及法律表述（宁可少写一句，不要写错）
- 要引入新依赖
- 要改数据结构（会影响已存数据）

提问格式：
```
【阻塞】T13 差异检测
现象：单测 5 组图里有 2 组检测出 8 个以上区域，超出 PRD 要求的"最多 8 个"
我的判断：阈值 0.72 对低对比度墙面过敏感
需要你决定：调阈值到 0.78，还是保留 8 个上限截断？
```

---

## 11. 每次交付的回复格式

做完一张任务卡，回复里必须包含：

```
## 完成：T13 差异检测
**改了哪些文件**：lib/diff.ts, lib/diff.test.ts
**验收对照**：
- 纯函数、不碰 DOM ✅
- 5 组固定图 IoU > 0.6 ✅（实测 0.71 / 0.68 / 0.83 / 0.77 / 0.65）
- 最多 8 区域 ✅
**没做的**：低对比度墙面偶发漏检，已记录在 TODO，未阻塞
**需要人确认的**：无
```

没有"验收对照"的交付，视为未完成。

---

## 12. 关键阈值速查

| 项 | 值 |
|---|---|
| 图片主图长边 | 1600px，JPEG 0.82 |
| 缩略图长边 | 320px，WebP 0.75 |
| SSIM 窗口 / 阈值 | 8×8 / 0.72 |
| 差异区域上限 | 8 个 |
| 区域最小面积 | 全图 0.3% |
| 配准 ORB 内点下限 | 20 |
| VLM 超时 | 25s，重试 1 次 |
| 判定置信度告警线 | 0.55 |
| 低置信度文案 | 「这条需要你自己确认」 |
| 底稿 PDF 上限 | 8MB |
| 初始 JS 上限 | 250KB gzip |
| 首屏 LCP（4G） | < 3s |
