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

---

## 2026-11-15 · T03 数据层 + T04 应用壳与案例入口

**做了什么**

- `domain/types.ts`：PLAN.md §3 全量数据契约 + Letter；`DeductionItem` 补 `caseId`（FR-103 级联删除需要归属字段，已确认）
- `domain/repo.ts`（纯逻辑，Node 可测）：`collectCaseTree` 级联收集、`buildExportPayload` / `parseImportPayload`（导出剥离 blob/thumb 二进制，导入校验 version=1，返回 `missingPhotos`）
- `lib/idb.ts`：Dexie schema v1（10 表，judgements 按 findingId 唯一，deductions/letters 按 caseId 索引）；`deleteCaseCascade`（事务内按收集结果批量删）、`exportAll` / `importAll`、`getCaseProgress`（四步进度：照片/差异/扣款/信件各一布尔）、`listCaseSummaries`（首页最近 3 案）
- `content/vocab.ts`：现象/严重度中文标签（对应 CONTENT.md §3.2 附注）
- `features/case/`：`useCase`（useLiveQuery，demo id 短路到内存演示案）、`CasePageShell`（四态渲染 + `[ NN ]` 步骤角标 + 下一步按钮）、`Home`（S01：主张大字 / 主次按钮 / 案件列表≤3 / 空加载失败三态）、`NewCase`（S02 表单校验）
- 四步占位页：capture / compare（demo 分支显示预置差异）/ value / negotiate，空态文案全部取自 SCREENS.md 文案库
- `app/App.tsx`：HashRouter 路由 + `?demo=1` 重定向 `/case/demo/compare`

**遇到的问题与解法**

1. **「domain/ 不得 import Dexie」与「repo.ts 放 domain/ 做 CRUD」文档冲突**：拆两层——纯逻辑（级联收集、导入导出变换）留 `domain/repo.ts` 并在 Node 单测；Dexie 执行层放 `lib/idb.ts`。
2. **导出照片二进制**：JSON 里放 base64 会爆体积，改为元数据行（7 字段），blob 剥离；导入后照片为 `blob:null` 占位并标 `missingPhotos`（FR-702 完整方案留 T27 ZIP）。
3. **TS2322**：`ExportInput.photos` 从 `Photo[]` 收窄为元数据结构类型 `PhotoExportRow[]`。
4. **Node 环境无 IndexedDB**：引入 `fake-indexeddb`（dev-only 垫片，已确认），仅 `lib/idb.test.ts` import，不进产物。

**遗留**

- 首页「隐私说明」暂无链接目标，T30 设置页落地后接上
- 演示案例目前是内存 2 条 finding，完整预烘焙（照片+AI 结果）归 T28（M6）

**验收数据**

- `npm run build`：JS 121.77KB gzip（< NFR-2 的 250KB ✅）；`npm run lint` 0 错误
- 单测 11/11 通过（repo 7 + idb 4），含：级联删除后 10 表计数为 0、他案不受影响、导出 JSON 不含 blob、导入恢复 blob:null
- 浏览器实测：新建案件表单校验（空表单禁用 + 「还差 5 项」，填齐启用）→ 提交 → 跳取证页 → 四步页 `[ 01 ]`–`[ 04 ]` 全通 → 首页列出案件（别名 / 押金 ¥4,000 / 四段进度点）→ `?demo=1` 直达演示对比页（F-01 污渍·中度 / F-02 划痕·轻度）；控制台全程零报错，无第三方网络请求

---

## 2026-11-15 · T05 房间模板 + S03/S04 取证列表 + T06 拍摄页与图像管线

**做了什么**

- `content/roomTemplates.ts`：6 房间 18 点位（玄关 3 / 客厅 4 / 卧室 3 / 厨房 3 / 卫生间 3 / 阳台 2），why 文案逐字取自 SCREENS.md S04；电表→玄关、燃气表→厨房、水表→阳台（按 DESIGN.md 动线）
- `lib/image.ts`：`processImage(blob | video)` —— 主图长边 1600 / JPEG 0.82（不放大）、缩略图 320 / WebP 0.75（检测不到 WebP 编码回退 JPEG）、Canvas 重编码天然剥离 EXIF GPS、WebCrypto SHA-256（非安全上下文返回 ''）
- `lib/idb.ts` 扩展：`createCaseWithRooms`（建案即播种 6 房间）、`addSlotPhoto`（自动建 move_in capture；重拍不删旧照，同点位多 Photo 按 takenAt 取最新——零 schema 变更支撑重拍历史，旧照留给 T07 哈希链）、`addRoomToCase`（同 kind 重名自动 "卧室 2"）、`listRooms`（ROOM_ORDER 排序）/ `getRoomShotMap`（最新照片映射）
- `features/capture/CapturePage.tsx`（S03）：房间卡 ×6 + `[ 01 ]` 角标 + 已拍 X/18 等宽头 + Ring 进度 + 下一个点位 + `+ 添加房间` Sheet + 隐私说明；demo 分支内存假房间
- `features/capture/SlotListPage.tsx`（S04）：点位行（状态点 / why / 48px 缩略图）+ 底栏「拍下一个：××」自动推进 + 点已拍行开大图 Sheet（重拍→带 slotId 回相机 / 关闭）
- `features/capture/Camera.tsx`（S05）：getUserMedia（StrictMode 竞态守卫 + secureContext 检查）→ 失败静默降级文件上传不弹错误框；Wake Lock + 回前台唤醒重试；手电筒 feature-detect；快门 → pending 预览（重拍/用这张）；保存失败三态（重试保存[用这张] / 重拍）；demo 案保存→toast「演示案例不保存照片。」
- `features/case/NewCase.tsx` 改走 `createCaseWithRooms`；`app/App.tsx` 加 `/case/:id/capture/:roomId` 与 `/:slotId` 两级路由

**遇到的问题与解法**

1. **重拍历史 vs 不改 schema**：不覆盖旧 Photo（丢证据），同点位存多条、展示取 takenAt 最新。T07 哈希链可把整条历史链起来。
2. **`upload_file` 无法注入隐藏 input**：自动化工具只认快照可见的 uid；改为同源 fetch dist 内测试图 → DataTransfer File → 派发 change，完整走过 onPickFile 管线。
3. **React StrictMode 下 effect 双跑导致相机开两次**：startToken 递增令牌守卫；lint exhaustive-deps 要求 cleanup 引用稳定 → 抽 stopCamera useCallback。
4. **闭包过期（T02 遗留第 6 条）**：拍摄保存后 navigate 前 revoke pendingRef 的 objectURL，用 ref 而非 state 避免过期闭包。

**遗留**

- 「生成底稿」按钮（S03 底栏）未做：需要 T07 照片哈希链 + 底稿页，单独卡交付，本卡不半成品
- S05 拍摄页参考帧叠加（对齐用）归 T11（对比阶段）
- Photo 的 prevHash / chainHash 留空 ''，T07 哈希链接手
- demo 案拍照只 toast 不保存，完整预烘焙演示数据归 T28（M6）

**验收数据**

- `npm run build`：JS 128.15KB gzip（< 250KB ✅）；`npm run lint` 0 错误 0 警告
- 单测 19/19 通过（roomTemplates 4：18 点位 / kind 顺序 / id 唯一 / findSlot；idb 8：播种 6 房间、重拍 captures=1 & photos=2 & 最新胜出、跨点位 shotMap、房间去重命名、既有 4 条回归）
- 浏览器实测（注入 2000×1500 JPEG 走完整管线）：库内主图 **1600×1200 JPEG**（不放大 ✅）、缩略图 **320×240 WebP** ✅、**sha256 真实 hex** ✅；相机不可用 → 静默降级「这台设备开不了摄像头，从相册选一张也可以。」+ 无错误弹窗 ✅；保存 → 玄关 1/3 → 总览 1/18，「下一个」自动推进（门与门锁→地面）✅；点已拍行 → 大图 Sheet（全尺寸 blob + 重拍/关闭）✅；控制台零报错，无第三方网络请求

**需要人确认的**

- 真机验证（DoD 第 1 条）：后置摄像头取景、快门→预览→保存全链路、300ms 内出缩略图、手电筒开关，需要真机点过才算数
- 非 https 内网真机调试时 `crypto.subtle` 不可用 → sha256 存 ''，T07 需定这个场景的策略

---

## 2026-11-15 · T07 证据链 + T08 瑕疵标注

**做了什么**

- `lib/hash.ts`：`sha256Hex` / `computeChainHash`（SHA256(prevChainHash + sha256 + takenAtISO)，首张 prevHash=GENESIS）/ `sortChain` / `verifyChain`（返回第一处断链的 index + photoId + 原因 genesis/prev-mismatch/hash-mismatch）；只用 WebCrypto
- `lib/idb.ts`：`addSlotPhoto` 接链——prev 取同案件最新一条**已入链**照片（chainHash 非空），哈希在事务外算（WebCrypto 原生 promise 不受 Dexie 事务区管理，事务内 await 可能提前提交）；哈希算不出（非安全上下文）→ 存 ''，照片不入链但流程不断。新增 `addDefect`（seq = 案件内 max+1，**删除后不回收**）/ `deleteDefect` / `setDefectPhenomenon` / `listPhotoDefects`
- `domain/types.ts`：`Defect` 加 `seq: number`（已确认；Dexie 非索引字段，无迁移）
- `features/capture/Annotate.tsx`（S06）：照片区单指圈矩形（松手 ≥16×16px 才算数，松手后弹类型选择）+ 双指缩放/平移（1–3x，带平移夹取）+ 已标列表（编号/现象/删除/点行改类型）+ 底部 10 类选择条 + 完成；空态「这面墙有问题吗？圈出来。没有就点完成。」、提示「不用圈得很精确，能看出位置就行。」逐字取自 SCREENS.md
- 入口：S04 大图 Sheet 加「标瑕疵」（S06 未定义入口，取最近路径）；路由 `/case/:id/capture/:roomId/:slotId/annotate`

**遇到的问题与解法**

1. **「D-01 删除后不回收」无法从现有字段推导**（删除后 max+1 会顶替编号）→【阻塞】询问后确认加 `seq` 字段（与 DeductionItem 加 caseId 同 precedent）。
2. **合成指针事件下 React state 未提交**：pointermove/up 同批派发时 pointerup 读到的 draft 还是 null → 改为 pointerup 时从手势起点 ref 直接重算框，不依赖 draft state。
3. **合成指针的 setPointerCapture 抛 NotFoundError**（pointerId 非活跃）→ try/catch 包裹，捕获失败仅影响移出元素后的跟踪，不影响画框。
4. **Dexie 事务内 await 原生 promise 的坑**：链哈希计算移到事务外，prev 读取也在事务外（单用户顺序保存，无并发窗口）。

**遗留**

- 旧照片（链功能上线前保存的）chainHash='' 不入链：新照片以 GENESIS 重新起链，旧照片在底稿（T09）需显示「未入链」并从链校验集合中排除
- S06 类型条里 stain 与 dirt 的中文都是「污渍」（CONTENT.md §3.2 现状，vocab 注释已标同步要求），按住不擅改
- 双指旋转未做（S06 只要求缩放；参考帧旋转归 T11）

**验收数据**

- `npm run build`：JS 130.58KB gzip（< 250KB ✅）；`npm run lint` 0 错 0 警；单测 **31/31**（hash 8：完整链/乱序/篡改 sha256/篡改 takenAt/伪造 prevHash/首张非 GENESIS/中间抽张；idb 12：链式保存 + 篡改断链定位 + seq 递增/不回收/跨案隔离）
- 浏览器实测（合成指针走真实 UI）：画框 → 松手弹类型浮层 → D-01 污渍 → D-02 划痕 → 删除 D-01 → 新框拿 **D-03（不回收 ✅）** → 点行改类型（裂纹→掉漆 ✅）；控制台零报错
- 链落库实测：重拍保存新照片 → prevHash=**GENESIS**、chainHash **64 位 hex**、页面内用 `crypto.subtle` 重算 **逐字一致**；瑕疵（seq 2/3）仍绑定在旧照片上（重拍不迁移标注，证据正确性 ✅）

**需要人确认的**

- 真机双指缩放/单指画框手感（自动化只能验证事件逻辑，不能验手感）
- dirt 也叫「污渍」是否要在 CONTENT.md 里区分（如「积灰」）——涉及事实库，不擅动

---

## 2026-11-15 · T09 底稿页 + PDF 导出 + T10 分享给房东确认

**做了什么**

- `features/export/deedModel.ts`：底稿装配纯函数——`assembleDeed` 生成 P 编号（按 (takenAt, id) 全局递增、永不重排）、按房间分组（固定 kind 顺序）、瑕疵映射到照片 P 编号（孤儿瑕疵剔除）、`chained`（chainHash 非空集合）；`caseNoOf = LD-{id 前 8 位}`
- `features/export/deedCanvas.ts`：Canvas 渲染器，Block 流水（封面→KV 摘要→校验行→照片墙两列→瑕疵清单带 bbox 裁切缩略图→哈希链表→声明）；`paginate`（块不跨页）+ `renderDeedPages`（A4@2x 1190×1684）+ `renderShareCanvas`（1080 宽长图，上限 16000px）共用一套 block
- `features/export/deedPdf.ts`：`exportDeedPdf`——动态 `import('jspdf')`（懒加载 chunk，不进首屏），每页贴 JPEG 0.85 + 页码（纯数字，helvetica 即可，无需中文字体）
- `features/export/shareImage.ts`：`renderShareImage`（长图 toBlob）+ `downloadBlob`
- `content/scripts.ts`：`SEND_SCRIPT` 逐字取 CONTENT.md §6.2 开场话术（去掉「X 哥/姐，」称呼——范围内没有房东称呼字段）
- `features/capture/Deed.tsx`（S07）：封面区（别名/案件编号/租期/押金/生成时间）+ 摘要三数（照片/瑕疵/断链）+ 照片墙（P 编号 + 点位 + 时间 + hashShort）+ 瑕疵清单（D 编号 + bbox 缩略图）+ 哈希链表（12 位前缀，点击展开 64 位全文）+ 声明区 + 断链红条（「有 1 张照片的校验没通过，可能被修改过」+ 定位到该张 scrollIntoView）+ 底部「发给房东确认」→ ShareSheet（长图预览 + SEND_SCRIPT + 保存长图 + 复制话术，剪贴板失败降级提示手动复制）
- 三态：加载（骨架 + 「正在生成证据链…」）/ 失败（照片读取失败 + 重试）/ miss（没有找到这个案件）；S03 全部拍完后出现「生成底稿」主按钮

**遇到的问题与解法**

1. **PDF 中文字体方案**：jsPDF 内嵌中文需要子集字体（fontmin 依赖 + 8MB 字体进仓库 + 缺字风险）→【阻塞】询问后确认 Canvas 渲染成图片型 PDF（系统字体画进 canvas，代价是文字不可选中/复制）。
2. **canvas 瑕疵行文字与缩略图重叠**：文字基线 y+28 与 thumb 起点 y+24 相交 → 行高 150→184，thumb 移到 y+44。
3. **paginate 边距与 buildBlocks 不一致**（9% vs 6%）导致右对齐文本越界 → 统一为 6%。
4. `assembleDeed` 参数类型错（captures 误写成 `Pick<Photo,'captureId'>`）→ 改 `Pick<Capture,'id'|'roomId'>`，`PhotoLike` 补 `captureId`。
5. 验证断链红条时直接改 IndexedDB：photoId→thumbId 曾经的双 `newId()` 隐患已修；篡改 sha256 后红条 + 摘要「断链 1」+ 定位按钮全部按预期出现，验完已用 blob 重算还原。

**遗留**

- 未拍完时底稿页仍可直链访问（显示当前已有内容）；S03 按钮只在拍完后出现，直链不拦（无单独守卫需求）
- 真机「微信里能直接发」只能验到「保存长图落盘 + 话术可复制」，微信内分享行为需真机
- P-01（链功能前旧照片）sha256 仍有值，照片墙显示其 sha256 短码（未入链）；哈希链表已正确排除

**验收数据**

- `npm run build`：初始 JS **137.31KB gzip**（< 250KB ✅）；jspdf 126.39KB gzip 独立 chunk 仅导出时加载；`npm run lint` 0 错 0 警；单测 **36/36**（deedModel 5 新增：caseNo / P 编号+点位中文名+未知点位回退 / 房间分组与顺序 / 瑕疵 pNo+chained 过滤 / 孤儿剔除）
- 浏览器实测：底稿页封面/摘要（照片 3 · 瑕疵 2 · 断链 0）/照片墙/瑕疵缩略图（bbox 框）/哈希链表展开收起（64 位 hex）/声明；「导出 PDF」→ 落盘 `底稿-测试小区 1 幢.pdf` **3 页 3 图 137KB**（< 8MB ✅），页 1 封面（校验行 forceBreakAfter 独立收尾）、页 2 照片墙+瑕疵清单（无重叠、右对齐页内）、页 3 哈希链+声明；「发给房东确认」→ 长图 **1080×2194** 落盘、话术文案逐字正确；「复制话术」在无剪贴板权限环境走降级 toast「没复制上，长按话术文字手动复制。」；「生成底稿」按钮未拍完时正确隐藏；断链注入→红条+断链 1+定位滚动到位→还原后归零；控制台零报错，网络仅本地静态资源 + blob

**需要人确认的**

- 真机检查 PDF 视觉（A4 打印观感）与微信长图清晰度（JPEG 0.9）
- SEND_SCRIPT 去掉称呼「X 哥/姐，」是否符合预期（范围内无房东称呼字段）
