# 留底 · 实现计划（Qoder 任务卡版）

> 前置：`DESIGN.md` 已确认
> 周期：2026-11-14 → 11-30 18:00
> 口径：5 人工作量，单人用 Qoder 逐卡执行

---

## 0. 锁定的技术决定

| 项 | 决定 | 理由 |
|---|---|---|
| 前端 | Vite + React 19 + TypeScript + Tailwind v4 | 静态产物、无 SSR、部署简单 |
| 状态 | Zustand（壳）+ Dexie liveQuery（数据） | 不要 Redux，不要 React Query |
| 存储 | IndexedDB（Dexie），本地优先 | 照片不出设备是产品承诺 |
| 图像 | Canvas + WebCodecs；OpenCV.js 懒加载（仅配准用） | 首屏不背 8MB |
| 导出 | jsPDF + JSZip | 纯前端 |
| AI | 百炼 Qwen-VL-Max（观察）+ Qwen-Plus（措辞） | 经 FC 代理，前端零密钥 |
| 代理 | 阿里云函数计算 FC，HTTP 触发器 | 免费额度够，地域杭州 |
| 部署 | Qoder Sites（静态） | Free 版限制 |
| 测试 | Vitest（规则引擎必测）+ Playwright（主流程一条） | 只测会错的地方 |

**不引入**：Next.js、SSR、Prisma、任何后端框架、任何图表库、任何 UI 组件库（自己写，才不像模板）。

---

## 1. 仓库结构

```
liudi/
├─ apps/web/
│  ├─ src/
│  │  ├─ app/            # 路由、壳、导航、错误边界
│  │  ├─ features/
│  │  │  ├─ case/        # 案件与房间
│  │  │  ├─ capture/     # 第1步 取证
│  │  │  ├─ compare/     # 第2步 对比
│  │  │  ├─ valuation/   # 第3步 定损
│  │  │  ├─ negotiate/   # 第4步 谈判
│  │  │  └─ export/      # PDF / ZIP
│  │  ├─ domain/         # types、rules、selectors（纯逻辑，零依赖）
│  │  ├─ lib/            # hash、image、idb、api、format
│  │  ├─ content/        # legal.ts、prices.ts、channels.ts、scripts.ts
│  │  ├─ ui/             # 设计系统原子组件
│  │  └─ demo/           # 预置案例 + 预烘焙 AI 结果
│  └─ public/
├─ functions/vision/     # FC 代理（Node 20）
├─ docs/                 # 本目录
└─ README.md
```

**硬规则**：`domain/` 不 import React、不 import Dexie、不发网络请求。规则引擎必须能在 Node 里单测。

---

## 2. 设计系统（先定，后面所有页面照这个写）

**气质**：像一份会被法院接受的文档，不像一个记账 App。评委那天会看 40 个渐变紫的 AI 应用，我们要像一张验房单。

| Token | 值 | 用途 |
|---|---|---|
| `--paper` | `#FBFAF7` | 页面底 |
| `--ink` | `#14161A` | 正文 |
| `--ink-2` | `#5A6170` | 次要 |
| `--rule` | `#E2DFD8` | 1px 分隔线（替代阴影） |
| `--accent` | `#17325E` | 证据蓝，主操作 |
| `--cls-a` | `#6B7A8F` | 入住即有（已存在，与你无关） |
| `--cls-b` | `#2E7D5B` | 正常损耗（不该扣） |
| `--cls-c` | `#B26A00` | 人为损坏（要谈） |
| `--alert` | `#B3261E` | 仅用于"虚高报价"标记 |
| `--radius` | `2px` | 全局，文档感 |
| `--shadow` | 无 | 用线，不用影子 |

**字体**
- 标题 / 金额：`Noto Serif SC`，`letter-spacing: -0.01em`，金额用 `font-variant-numeric: tabular-nums`
- UI：`Noto Sans SC`
- 哈希 / 编号：`JetBrains Mono`，`letter-spacing: 0.02em`

**版式**
- 手机：左右 20px，卡片之间 1px 线，不堆圆角盒子
- 卡片内部用 `[ 01 ]` 这样的编号角标
- 表格用真实 `<table>`，带细线

**动效（只有 3 个）**
1. 对比页：一次自上而下的"扫描线"，扫过时差异框依次亮起（600ms）
2. 金额：`3200 → 380` 数字滚动（400ms，`prefers-reduced-motion` 时直接跳）
3. 哈希链：底稿生成时，哈希值逐字符打出

---

## 3. 数据契约

```ts
// domain/types.ts
type ID = string;

interface Case {
  id: ID;
  alias: string;              // "文一西路某小区 3 幢"
  city: 'hangzhou';
  addressMasked: string;      // 只到楼栋，不存门牌
  rentMonthly: number;        // 分
  deposit: number;            // 分
  leaseStart: string;         // ISO date
  leaseEnd: string;
  landlordType: 'personal' | 'agency' | 'sublet';
  createdAt: string;
}

interface Room { id: ID; caseId: ID; kind: RoomKind; label: string; }
type RoomKind = 'bedroom'|'living'|'kitchen'|'bath'|'balcony'|'entry';

interface Capture {
  id: ID; roomId: ID;
  phase: 'move_in' | 'move_out';
  takenAt: string;
  device: string;
}

interface Photo {
  id: ID;
  captureId: ID;
  slot: SlotId;               // 'wall-n' | 'floor' | 'ceiling' | 'door' | 'window' | 'appliance-ac' ...
  blob: Blob;                 // 原图，长边 1600
  thumb: Blob;                // 320 webp
  takenAt: string;
  sha256: string;
  prevHash: string;           // 链
  chainHash: string;          // SHA256(prevHash + sha256 + takenAt)
}

interface Defect {
  id: ID;                  // D-01
  photoId: ID;
  bbox: [number, number, number, number];  // 归一化
  phenomenon: Phenomenon;
  source: 'manual' | 'ai';
  confidence: number;
}

type Phenomenon =
  | 'stain' | 'scratch' | 'crack' | 'chip' | 'discolor'
  | 'rust' | 'hole' | 'missing' | 'deform' | 'dirt';

interface Finding {
  id: ID;                  // F-01
  roomId: ID;
  photoInId?: ID;
  photoOutId: ID;
  bbox: [number, number, number, number];
  phenomenon: Phenomenon;
  surface: Surface;        // 'wall'|'floor'|'ceiling'|'door'|'window'|'furniture'|'appliance'|'fixture'
  material?: string;
  severity: 'light' | 'moderate' | 'severe';
  areaRatio?: number;
  aiDescription?: string;
  aiConfidence?: number;
  needsRephoto: boolean;
}

interface Judgement {
  findingId: ID;
  cls: 'A' | 'B' | 'C';
  ruleId: string;
  reason: string;            // 一句话中文
  legalRefs: string[];       // ['民法典 710']
  confidence: number;
  overriddenByUser?: { cls: 'A'|'B'|'C'; note?: string; at: string };
}

interface DeductionItem {
  id: ID;
  rawText: string;
  label: string;
  amount: number;            // 分
  matchedPriceId?: string;
  quantity: number;
  estimate: { low: number; mid: number; high: number };
  depreciation: { years: number; lifespan: number; residualRatio: number };
  liableAmount: number;
  status: 'valid' | 'invalid' | 'disputed';
  reason: string;
  inflatedRatio?: number;
}

interface CaseValuation {
  deposit: number;
  claimedTotal: number;
  payable: number;
  notPayable: number;
  disputed: number;
  items: DeductionItem[];
}
```

**金额一律用「分」的整数**。任何地方出现 `0.1 + 0.2` 都是 bug。

---

## 4. 里程碑与验收

| 里程碑 | 日期 | 验收（能演示给人看） |
|---|---|---|
| **M0 骨架** | 11/15 | 手机打开站点，能从首页走到"谈判信"页，数据是假的但流程通 |
| **M1 取证** | 11/18 | 真机拍 6 张 → 底稿页出现照片墙 + 哈希链 + 导出 PDF |
| **M2 对比** | 11/21 | 同一面墙前后两张 → 自动框出差异 → 三色判定 |
| **M3 判定** | 11/23 | 10 组真实照片，人工核对判定合理率 ≥ 70% |
| **M4 定损** | 11/25 | 3200 → 380，每项有价格来源和折旧计算 |
| **M5 谈判** | 11/26 | 一封信可直接复制进微信；房东模拟能反驳 |
| **M6 打磨** | 11/27 | 4G 手机首屏 3s，演示模式零网络跑通 |
| **M7 物料** | 11/28 | 站点发布、论坛帖、90 秒录屏 |
| **M8 彩排** | 11/29 | 完整彩排 3 次，最快 1'20"，最慢 2'10" |

**卡点规则**：任何里程碑滑期超过 1 天，立即砍该里程碑的"锦上添花"项，不砍下一个里程碑。M3 崩了就降级为"人工判定 + AI 描述"，四步仍然闭环。

---

## 5. 任务卡

> 每张卡可以直接贴进 Qoder。`@` 是给 Qoder 的上下文引用。

### M0 · 骨架（11/15）

**T01 初始化**
- 产出：`apps/web`（Vite + React 19 + TS strict + Tailwind v4）、`functions/vision` 空壳、ESLint（flat config）、路径别名 `@/`
- 验收：`npm run build` 产出 `< 200KB gzip` 空壳（全局硬上限是 `PRD.md` NFR-2 的 250KB）；手机 Safari 通过 `https://<局域网IP>:5173` 打开正常
- 提示词要点：
  - 用 `npm create vite@latest -- --template react-ts`，**删掉 App.css / logo / 计数器**
  - Tailwind v4 用 `@tailwindcss/vite` 插件 + CSS 里 `@import "tailwindcss"`，**不要生成 tailwind.config.js**（v4 是 CSS-first，`@theme` 定义 token）
  - 别名要在 `vite.config.ts` 的 `resolve.alias` 和 `tsconfig` 的 `paths` **两处都配**
  - 装 `@vitejs/plugin-basic-ssl`：iOS 的 `getUserMedia` 只在安全上下文可用，`http://192.168.x.x` 会直接被拒，不解决的话 T06 的相机会卡死
  - `functions/vision` 只放 `package.json` + `index.js` + `README`，先不部署
  - 不要模板页、不要 demo 组件、不要装 UI 库

**T02 设计系统**
- 产出：`ui/` 里的 **10 个**原子组件：`Button / Field / Card / Rule / Badge / Stat / Table / Sheet / Skeleton / Toast`；`tokens.css`（含 `--font-serif / --font-sans / --font-mono` 系统字体栈）
- 验收：所有组件只有 2px 圆角、无 box-shadow、用 1px 线分层；**不加载任何 woff/ttf**
- 提示词要点：按 `SCREENS.md §0` 的 token 表实现；给出每个组件的 4 种状态（default/focus/disabled/loading）；不要引入任何组件库；`Toast` 是 `SCREENS.md` 全局组件表里的，容易漏

**T03 数据层**
- 产出：`lib/idb.ts`（Dexie schema v1）、`domain/repo.ts`（CRUD + 级联删除 + exportAll/importAll）
- 验收：单测能创建 case → room → capture → photo → 删除 case 后子记录为 0
- 提示词要点：组件不直接碰 db；照片存 Blob；缩略图独立表；导出为单个 JSON（照片转 base64 会太大，改为导出 ZIP）

**T04 应用壳 + 案例入口**
- 产出：路由 `/`（首页）/ `/case/:id/{capture,compare,value,negotiate}`；首页 = 新建案件 + 演示案例入口
- 验收：`?demo=1` 直接进入预置案例的"对比"页
- 提示词要点：首页第一屏必须出现那句主张「不帮你租房，只帮你要回押金」和一个主按钮；不要轮播、不要插图

---

### M1 · 取证（11/16–11/18）

**T05 房间模板**
- 产出：`content/roomTemplates.ts`，6 种房间 × 必拍点位（含中文提示语）
- 验收：一居室完整走一遍是 18 个点位，不是 60 个（**克制**）
- 提示词要点：点位要具体，"墙面-北"而不是"墙面"；每个点位给一句"为什么拍这个"

**T06 拍摄页**
- 产出：`features/capture/Camera.tsx`
- 验收：真机后置摄像头全屏预览，快门后 300ms 内出缩略图
- 提示词要点：
  - `getUserMedia({video:{facingMode:'environment', width:{ideal:1920}}})`
  - 失败或非 HTTPS → 降级 `<input type="file" accept="image/*" capture="environment">`
  - 拍后 canvas 压到长边 1600 / JPEG 0.82；再生成 320 webp
  - 不申请地理位置权限

**T07 证据链**
- 产出：`lib/hash.ts`
- 验收：单测 —— 篡改任意一张照片后 `verifyChain()` 返回第一处断链位置
- 提示词要点：`chainHash = SHA256(prevChainHash + sha256 + takenAtISO)`；首张 `prevChainHash = "GENESIS"`；用 WebCrypto，不要引第三方

**T08 瑕疵标注**
- 产出：`features/capture/Annotate.tsx`
- 验收：单指画框、双指缩放、可删可改；编号 `D-01` 自动递增
- 提示词要点：只做矩形，不做自由套索；最小框 16px；坐标归一化存

**T09 底稿页 + 导出**
- 产出：`features/capture/Deed.tsx`、`features/export/deedPdf.ts`
- 验收：导出的 PDF 有封面（地址/租期/押金/生成时间）、照片墙（每张带编号+时间+哈希前 12 位）、瑕疵清单、哈希链页
- 提示词要点：A4、衬线标题、页脚带页码；不要插 logo 大图；文件 < 8MB
- **中文必须用 jsPDF 的 `addFileToVFS` + `addFont` 嵌入子集字体**（≤ 2MB，导出时才 `import()`，绝不能进首屏）。没有这一步，中文会渲染成方块

**T10 分享给房东确认**
- 产出：生成一张长图（不是链接）+ 一句现成话术
- 验收：微信里能直接发，房东回"收到"即视为确认
- 提示词要点：长图宽 1080，分段渲染避免 canvas 高度上限

---

### M2 · 对比（11/19–11/21）

**T11 参考帧叠加**
- 产出：`features/compare/Align.tsx`
- 验收：入住照以 35% 透明度叠在取景框上，用户能凭肉眼对齐
- 提示词要点：提供"显示/隐藏参考帧"开关；参考帧可拖动+双指缩放+旋转；不追求自动

**T12 配准**
- 产出：`lib/register.ts`
- 验收：样例墙上前后照，ORB 内点 ≥ 20 时自动对齐误差 < 3% 边长
- 提示词要点：
  - 双图降采样到 512 灰度 → ORB → RANSAC 单应
  - opencv.js **动态 import**，只在进入对比页时加载，加载中显示进度
  - 内点 < 20 或单应矩阵奇异 → 返回 `{ok:false}`，UI 转手动模式
  - 不做自动裁剪、不做透视矫正后重绘

**T13 差异检测**
- 产出：`lib/diff.ts`（**纯函数**）
- 验收：单测 5 组固定图 → 期望 bbox IoU > 0.6
- 提示词要点：
  - LAB 空间，8×8 窗口 SSIM，阈值 0.72
  - 形态学闭运算；连通域面积 > 全图 0.3% 才留
  - 输出归一化 bbox + 强度；最多返回 8 个区域（按强度排序）
  - 输入 `ImageData`，输出 `Region[]`，**不碰 DOM**

**T14 对比视图**
- 产出：`features/compare/Compare.tsx`
- 验收：滑块对比 + 差异框 + 扫描线动效，60fps 不掉帧
- 提示词要点：三栏（入住 / 退租 / 并排）；差异框 hover 显示 AI 描述；`prefers-reduced-motion` 关闭动效

---

### M3 · 判定（11/22–11/23）

**T15 代理（FC）**
- 产出：`functions/vision/index.js`
- 验收：`POST /api/vision` 返回结构化 JSON；密钥只在环境变量；未授权请求直接 401
- 提示词要点：白名单 origin（站点域名 + localhost）；限流 20 次/分钟/IP；单次最多 2 张图；超时 25s；**返回体永不含原始模型输出**

**T16 VLM 调用与 schema 校验**
- 产出：`lib/api/vision.ts`
- 验收：模型胡说时（返回非 JSON / 字段缺失）该条被丢弃，UI 显示"AI 未能识别"，不阻塞流程
- 提示词要点：提示词见 §7；用 zod 校验；失败重试 1 次；**绝不编造结果**

**T17 规则引擎**
- 产出：`domain/rules.ts` + `domain/rules.test.ts`
- 验收：`CONTENT.md §3` 每条规则至少 1 个单测；100% 纯函数
- 提示词要点：见 §6

**T18 判定页**
- 产出：`features/compare/JudgementList.tsx`
- 验收：每条 finding 显示 类别徽章 + 理由 + 法条（可点开原文）+ 置信度；低置信度显示"需要你确认"
- 提示词要点：允许改判，改判后显示"已由你改为 X"，并写回 `overriddenByUser`；不要在改判后隐藏原判定

**T19 真实照片校准**
- 产出：`docs/calibration.md`（10 组照片的判定记录 + 人工评分）
- 验收：合理率 ≥ 70%；不合理的原因归类，反推提示词/规则修改
- 提示词要点：这是唯一需要"人看图"的卡，Qoder 只负责生成对照表

---

### M4 · 定损（11/24–11/25）

**T20 扣款拆解**
- 产出：`features/valuation/Parse.tsx` + `/api/extract`
- 验收：粘一段真实微信扣款消息 → 拆成 ≥ 4 条结构化项目，金额对得上
- 提示词要点：先本地正则（¥/元/块 + 数字），失败才走 LLM；LLM 返回后必须**校验金额总和**，对不上就回退正则结果

**T21 价格库**
- 产出：`content/prices.ts`（杭州 30 项）
- 验收：每项有 `source` 和 `updatedAt`；无来源的项标 `unverified: true` 且 UI 显示"待核价"
- 提示词要点：字段见 §3；不要编造来源链接；没有就留空并标记

**T22 定损引擎**
- 产出：`domain/valuation.ts`
- 验收：演示案例 3200 → 380，每项可展开看计算过程
- 提示词要点：
  - 关键词 + 同义词模糊匹配价格项（不要 LLM）
  - `residual = 1 - min(1, years / lifespan)`
  - `liable = round(mid * residual)`
  - 虚高：`claimed > high * 2` → `inflatedRatio = claimed / high`
  - 金额全整数分

**T23 定损页**
- 产出：`features/valuation/Valuation.tsx`
- 验收：三个大数字（应付/不应付/争议）+ 明细表 + 每项"为什么"
- 提示词要点：明细表用真实 table；争议项默认折叠，点开看推理链

---

### M5 · 谈判（11/26）

**T24 信件生成**
- 产出：`features/negotiate/compose.ts` + `content/letterTemplates.ts`
- 验收：3 语气 × 3 渠道 = 9 个模板全可用；LLM 失败时模板版仍然完整
- 提示词要点：见 §8

**T25 房东模拟**
- 产出：`features/negotiate/Roleplay.tsx`
- 验收：AI 房东会针对信里的具体金额反驳，不是泛泛而谈；3 轮后给"你的破绽"
- 提示词要点：system 里注入本案扣款明细和法条；三种人格（压价型/耍赖型/讲理型）；**不允许 AI 房东编造法条**

**T26 升级路径**
- 产出：`content/channels.ts` + 流程图页
- 验收：杭州口径 —— 12345、区住建局、街道调解、小额诉讼（标的额与管辖）
- 提示词要点：每个渠道给"什么时候用/带什么材料/大概多久"；附一句"本产品不构成法律意见"

**T27 证据包导出**
- 产出：`features/export/bundle.ts`
- 验收：ZIP = `manifest.json` + `photos/` + `report.pdf` + `letters/`；解压后能自证完整
- 提示词要点：manifest 含版本号、生成时间、每个文件的 sha256、链式校验结果；文件名用 `D-01_墙-北_20261115.jpg` 这种可读格式

---

### M6 · 打磨（11/27）

**T28 演示模式**
- 产出：`demo/` 预置案例
- 验收：断网、清缓存、`?demo=1` → 30 秒内走到谈判信，零报错
- 提示词要点：照片打包进 `public/demo/`（每张 ≤ 120KB），AI 结果预烘焙成 JSON；启动时跳过所有网络请求

**T29 性能与兜底**
- 验收：4G 首屏 < 3s；低端安卓拍摄不卡；所有异步都有骨架屏；所有失败都有中文人话提示
- 提示词要点：图片全部 `loading="lazy"`；路由级 code split；OpenCV 只在对比页加载；错误边界捕获后给"重试 / 回首页"

**T30 隐私与免责**
- 验收：设置页有"清除全部数据"；首次进入有 3 行隐私说明；每封生成的信号称"不构成法律意见"
- 提示词要点：不要写成长篇隐私政策，3 行说清楚：照片存在你手机里、AI 分析时才上传、随时可删

---

### M7 · 物料（11/28）

**T31 站点发布**
- 验收：Qoder Sites 公网可访问，手机 4G 打开正常，无 mixed content
- 提示词要点：SPA 路由 fallback 配置；`robots.txt` 允许收录；OG 卡片图

**T32 提交帖 + 录屏**
- 产出：`docs/SUBMISSION.md`（按官方模板：自我介绍 / 作品是什么 / 为什么做 / 怎么用 / 用 Qoder 的过程 / 技术说明）
- 验收：90 秒录屏一镜到底不剪辑（剪辑感 = 心虚）；帖子里的链接全部可点
- 提示词要点：标题带「2026 Qoder 高校创造力大赛」；技术说明里写清"观察与判定分离"和"数字不经 LLM"

---

## 6. 规则引擎规格

```ts
judge(input: {
  finding: Finding;
  hasMoveInEvidence: boolean;
  matchedDefect?: Defect;      // 入住底稿里 IoU > 0.3 的瑕疵
  tenancyMonths: number;
  contractClause?: string;     // 合同里关于押金扣减的原文
}, ctx: CaseContext): Judgement
```

**优先级顺序（第一条命中即返回）：**

| 序 | ruleId | 条件 | 类别 | 法条 |
|---|---|---|---|---|
| 1 | `A-01` | `matchedDefect` 存在且 IoU > 0.35 | A | 合同 + 底稿 D-xx |
| 2 | `A-02` | 现象为 `hole`（钉眼）且数量 ≤ 3 且直径 < 8mm | B→A 边界，归 B | 710 |
| 3 | `C-01` | 现象 ∈ {`hole`, `missing`} 且非钉眼 | C | 711 |
| 4 | `C-02` | 现象 ∈ {`crack`} 且 `severity = severe` 且有结构位移 | C | 711 |
| 5 | `C-03` | 现象 `stain` 且集中在 < 1㎡ 且边缘锐利（泼洒特征） | C | 711 |
| 6 | `B-01` | 现象 ∈ {`dirt`, `discolor`} 且表面 ∈ {wall, floor} | B | 710 |
| 7 | `B-02` | 现象 `scratch` 且 `severity = light` 且表面 ∈ {floor, furniture} | B | 710 |
| 8 | `B-03` | 现象 `crack` 且 `severity ∈ {light, moderate}` 且 `tenancyMonths ≥ 24` | B | 710 + 733 |
| 9 | `B-04` | 现象 `rust` 且表面 ∈ {fixture, appliance}（正常氧化） | B | 710 |
| 10 | `C-99` | 兜底 | C | 711 |

> 规则表最终以 `CONTENT.md §3` 为准，这里只给形状。**兜底必须保守**：宁可判 C（可谈）也不要把真实损坏判成 B（白送）。

**输出约束**
- `reason` 必须是一句人话，能念给房东听。例："这处污渍在入住底稿 D-03 中已存在，属于交付时的既有状态。"
- `confidence` = 规则基础分 × 证据系数（有入住照 ×1.0，无 ×0.6）× AI 置信度
- `confidence < 0.55` → UI 强制显示"需要你确认"

---

## 7. VLM 提示词（观察层）

```
你是房屋状态记录的观察员，不是裁判。

看这两张同机位照片：第一张是入住时，第二张是退租时。
只描述你**能看见**的差异。禁止判断"谁的责任""该不该赔""值多少钱"。

对每一处差异输出：
- bbox: [x1,y1,x2,y2] 归一化到 0-1
- surface: wall|floor|ceiling|door|window|furniture|appliance|fixture
- material: 你的猜测（不确定写 null）
- phenomenon: stain|scratch|crack|chip|discolor|rust|hole|missing|deform|dirt
- description: 一句中文，含尺寸估计、形状、边缘特征、颜色
- severity: light|moderate|severe
- cause_hypothesis: 可能的成因（"疑似…"），不确定写 null
- confidence: 0-1
- needs_rephoto: 如果这张照片看不清该处，为 true

规则：
1. 光照变化、角度差异、阴影、反光，不算差异。
2. 看不清就说看不清，不要猜。
3. 最多 6 条，按明显程度排序。
4. 只输出 JSON：{"observations":[...],"coverage_ok":true|false,"notes":""}
```

**为什么这么写**：把"不判断责任"写进第一条，是因为模型的默认行为就是下结论。只描述，判定权留给规则引擎。

---

## 8. 信件生成与数字校验

```ts
compose(caseData, tone, channel) => {
  subject: string
  body: string
  citations: { evidenceId: string; caption: string }[]
}
```

**流程**
1. 模板渲染（**必须先成功**）→ `bodyTemplate`
2. LLM 只重写"说明段"（≤ 180 字），system 里给死：不得新增事实、不得改数字、不得引用未提供的法条
3. 拼接 → `bodyLLM`
4. `validateNumbers(bodyLLM, allowedSet)`
   - 提取正文中所有金额与数量
   - 任一不在 `allowedSet` → 丢弃 LLM 版，回退 `bodyTemplate`
5. `validateCitations(bodyLLM, citations)`：提到的 `D-xx` 必须存在

**allowedSet 来源**：押金、租金、每项扣款、每项应付、总额、天数、期限。全部由 `domain/valuation.ts` 产出。

---

## 9. 导出规格

**底稿 PDF（A4）**
1. 封面：地址（脱敏）、租期、押金、生成时间、案件 ID
2. 照片墙：每张 `[P-03] 墙面-北 2026-11-15 14:22 SHA256:9f3a…c21e`
3. 瑕疵清单：编号 / 位置 / 现象 / 圈选缩略图
4. 哈希链页：`hash → chainHash` 表格 + 一句话说明"任何一张照片被替换，此链即断"
5. 末页：不构成法律意见 + 生成工具版本

**证据包 ZIP**
```
manifest.json          # 版本、时间、文件清单+哈希、链校验结果
photos/D-01_墙-北_20261115.jpg
report.pdf
letters/letter-neutral-wechat.txt
valuation.csv
```

---

## 10. 每日节奏（单人）

| 时段 | 做什么 |
|---|---|
| 09:00–09:20 | 写今天 3 个验收目标（必须是"能在手机上看到"的） |
| 09:20–12:30 | Qoder 跑 2–3 张卡，每张卡先让它写"验收测试"再写实现 |
| 14:00–18:00 | 继续跑卡 + **真机验证**（不在手机上点过的不算完成） |
| 19:30–21:30 | 修当天暴露的问题 + 更新 `docs/calibration.md` |
| 21:30 | 记录：今天哪张卡比预估慢，为什么 |

**纪律**：每天结束时站点必须是"可演示"状态。不允许出现"今天重构，明天才能跑"。

---

## 11. 提交清单（11/30 上午）

- [ ] Qoder Sites 公网链接，4G 手机可开
- [ ] `?demo=1` 演示模式零网络跑通四步
- [ ] 天池论坛帖（标题含赛事名 + 赛道），按官方 6 段结构
- [ ] 90 秒录屏（一镜到底）
- [ ] 仓库 README（如何跑、如何配 FC、如何换城市）
- [ ] 法条库每条可点开原文链接
- [ ] 价格库每项标来源与日期
- [ ] 全站免责声明
- [ ] 清除数据可用
- [ ] 手机横屏 / 深色模式不崩（深色可选，崩了必须修）
