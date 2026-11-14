# 留底

> 入住留个底，退租有底气。
> 中国租客的退租押金维权工具 —— 只做四步：**取证 → 对比 → 定损 → 谈判**。

- 参赛：2026 Qoder 高校创造力大赛 · LifeHack 生活娱乐
- 截止：2026-11-30 18:00
- 首发城市：杭州
- 当前状态：**文档就绪，代码未开工**

---

## 从哪开始读

| 你是 | 先读 |
|---|---|
| 编码代理（Qoder / Claude Code / Codex） | [`AGENTS.md`](./AGENTS.md) → [`PRD.md`](./PRD.md) |
| 想验收交付物 | [`TESTPLAN.md`](./TESTPLAN.md) |
| 想知道为什么这么做 | [`DESIGN.md`](./DESIGN.md) |

文档优先级：`PRD > SCREENS > PLAN > DESIGN`。`CONTENT.md` 的事实永远高于代码里写死的值。

## 文档索引

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | 代理操作手册：技术栈锁定、十条硬规则、DoD、交付格式 |
| `PRD.md` | 实现契约：FR-101～FR-903、NFR、降级矩阵 |
| `SCREENS.md` | 18 个页面的结构、状态、文案 |
| `PLAN.md` | 32 张任务卡 + 里程碑 + 每日节奏 |
| `CONTENT.md` | 法条库、18 条判定规则、杭州 30 项价格、话术、免责 |
| `DEMO.md` | 演示案例、90 秒脚本、45 张拍摄清单、提交帖草稿 |
| `TESTPLAN.md` | 60 条验收用例、Bug 格式、三轮交接协议 |
| `DESIGN.md` | 产品设计（背景，冲突时让位） |
| `.qoder/rules/` | 按主题拆的 5 个短规则，Qoder 自动注入 |

## 目录状态

```
liudi/
├─ AGENTS.md  PRD.md  SCREENS.md  PLAN.md  CONTENT.md  DEMO.md  TESTPLAN.md  DESIGN.md
├─ .qoder/rules/           # 代理规则（已有）
├─ apps/web/               # 前端（T01 创建）
├─ functions/vision/       # FC 代理（T01 创建）
└─ README.md
```

## 第一句话该问代理什么

```
先读 AGENTS.md、PRD.md、SCREENS.md、PLAN.md 四份，读完先不要写代码，
用 5 行以内告诉我：你要做的第一张任务卡是哪张、它的验收标准是什么。
```
