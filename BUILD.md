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

---

## 2026-11-15 · T11 对比入口 + 退租对齐拍摄 + T12 配准（ORB+RANSAC）

**做了什么**

- `lib/register.ts`（T12）：OpenCV.js 加载器（`?url` 资产 + fetch 流式读取 → 真实百分比进度回调 → Blob URL 注入 script → 轮询 `cv.Mat` 就绪）+ `registerPair`（双图降采样 512 灰度 → ORB 800 → BFMatcher knn k=2 + Lowe 0.75 → findHomography RANSAC 3.0 → 内点 ≥ 20 门槛，H 换算回原始分辨率）+ `warpTo`（按 H 重采样，供 T13 差异检测内部用，不展示）；`setOpenCv` 注入缝供 Node 单测；加载失败返回 `load-failed`，不阻断流程
- `lib/register.test.ts`：确定性纹理夹具（种子随机色块+渐变+网格），640×480 平移已知图对（dx=24,dy=16，工作分辨率 0.8 倍，scaleHomography 被真实覆盖）；断言内点 ≥ 20、四角误差 < 3% 边长、空白图 → few-inliers、warpTo 后中心区域逐像素接近
- `lib/idb.ts`（T11）：`addSlotPhoto` 增加可选 `phase`（默认 move_in，行为不变）；新增 `getSlotPhotoByPhase`（某点位指定相的最新一张）、`listCompareSlots`（房间按模板序 × 槽位按模板序，标记 hasMoveIn/hasMoveOut）
- `features/capture/useCamera.ts`：从 Camera.tsx 抽出相机生命周期 hook（启动/降级 fileMode/常亮锁/切后台恢复/快门/相册/闪光/待确认流），Camera 与 Align 共用；Camera.tsx 改为消费 hook，UI 与行为不变
- `features/compare/Align.tsx`（S08）：退租拍摄页——入住参考帧 35% 透明度叠加（单指拖动/双指缩放 0.4–3×/双指旋转，pointer events 直接写 ref+transform 不走 setState）+ 参考帧开关 + 引导三步逐条点亮（700ms stagger）+ 「对不齐也没关系，下一步可以手动调。」+ 拍好了 → `addSlotPhoto(..., 'move_out')` → 回对比列表；无入住照片的点位显示「这个点位没有入住照片，直接拍退租也可以。」
- `features/compare/ComparePage.tsx`：对比入口改为槽位清单（已对齐 n / 18 · 房间分组 · 每行状态 可对比/待拍退租/缺入住底稿/未拍），全无入住时显示文案库「先拍退租照片，才有得比。」+ 去取证按钮；路由 `/case/:id/compare/:roomId/:slotId` → Align

**遇到的问题与解法**

1. **scaleHomography 方向反了**（写时自察）：正确是 `H_full = S_in⁻¹ · H_work · S_out`，初版写成 `S_in · H_work · S_out⁻¹` → 修正并用 640×480 夹具（缩放 ≠ 1）让测试真正覆盖。
2. **opencv.js 的 Module 是 thenable**（自带 `then`）：`Promise.resolve(cvModule)` / `await` 它会被当作 thenable 永远挂起（vite 单测里连 3 秒 watchdog 都不触发）→ `loadOpenCV` 改为返回包装对象 `{ cv }`，任何 promise 都不直接 resolve Module 本体。**浏览器路径同样会中招，等于提前排掉一颗线上雷。**
3. **vitest 环境 hook 内 await 挂起**：就绪轮询放 `beforeAll` 必挂、放 `it` 内正常 → 改为惰性单例 `ensureReady()` 在首个用例内加载（夹具构造一并放入）；opencv 加载走 `createRequire` 绕开 vite-node 对 13MB UMD 的转换。
4. **`new URL(node_modules 路径, import.meta.url)` 在 monorepo 里越界**，Vite 不发射资产（dist 无 opencv）→ 改 `import opencvUrl from '@techstark/opencv-js/dist/opencv.js?url'`，临时在 Align 里引用 register 验证发射成功（`opencv-*.js` 独立文件）后移除——T13 接线 S09 时资产会自然出现。
5. 浏览器自动化验证到对比页为止：槽位清单/空态/状态徽标实测正确；进入 Align 后 in-app 浏览器无原生 surface（此前截图已报 NATIVE_BROWSER_VIEWPORT_UNAVAILABLE），getUserMedia 挂起导致页面级操作全部超时，Align 交互改由真机验证。

**遗留**

- 【流程偏差待确认】SCREENS S08 把对齐相机定义在 `/case/:id/compare`；实际实现为 `/compare` 槽位清单 + `/compare/:roomId/:slotId` 对齐页（一屏一点位，符合「逐个点位重拍」的流程，也避免相机页直接承担列表职责）。若按 S08 原样，需要把清单挪去别处或去掉清单——见「需要人确认的」。
- S05 取证相机页的「参考帧叠加」由 Align 覆盖（取证流程保持只拍入住）；S09 处理中页 + S10 结果页在 T13。
- register 的加载进度 UI（真实百分比）待 T13 S09 页面消费。

**验收数据**

- `npm run test`：**41/41**（新增 register 3：平移图对内点 251/256 ≥ 20 ✅、四角误差均值 < 3% ✅（H≈[1,0.003,23.3; 0,1.002,15.7]，真值 (24,16)）；空白图 few-inliers ✅；warpTo 中心区域逐像素差 < 2 ✅。新增 idb 2：move_out 独立 capture + 两相照片分属 ✅、listCompareSlots 模板序 + 两相标记 ✅）
- `npm run build`：初始 JS **139.51KB gzip**（< 250KB ✅）；`npm run lint` 0 错 0 警
- 浏览器实测（/compare）：加载骨架 → 槽位清单「已对齐 0 / 18」+ 6 房间 18 槽位按模板序；玄关/门与门锁=「待拍退租」（hasMoveIn 来自已有 3 张 door 入住照），其余=「未拍」；无入住案件场景显示文案库空态 + 去取证；控制台零报错
- 浏览器未验证（环境无 surface）：Align 参考帧叠加与手势、fileMode 上传保存 move_out、Camera 页回归——已列入真机清单

**需要人确认的**

- 【阻塞级流程确认】对比入口结构按「槽位清单 + 逐点位对齐页」实现（偏离 S08 的单页定义）——是否接受？不接受则回改。
- 真机验证：Align 双指缩放/旋转手感、参考帧 35% 透明度是否够看清、fileMode 保存 move_out 全链路、Camera 页回归（重构后）。

---

## 2026-11-15 · BUG-07 哈希链守卫 + T13 差异检测 + T14 对比处理页与结果页

**做了什么**

- **BUG-07**：`lib/image.ts` 在 `processImage` 最前面加 `assertSubtle()`（先于一切解码，Node 单测也能直接覆盖该分支）；`crypto.subtle` 不可用 → 抛「当前环境无法生成校验指纹，请用 HTTPS 打开」，不再返回空哈希让证据链静默死亡（对应 FR-205 / NFR-5）
- **T13**：`lib/diff.ts` 纯函数（`ImageData → DiffRegion[]`，不碰 DOM 不 import Dexie）——双图面积均值重采样到 512 长边工作网格 → sRGB→LAB(D65) → 三通道各自 8×8 窗口 SSIM（C1/C2 按通道量程取值）→ 三通道最小值 < 0.72 为差异 → 膨胀+腐蚀闭运算 → 8 邻接连通域 → 面积 > 全图 0.3% → 强度 = mean(1−smin) 降序 → 截 8 个，bbox 归一化
- `lib/diff.test.ts`：mulberry32 确定性夹具 5 组（暗渍/亮划痕/彩色残留/双缺陷/泛黄噪点渍）+ 相同图 + 12 渍截断
- **T14**：`features/compare/Compare.tsx`（S09 处理页编排）——懒加载路由 `/case/:id/compare/:roomId/:slotId/result`，三段进度（对齐 → 找不同 → AI 看一眼【占位「待接入」，无假数据】），opencv 下载真实百分比，每段 8 秒显示「这一步有点慢，可以跳过。」+ 跳过按钮；配准失败不弹错，直接转手动对齐；diff 段失败如实显示失败视图
- `features/compare/ManualAlign.tsx`：拖动/双指缩放旋转 → `gestureToHomography`（`lib/register.ts` 新增纯函数 + 3 单测）→ `warpAffineImageData`（canvas 仿射，**手动路径完全不依赖 OpenCV**——引擎加载失败也能走完全程）
- `features/compare/CompareResult.tsx`（S10 结果页）：滑块对比（pointer 拖动直写 clipPath，不走 setState）+ 并排看切换 + 扫描线动效（600ms）+ 差异框与 F-编号角标错峰浮现（600ms + i×120ms transitionDelay）+ Sheet 详情（裁剪图 + 强度% + 像素估算 + AI 占位文案）+ 文案库空态原文 + 返回点位清单；`prefers-reduced-motion` 由 tokens.css 全局开关接管
- `App.tsx`：Compare 路由 `lazy` + Suspense；`lib/image.ts` 补 `blobToImageData` / `warpAffineImageData`

**遇到的问题与解法**

1. **ManualAlign 的 `outRef` 从未绑定到任何元素**（浏览器实测抓出的真 bug）：overlay img 绑的是手势用的 ref，量测 effect 读的是 `outRef.current` → 永远 null → geom 永不设置 → 「对好了，开始对比」永久禁用。纯函数单测盖不住 ref 接线错误，浏览器验证的价值实证。修复：手势 ref 与量测 ref 统一为一个。
2. **SSIM 对均匀亮度平移天然钝感**：平坦区域整体变亮/变暗的窗口 SSIM 稳定在 ~0.87（C1 稳定项托底），过不了 0.72 检测线——只有结构性变化（噪声/边缘/部分覆盖）才触发。夹具按此设计：划痕叠加 ±25 颗粒噪声，色块用部分覆盖触发结构项塌缩。检出框会因部分覆盖窗口向外膨胀最多一格（IoU ≈ (d/(d+2))²），夹具尺寸按 d ≥ 8 格设计。
3. **in-app 浏览器编不动 10.9MB opencv WASM**：预览服上真进 auto 路径 → 页面级操作全部超时（>2 分钟）、browser target 崩溃。auto 路径改由 Node 单测覆盖（真 opencv，6/6 通过）；降级链用 dev 服务器 + initScript 污染 `window.fetch`（URL 含 opencv 一律 reject）强制 load-failed 验证。
4. **hash 导航不重载**：自动化工具 navigate 到同源 `#/...` 只触发 hashchange，initScript 不注入、SPA 原地切路由 → opencv 又真编一次（页面卡死）。解法：目标 URL 加 query 参数强制整页加载。工具行为，与产品无关。
5. 测试脚本直连 IndexedDB 需 `open('liudi')` 不带版本号（5173 origin 库已到 v10）。

**遗留**

- auto 配准路径在浏览器里的真 opencv 全链路只有 Node 单测覆盖；in-app 环境无法演示，待真机/外部 Chrome
- S10 底部按钮暂为「返回点位清单」；「逐条确认」归 T18 判定页
- 槽位清单暂无「已配对点位 → 查看对比」回看入口（对比过一次后想回看需从对齐页重进）——记给后续打磨
- AI 段为占位（T16 接 VLM）；低置信度「这条需要你自己确认」在 T17 规则引擎落地
- 真机清单追加：滑块手感、双指手势、扫描线 60fps、低端机并排降级

**验收数据**

- `npm run test`：**49/49**（新增 diff 7：5 组 IoU 实测 0.909 / 0.800 / 1.000 / 0.922+0.800 / 0.922，全部 > 0.6 ✅；相同图 → `[]` ✅；12 渍 → 截 8 ✅。新增 image 2：subtle 不可用 → 抛指定错误 ✅、可用 → 不抛该错 ✅。新增 register 手动对齐 3 ✅）
- `npm run lint`：0 错 0 警；`npm run build`：初始 JS **139.80KB gzip**（< 250KB ✅）
- 产物清单：index.html 0.58 kB；`index-*.js` 443.29 kB（gzip 139.80 kB）；`Compare-*.js` 20.27 kB（gzip 8.11 kB，lazy）；`opencv-*.js` 10,872.78 kB（独立资产）；jspdf / html2canvas / purify / index.es 为 PDF 懒加载块
- **opencv 隔离 grep**：index.html 0 处 / 主 chunk 0 处 / Compare chunk 1 处 ✅
- 浏览器实测（dev 5173，fetch 污染强制 load-failed）：自动对齐失败 → 无报错弹窗直接进手动对齐（「自动对齐没成。拖动、双指缩放旋转……」）→ 对好了，开始对比 → canvas 仿射 → diff → 结果页 1 处差异（F-01 强度 54%）；点卡片 Sheet 显示「差异强度 54%，约 775×575 像素。」「AI 描述待接入。自动对比只找出位置，这块是什么由你判断。」；滑块拖动 50%→35% 直写样式；相同图对 → 文案库空态原文「这张照片没看出明显差异——这本身也是好消息。」；控制台零报错

**需要人确认的**

- S10 路由实现为 `/case/:id/compare/:roomId/:slotId/result`（SCREENS S10 字面为 `/case/:id/compare/result`）：槽位上下文是两层对比入口（S08 已确认修法）的必需参数，按 PRD > SCREENS 执行同时上报
- diff 段「跳过」语义 = 直进失败视图（如实告知「这一步没比成」），不出假结果——是否符合预期？
- 真机清单：滑块手感、双指手势、扫描线 60fps、低端机并排降级、auto 配准全链路。

---

## 2026-11-16 · T15 FC 代理 + T16 VLM 客户端与降级

**做了什么**

- `functions/vision/index.js`（T15）：FC 自定义运行时 HTTP 代理，**零 npm 依赖**——`handleRequest` 纯逻辑（依赖注入 fetch/时钟/限流表）+ 底部薄装配。行为：origin 白名单（env `ALLOWED_ORIGINS`，未配置只放行 localhost 开发四件套）→ 未授权 401；滑窗限流 20 次/分钟/IP → 429；body ≤ 2 张 dataURL 图（单张 ≤ 2MB）→ 违规 400；密钥 `DASHSCOPE_API_KEY` 只在 env，缺失 500；上游百炼 compatible-mode（默认 `qwen-vl-max`，env `DASHSCOPE_MODEL`）25s 超时 → 504；5xx/坏响应 → 502。**返回体只有逐条校验后的白名单字段，永不含原始模型输出**；模型文本先剥围栏/夹话再 `JSON.parse`，bbox 越界、phenomenon/severity 非法、confidence 出界、description 为空的条目整条丢弃，最多保留 6 条
- `functions/vision/index.test.js`：node:test 14 条（CORS 预检 / 401 / 405 / 限流与跨 IP / body 校验 / 缺密钥 / 围栏 JSON 混坏条 → 只留合法且字段白名单 / 提示词含「不是裁判」/ 上游 5xx→502、超时→504 / 6 条截断与空 observations / extractJson 容错 / sanitize 拒收清单 / 滑窗数学）；根 `npm test` 改为 vitest + `node --test functions/vision/` 两段
- `lib/api/vision.ts`（T16）：zod（4.6.7，**PLAN T16 卡点名引入**）按**逐条** safeParse——一条坏只丢一条不连坐；脏词正则（应当赔偿/应该赔偿/需要赔偿/该赔偿/房东责任/租客责任/责任在房东/责任在租客/全额扣除）命中 description 或 cause_hypothesis → 整条丢弃；25s 超时 + 失败重试 1 次（仅网络错/5xx/429 可重试，其余 4xx 不重试）；外层 AbortSignal 支持跳过；**任何失败返回 null 不抛**——降级是常态路径
- `Compare.tsx` 第三段接线：`正在让 AI 看一眼…`（S09 原文），逐区域并行发裁切图对（入住+退租各一张，**只传裁切不传整图，请求体无地址无姓名**）；8 秒慢提示 + 跳过（abort 全部在途请求，已完成的作废、全部记 null）；0 处差异直接跳过 AI；`VITE_VISION_API` 未配置 → 第三段快速「没做成」进结果页
- `CompareResult.tsx`：卡片副行在有 AI 时显示「污渍 · 中度」；Sheet 有 AI → 观察原文引用块 + 「AI 只描述看到的现象，不判断该谁负责。」（S12 文案）+ needs_rephoto 提示；无 AI → 「AI 未能识别。这块是什么，由你来选：」+ **10 类现象手选控件**（5×2 网格），选后卡片显示「现象：X（你选的）」

**遇到的问题与解法**

1. **node:test 首轮 3 条失败全是测试自身的错**：限流用例忘注 fetch 替身打了真网络；env 覆盖把白名单也清了（401 顶了 500）；滑窗恢复点算错（80s 才出窗）。修测试，实现未动。
2. **zod 校验粒度**：整数组 parse 会让一条坏数据连坐全部——与 FR-402「该条被丢弃」不符，改为 envelope 宽 + 逐条 safeParse。
3. **in-app 浏览器本批完全不可用**：initScript 导航全部超时（昨天同操作正常），改用 evaluate 注入 fetch 污染不生效（疑似隔离世界），深路由一律真下载 opencv → WASM 编译卡死主线程，连 home 页 `document.title` 都超时。**判定为自动化环境退化**（浏览器级操作正常，页面级全灭），T16 的 UI 手选控件本批无法浏览器实测，已记真机清单。lib 层与 FC 层行为全部有单测覆盖。

**遗留**

- FC 端到端（真密钥 → 真百炼）未跑：本地无 `DASHSCOPE_API_KEY`；部署配置写死在 index.js 头注释（3 个 env），README 归 T30 打磨
- AI 结果目前只活在结果页视图态；T18 判定页落地时随 finding 持久化（`Finding.aiDescription/aiConfidence` 字段契约已就位）
- 手动对齐路径不做 AI 段（用户已亲手核对位置，Sheet 内手选即可）；若要补齐走 processing 复用段三
- zod 只进 Compare 懒加载块（8.11→34.84KB gzip），初始 JS 不受影响；若嫌大可换手写校验，等真机包体测量再定
- 真机清单追加：AI 段真密钥全链路、Sheet 手选交互

**验收数据**

- `npm test`：web **61/61**（新增 vision 客户端 12：正常映射/脏条目跳过/全脏→null/坏字段逐条丢弃/空→null/502 重试成功/双 502→null/400 不重试/外层中止/未配置不发请求/脏词正则命中与不误伤）+ FC **14/14**
- `npm run lint`：0 错 0 警；`npm run build`：初始 JS **139.81KB gzip**（< 250KB ✅）
- 产物清单：index.html 0.58 kB；`index-*.js` 443.31 kB（gzip 139.81 kB）；`Compare-*.js` 113.36 kB（gzip 34.84 kB，lazy，含 zod）；`opencv-*.js` 10,872.78 kB（独立资产）；jspdf / html2canvas / purify / index.es 为 PDF 懒加载块
- opencv 隔离 grep：index.html 0 / 主 chunk 0 / Compare chunk 1 ✅（与上批一致）
- 浏览器实测：**本批未做成**（自动化环境退化，见「遇到的问题」3）；上一批同路线（poison → 手动对齐 → 结果页）已验过，本批仅新增段三快速失败与 Sheet 手选，风险集中在纯渲染层

**需要人确认的**

- zod 依 PLAN T16 卡引入（4.6.7，进懒加载块不进首屏）——按卡执行，报备一声
- `DASHSCOPE_API_KEY` / `DASHSCOPE_MODEL` / `ALLOWED_ORIGINS` / 前端 `VITE_VISION_API` 四个 env 的正式值待部署时定；本地无密钥，FC 端到端未验

---

## 2026-11-16 · T17 规则引擎 + T18 判定列表页

**做了什么**

- `domain/rules.ts`（T17）：`judge()` 纯函数，零 React/Dexie/网络依赖。CONTENT §3.2 十八条规则按表序实现（A-01 / B-01…B-09 / C-01…C-05 / C-99 / A-02 / X-01，A-02 执行位见下）；置信度公式照抄 §3.3（base × 证据系数 × AI 系数，0.55 告警线导出为 `CONFIDENCE_WARN`）；导出 `iouBBoxes` + `MATCH_IOU_THRESHOLD`（0.35）供调用方做 A-01 匹配。文本线索（渗水/霉斑/撕扯/泼洒/钉眼/成片/直径 mm）用确定性正则从 `aiDescription` 提取——不做 LLM 判断
- `domain/rules.test.ts`：36 条。18 条规则每条至少 1 个正例 + 关键反例（泼洒的 dirt 不判 B、霉斑的 discolor 不判 B、moderate 划痕不判 B、租期不足的裂纹不判 B、12mm「钉眼」不判 B）；置信度公式三段；纯函数性（同输入深相等）；第一条命中优先级；IoU 几何
- `content/legal.ts`（T18 依赖）：8 条法条，原文照抄 CONTENT §1，含一句人话；`findLegal(key)` 供 chip 展开
- `content/roomTemplates.ts`：SlotTemplate 增加 `surface`（18 个点位逐一标注：墙面→wall、地面→floor、门窗→door/window、表计/油烟机→appliance、台面/洁具/地漏→fixture）——手选现象生成 finding 时 surface 从点位推导，不猜
- `features/compare/JudgementList.tsx`（T18，路由 `/case/:id/judge`）：四格统计（A/B/C/待确认）；每条 `[ F-nn ]` + 类别徽章（3px 色条）+ 房间·现象 + 一句理由 + 法条 chip（Sheet 展开原文+人话+免责，FR-406 不跳外链）+ 置信度；`confidence < 0.55` 显示「这条需要你自己确认」；改判 Sheet（A/B/C + 备注选填）写 `overriddenByUser`，保存后「已由你改为 X」+ 原判定小字保留（FR-405）；底部「生成定损单」→ 定损页；三态齐全；demo 案例用同一套规则引擎在内存出判定
- 确认链路：S10 底部主按钮「逐条确认」落地——CompareResult 校验每个区域都有现象（AI 或手选，缺则跳到该 Sheet + 提示），Compare.tsx 生成 Finding（surface 缺省取点位模板，手选 severity 落 moderate）+ 与入住底稿瑕疵 IoU 匹配 + judge 落库（同点位旧结果整批替换）；ComparePage「下一步」改为判定页
- `lib/idb.ts`：`listCaseFindings`（房间序 + bbox 位序联表）、`replaceSlotFindings`（事务内按 房间×点位×退租相 替换）
- 修 root `npm test` 的隐性 bug：`node --test functions/vision/` 对带 package.json 的目录只计 1 个测试入口，14 条 FC 测试实际只跑 1 条壳——上一批交付的「14/14」是显式跑文件得出的，目录形式一直是坏的；脚本改为显式指向 `index.test.js`

**问题与解法**

1. **A-02 执行位矛盾（文档）**：CONTENT §3.2 表序里 A-02 排 #2，条件是「底稿有该表面照片但未标此瑕疵」——若按字面序执行，只要有入住照片，#3–#16 的全部 B/C 专属规则（B-01 泛黄污渍…）永远不可达，B 类变死代码，与表格自身存在矛盾。按 §13「先执行同时上报」处理：A-01 → 专属规则（表序）→ C-99 → A-02 → X-01
2. **绝对面积条件不可观测**：B-01「面积 < 0.5㎡」、C-02「< 1㎡」需要真实世界尺寸，照片管线给不出（bbox 只有归一化比例），硬编一个换算系数就是编数据——舍弃该子条件，靠现象×表面×文本特征判定，宁 C 不 B
3. **`node --test` 目录形式**：见上，属上一批遗留的真实流程缺陷，本批修复
4. 浏览器实测环境进一步退化：本批判定页不含 opencv，轻页面照理可冒烟——导航成功、标题正确（应用确实渲染了），但 snapshot/screenshot/evaluate 全部 15s 超时。环境级故障（非本仓代码），判定页 UI 未能在浏览器目验

**遗留**

- T19 真实照片校准（M3 收尾卡）：需要人看图，本批只备好了引擎
- AI 结果（description/confidence）已随 finding 持久化；`cause_hypothesis` 未持久化（Finding 契约无此字段），文本线索只取自 description
- 改判在 demo 案例里是内存态，刷新即还原（demo 不落库）
- 真机清单追加：确认→判定列表全流程、法条 Sheet、改判 Sheet、demo 判定页渲染

**验收数据**

- `npm test`：web **100/100**（61 → 100：rules 36 + format 3）+ FC **14/14**（修复后目录形式真实可复现）
- `npm run lint`：0 错 0 警；`npm run build`：初始 JS **145.27KB gzip**（< 250KB ✅，+5.46KB 来自规则引擎/法条库/判定页）
- 产物：`index-*.js` 458.19 kB（gzip 145.27）；`Compare-*.js` 115.00 kB（gzip 35.53，lazy）；opencv 10,872.78 kB 独立资产不变
- 浏览器冒烟：判定页导航成功（标题/URL 正确），页面级操作超时——UI 细节未目验，见遗留

**需要人确认的**

1. **A-02 执行位**（上面问题 1）：按「专属规则优先」执行，理由模板与类别（C）不变。若你认可，CONTENT §3.2 表序说明由你顺手补一句即可
2. **绝对面积条件舍弃**（问题 2）：B-01/C-02 的 0.5㎡/1㎡ 上限当前不参与判定
3. **手选 finding 的 severity 落 moderate**（Finding 契约必填，UI 不展示该字段）：副作用是「手选裂纹 + 租期 ≥24 月」会命中 B-04 判 B；若你认为手选应一律不判 B，我把 severity 相关 B 规则加「仅 AI 来源」门槛
4. **PLAN §6 的 ctx（contractClause）未实现**：无规则使用，且 §3.4 明确不判条款效力

---

## 2026-11-16 · T20 扣款拆解 + T21 价格库

**做了什么**

- `domain/parse.ts`（纯函数，18 单测）：微信扣款文本 → 条目。先识别「一共/合计/总共/总计」行为总数（statedTotalFen，用于总和校验，不进条目）；其余行剥序号（1. / 2、/ 3）/ 一、）后拆条目：`¥`/`元`/`块钱`/`块`（块后非汉字，防「3 块地板」）后缀金额 + 落在金额覆盖区之外的裸数字，一行多金额按切分段落各成一条；量词/日期后缀排除表 + 「押金/月租/租金/定金」lookbehind 排除非扣款数；金额 > 100 万元丢弃；label 清洗（悬空动词「算/要/加…」、首尾标点、40 字截断、无名目兜底「未注明名目」）；rawText ≤ 500 字（FR-501）；条目上限 20
- `functions/extract/`：第二个 FC 函数（/api/extract），与 vision 同套安全模式（origin 白名单 / 20 次/分/IP / 文本 ≤ 2000 字 / 上游 25s / 响应不含原始模型输出）；qwen-plus，系统提示词禁判责、禁把总数当条目；服务端 元→整数分 + 逐条白名单清洗，11 单测
- `lib/api/extract.ts`：客户端，vision 同款（zod 逐条校验、失败重试 1 次、任何失败返 null 不抛），8 单测；**由 Parse.tsx 动态 import**——zod 因此留在懒加载块
- `features/valuation/Parse.tsx`（S13，替换占位 ValuePage）：自适应高度 textarea（2000 字上限）+ 手动加条（名目/金额）+ 三态（拆解中/失败「这段没看懂，你可以手动加几条。」/拆完预览）+ `[ 01 ]` 序号行 + 合计行 + 总数一致性提示 + 免责声明。文案逐字取自 SCREENS S13
- `content/prices.ts` + 6 单测：CONTENT §4 全部 30 项，元→分，life「—」→ null（不折旧）；全部 unverified: true、source 空串（不编造来源），updatedAt 2026-11-15

**FR-502 编排**（Parse.tsx 内）：先跑本地正则 → 正则空手 **或** 条目合计 ≠ statedTotalFen 才调 LLM → LLM 条目合计对不上总数（或没写总数时直接采信）→ 对不上回退正则结果 → 仍空手进失败态转手动。未配置 VITE_EXTRACT_API 时正则结果直出（演示/离线零依赖）

**问题与解法**

1. **zod 被拖进主包**：Parse 静态 import extract 客户端 → 初始 JS 145.27→174.52KB。LLM 拆解是兜底路径，改为 `await import('@/lib/api/extract')`，主包回到 **147.46KB**（extract 模块与 Compare 共享 zod 懒块）
2. **正则三连修**（单测抓的）：多金额行 label/rawText 需从上一个金额末尾切（原先串上文）；「算」字悬空动词要在标点剥离**前**去（「……不见了，算」残留逗号）；`块` 补进量词排除表
3. cleanLabel 首版字符类里未转义的 `]` 会造成模块加载期 SyntaxError——改为字符串拼正则

**遗留**

- 拆解结果本批只做**预览**（S14 未建）；落库（deductions 表）与定损引擎接线在 T22/T23 批，不预写假字段
- 价格库 30 项全部待核价（CONTENT §4.8 P4 任务，11/25 前）；`content/prices.test.ts` 的「全部 unverified」断言在核价后需同步更新
- 浏览器冒烟未做（环境连续两日页面级操作超时，不再烧时间）；真机清单追加：S13 粘贴→拆解→手动加条→删除、demo 案例定损页、2000 字上限提示

**验收数据**

- `npm test`：web **132/132**（+32：parse 18 + prices 6 + extract 客户端 8）+ FC **25/25**（vision 14 + extract 11）
- `npm run lint`：0 错 0 警；`npm run build`：初始 JS **147.46KB gzip**（< 250KB ✅，+2.19KB）；`Compare-*.js` 115.00 kB（gzip 35.53，lazy，含 zod + extract 客户端）；opencv 10,872.78 kB 独立资产不变
- FR-502 演示验收：DEMO §1.1 七行原文 → 正则路径拆出 **5 条**，合计 **320,000 分 = ¥3,200**，总数行识别 320,000，全部离线完成

**需要人确认的**

1. **DEMO §1.2 与价格库对不上**（影响 T22 定损引擎的演示数字，两处）：
   - 门锁：CONTENT §4.3 `lock-set` mid **260** → 260 × (1 − 14/96) = **222**；DEMO §1.2 写 **235**（对应 mid 275）
   - 缺失物品：价格库**没有**凉席/床单/卧具项（DEMO 的 mid 180 / life 6 年无出处）；按现库 T22 会把它记为「暂无参考价，按房东报价暂记」，DEMO 的 **145** 算不出来 → 合计 380 也对不上（会是 222 + 暂记）
   - 建议：P4 核价时补「卧具（凉席/床单等）」项、lock-set 按核价结果定 mid，然后由你同步 DEMO §1.2 的三个数字；CONTENT 事实我不代改

---

## 2026-11-16 · T22 定损引擎 + T23 定损页（建议层）

**做了什么**

- `domain/valuation.ts`（纯函数，25 单测）：
  - **匹配（FR-503）**：32 条正则匹配表，按「损伤/服务」定向而非房东提的处理方式——「印子和钉眼…整面重刷」仍落 `wall-patch`，FR-505 的 4.0 倍才成立；顺序即优先级（先家电/保洁等具体服务，后墙面/地面，兜底「墙/漆」）；表内 id 在价格库缺失时向后匹配、最后落 unmatched（为 P4 补卧具项留位：`bedding-set` 已在匹配表里）
  - **折旧（FR-504）**：`residual = 1 − min(1, months/(12×life))`；`liable = round(mid × residual / 100) × 100`——在**元**上取整后存分（价格库口径是元，CONTENT 公式在元上 round，这样 P4 把 lock-set mid 核到 275 后 235 精确复现，不在分上出现假精度）；封顶不超过主张额；C 责任比例取 1（共有情形无数据源不细分）
  - **虚高（FR-505）**：主张 > 市场上限 × 2 → `inflatedRatio = 主张 / high`
  - **三数（FR-506）**：每条主张只落一个桶——成立项 liable 进应付、超出部分并进不应付；不成立整条进不应付；争议整条进争议；恒等式 应付+不应付+争议=主张总额（单测断言）
  - **状态判定只读上游 judgements**：低置信（< 0.55）且未经用户确认的判定**不驱动金额**（与判定页待确认线一致），只进争议；加氟无 C → 712 不成立；保洁/清洗类（life=null）无 C → reg-10 凭证不成立；有价无判定 → 争议；无价 → 争议 + 暂记
- `features/valuation/suggest.ts` + 15 单测（FR-508 建议层）：六种状态各一句模板（用「建议/最多」）；`validateAiSentence` 做**数字回填校验**（全句数字必须落在 allowedSet = 区间/建议价/主张额的元字面 + 月数/年限/数量，否则整句丢弃回退模板）+ 判决式措辞黑名单（「法院会判/一定能要回/必赢/保证退款/百分百」→ 拒）；纯函数
- `features/valuation/Valuation.tsx`（S14）：三大数字横排（应付衬线最大 accent）+ 一句话（应付>0「该赔的 N，一分不少。」/ 全不成立「这些项目都站不住。」/ 有争议「能定的还没定下来…」）+ 真实 `<table>`（扣款项/房东/判定/应付，行可展开六行块：现象/定性/依据/市场/折旧/建议）+ 虚高「高于市场 4.0 倍」小字 + unmatched/disputed 注记 + 免责声明；金额右对齐等宽；每行法条 chips 可展开原文+人话
- `features/case/LegalRefChips.tsx`：法条角标+Sheet 抽出为共用组件（本批 S14 先用；S11 判定页暂保留内联实现，不动已完成模块）
- **deductions 表用途定案**：只存拆解条目（`parsedToItems` 留零估值字段），S14 每次用**最新判定现算**——判定改了不用重新拆解，建议层天然只读不回写（FR-508 断言由纯函数结构保证）；S13 拆解成功且总数对上 → 落库 + toast「拆出 N 条，合计 ¥X」+ 跳 S14；对不上留在 S13 显示差异 + 「拿这几条去定损」按钮
- `demo/demoCase.ts` 加 `demoDeductionText`（DEMO §1.1 原文）：S14 演示态用真实拆解+引擎现算

**问题与解法**

1. `Source.months` 与引擎 `tenancyMonths` 字段名不一致被 tsc 抓住，统一为后者
2. 建议层首版只挡集合外数字，「法院会判你只付 235 元」漏过（数字合法）——补措辞黑名单，产品立场红线不靠下游 UI 把守
3. 浏览器冒烟仍是页面级操作超时（连续第三日降级）：navigate 成功 + snapshot/screenshot 双超时，UI 正确性由 tsc strict + 172 条单测背书，真机点验留清单

**验收数据**

- `npm test`：web **172/172**（+40：valuation 25 + suggest 15）+ FC **25/25**；`npm run lint` 0 错 0 警
- `npm run build`：初始 JS **152.71KB gzip**（< 250 ✅，+5.25KB：引擎+价格表+S14）；zod 仍在懒加载块（Valuation 不碰 lib/api/extract）
- **FR-504 复现**（单测）：注入修正价格库（lock mid 275 + 卧具 180/life 6）+ 已确认判定 → 门锁 **235**、卧具 **145**、应付 **380**、不应付 **2,820**、争议 0，与 PRD FR-504 / DEMO §1.2 **逐位一致**——公式与文档无矛盾，差的只是价格项（待定项 #5 证据补齐）
- **演示现状**（现行价格库 + 低置信判定）：应付 0 / 不应付 900 / 争议 2,300（墙面与门锁因判定待确认进争议，缺失物暂记）——诚实输出，等 P4 核价 + 演示判定确认后自动靠拢 §1.2
- FR-505：墙面 1,400 vs wall-patch high 350 → **4.0 倍** ✅

**没做的**

- 演示态判定页的改判不跨页同步（内存态各自维护）；真实案件走 Dexie 天然同步，演示完整故事线归 T28 预烘焙
- e2e 未跑（环境无可用浏览器，同前两批）；真机清单追加：S13 对不上总数的手动补条流、S14 行展开六行块、法条 Sheet、demo 定损页三大数字

## 2026-11-16 · T24 信件生成 + T25 房东模拟

**做了什么**

- `domain/numcheck.ts` + 7 单测（FR-508 = FR-602 **同一套校验**抽出共享）：`numberTokens`（归一化 ¥/￥/逗号/空白）、`numbersWithin`、`allowedSetFor`（分→元字面 + 计数）、`FORBIDDEN_PHRASES`（法院会判/一定能要回/必赢/保证退款/百分百）；`suggest.validateAiSentence` 改为委托它，行为不变（15 单测仍绿）
- `content/letterTemplates.ts`（FR-603/604）：9 模板 = 3 语气 × 3 渠道；模板**不碰数字**——金额全部由 compose 传格式化字符串；`renderLetter(facts, tone, channel, summary?)` 的**说明段可替换**（微信开头 / 正式函事由 / 调解申请争议事项），LLM 只重写这一段，其余行模板定死；固定结尾句、免责、诉求行照 SCREENS S15
- `features/negotiate/compose.ts` + 12 单测（FR-601/602）：`composeTemplate` 纯同步必成；`composeWithAi` 模板先行 → LLM 润色说明段（≤180 字）→ 四道校验（长度 / 措辞黑名单 / 幽灵引用 `[DF]-xx` 必须在 citations 里 / **数字回填**`letterAllowedSet`）任一不过 → 整段丢弃回退模板，用户无感（console.debug）；`letterAllowedSet` 白名单由 domain 产出：押金/租金/三数/退款/每项主张·应付·估价区间（元）+ 月数/7 天/35 条号
- `functions/wording/`（FC，与 extract 同安全模式）+ 14 单测：`task=polish`（重写说明段，禁新增数字/法条/承诺，temp 0.3）与 `task=landlord`（人格扮演 + 破绽 + stance，禁法条/人身攻击，temp 0.7）；限流 20/min/IP、25s 上游超时、origin 白名单、字段白名单校验（修了一个真 bug：polish 校验失败时 `{task, ...null}` 仍为 truthy 会放过非法 body——改为 validatePolish 自带 task 并显式拒绝超长 section）
- `lib/api/wording.ts` + 9 单测：polish/landlord 共用端点客户端，zod 信封留在懒加载块、25s 超时、重试 1 次（网络/429/5xx）、任何失败返回 null；`landlordLawOk`（S16 兜底）：回复里出现的《XX》第 N 条必须在 `content/legal.ts` 存在（容忍 reg-10 标题带施行日期后缀），编造法条 → 整条拒收
- `features/negotiate/NegotiatePage.tsx`（S15）：语气/渠道分段控件（默认中性/微信）+ 等宽可编辑预览（用户改动优先，润色到达不覆盖已编辑文本）+ 引用证据角标条 + `复制全文`（clipboard API + execCommand 回退，FR-607；真实案件存 `db.letters`）+ `先练一遍`（带正文跳模拟）+ 免责页脚；模板即时渲染，润化静默替换
- `features/negotiate/Roleplay.tsx`（S16，**lazy 路由**——静态引 zod 不能进首屏）：三种人格（开场白照抄 CONTENT §6.1，零 LLM 启动）→ 气泡对话，破绽点评挂在**它点评的那句租客气泡下方**；最多 3 轮；每轮失败「这句没接上：AI 没能回应。」+ 重试（三态齐）；总结「守住了 N 个关键点，让出了 M 个不该让的」由**代码统计 stance**（数字不经 LLM）；未配置端点显示联网提示不白屏
- `features/valuation/useValuationInput.ts`：S14/S15/S16 共用输入源 hook（demo 内存 / Dexie liveQuery，现算 valuation），Valuation.tsx 改用（行为不变）；顺带补出 caseData 供信件取 alias/rentMonthly
- 根 `package.json`：workspaces + test 挂上 `functions/wording`

**验收数据**

- `npm test`：web **200/200**（+28：numcheck 7 + compose 12 + wording 9）+ FC **39/39**（vision/extract 25 不变 + wording 14）；`npm run lint` 0 错 0 警
- `npm run build`：初始 JS **155.85KB gzip**（< 250 ✅，+3.14KB：模板+compose+S15）；zod 25.90KB 在独立懒加载块；Roleplay 单独 chunk 1.08KB
- **FR-602 用例**（单测）：LLM 返回集合外数字（9999 元）→ 整段丢弃回退模板 ✅；禁语 / 超长 / 幽灵引用（D-03 不在 citations）同样回退 ✅
- **FR-603 断言**（单测）：3 渠道下三种语气的数字 token 序列**逐位一致**——为此把强硬语气结尾的「第 35 条」从信里拿掉（条号数字会多出来破坏一致性；条号仍出现在争议项依据里，35 在白名单）
- FR-601：9 组合全部渲染（结尾句/免责/主题齐备，body 无禁语）✅；FR-604：微信无称谓短句 / 正式函事由+落款 / 调解申请双方占位 ✅
- landlord 编造法条（《物权法》第 99 条 / 错法名的真实条号）→ 客户端拒收返回 null ✅

**问题与解法**

1. FC polish 校验 `{task, ...null}` truthy 漏放 → validatePolish 返回值自带 task，section 超 2000 字显式 400（截断放行还会漏进上游调用，单测抓住）
2. firm 语气 ASK 句引《住房租赁条例》第 35 条 → FR-603 数字一致性被破坏 → 结尾改「我将申请调解」不带条号
3. FR-602 验收示例「2000 元」在演示案里恰好是合法数字（主张总额 2000）——测试改用真正集合外的数，校验逻辑本身不变

**没做的**

- 浏览器冒烟仍不可用（browser-use 降级第四日）：S15/S16 真机清单——语气/渠道切换、复制 toast、iOS 上 execCommand 回退、3 轮后总结、破绽点评位置、断网时 wording 降级文案
- Roleplay 的 location.state.body 刷新后丢失 → 回退用模板摘要重新组信（不阻塞，行为已定义）

**需要人确认的**

- 无（本批未动判定/金额；useValuationInput 抽取为 S14/S15/S16 共享属同批基础设施，S14 行为零变化）
