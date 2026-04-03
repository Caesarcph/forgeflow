# ForgeFlow

<p align="right">
  <a href="./README.md"><strong>English</strong></a> |
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img src="./docs/assets/forgeflow-banner.svg" alt="ForgeFlow 横幅" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/Caesarcph/forgeflow/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0f172a.svg?style=for-the-badge"></a>
  <img alt="Status: Alpha" src="https://img.shields.io/badge/status-alpha-c2410c.svg?style=for-the-badge">
  <img alt="Local First" src="https://img.shields.io/badge/local--first-yes-0f766e.svg?style=for-the-badge">
  <img alt="Monorepo" src="https://img.shields.io/badge/monorepo-pnpm-1d4ed8.svg?style=for-the-badge">
</p>

ForgeFlow 是一个本地优先的多 Agent 软件交付编排器。

它可以把已有代码仓库或一个新项目设想，转成一条可控的工程执行链：先做项目识别与记忆构建，再进入带约束、可审计、可回滚的多阶段 Agent 执行流程。

## 这个项目解决什么问题

真实项目不是从空白提示词开始的，而是从这些东西开始：

- 一个已经存在的仓库
- 若干份 TODO 和计划文档
- 分散在 Markdown 里的历史信息
- 可能很危险的命令和写入路径
- 不完整、甚至互相冲突的上下文

ForgeFlow 的目标是把这些零散输入收束成一套工程化流程：

- 项目接入与识别
- 项目记忆构建
- 多阶段 Agent 执行
- 运行级审计记录
- 隔离工作区执行
- 安全写回与回滚

## 可视化概览

<p align="center">
  <img src="./docs/assets/forgeflow-architecture.svg" alt="ForgeFlow 架构概览" width="100%" />
</p>

<p align="center">
  <img src="./docs/assets/forgeflow-execution.svg" alt="ForgeFlow 执行流程" width="100%" />
</p>

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 老项目导入 | 导入已有仓库，识别 TODO 源、主文档、脚本和目录结构 |
| 新项目草案 | 从项目设想生成初始文档和待办清单，再由你确认后创建 |
| 持久化 intake job | 长耗时识别和头脑风暴任务可追踪、可取消、可恢复查看 |
| 项目记忆 | 主参考文档、计划、未来功能、TODO 等上下文可编辑并注入后续执行 |
| 多阶段编排 | `planner -> coder -> reviewer -> tester -> debugger` |
| 安全执行 | 路径边界、危险命令拦截、隔离工作区、差异记录、回滚支持 |
| 审计能力 | 每次 run 保留 prompt、原始输出、stdout、stderr、git diff 与变更文件 |

## Monorepo 结构

```text
apps/
  api/     Fastify + Prisma 后端
  web/     Next.js 控制台
packages/
  core/                编排状态机与任务逻辑
  db/                  Prisma 辅助
  opencode-adapter/    本地 OpenCode CLI / HTTP executor 适配层
  prompts/             默认 Agent prompts
  task-parser/         Markdown 任务解析
  task-writeback/      checkbox 回写
docs/
  assets/
  troubleshooting.md
  known-issues.md
  release-readiness-checklist.md
  release-checklist.md
tests/
  单元测试与回归测试
```

## 当前状态

ForgeFlow 目前已经可以作为本地 Alpha 工具持续使用，但还不属于“面向大众稳定发布”的阶段。

已经具备：

- 老项目 / 新项目 intake
- 持久化 intake job 与实时日志
- PTY 驱动的本地 CLI 健康检查
- 可编辑项目记忆
- 带 reviewer / debugger 的多阶段执行图
- 重试、恢复、fallback model 和 run 审计
- 隔离工作区执行
- git diff 捕获与回滚

仍然属于 Alpha 的部分：

- 部分 OpenCode 模型和 agent 组合在结构化输出上仍有波动
- 深层页面的 UI 一致性还在继续收口
- 面向非开发者的桌面发布形态还没完成
- 更大范围的端到端回归覆盖还在补

## 快速开始

### 依赖

- Node.js 22+
- pnpm 10+
- Prisma + SQLite
- 如果要走本地执行，需要本机安装 OpenCode CLI

可选：

- 如果你希望走远端执行器，可以配置 `OPENCODE_BASE_URL`

### 安装

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:push
pnpm dev
```

默认地址：

- Web UI：`http://localhost:3000`
- API：`http://127.0.0.1:4010`

## 环境变量

参考 [`.env.example`](./.env.example)。

关键项包括：

- `DATABASE_URL`
- `PORT`
- `NEXT_PUBLIC_API_BASE_URL`
- `OPENCODE_BASE_URL`
- `OPENCODE_API_KEY`
- `OPENCODE_CLI_PATH`
- `OPENCODE_CLI_TIMEOUT_MS`
- `OPENCODE_INTAKE_TIMEOUT_MS`
- `OPENCODE_HEALTHCHECK_TIMEOUT_MS`

## 常见使用流程

### 导入老项目

1. 打开 ForgeFlow。
2. 如果是首次启动，先看启动诊断。
3. 选择 `Existing Project`。
4. 输入仓库根目录。
5. 选择 intake 策略：
   - `Model Refine`
   - `Heuristic Only`
6. 需要时先做模型健康检查。
7. 点击 `Inspect / Refine Import`。
8. 审核解析出的工作目录、TODO 源、主参考文档、脚本和 workspace 布局。
9. 确认导入。
10. 进入项目详情页运行任务。

### 创建新项目

1. 选择 `New Project`。
2. 输入目标目录。
3. 填写项目名和项目设想。
4. 如有需要，补充后续约束。
5. 点击 `Generate / Refine Draft`。
6. 检查系统生成的基础文档和配置。
7. 确认创建项目。

通常会生成：

- `README.md`
- `docs/project-brief.md`
- `docs/implementation-plan.md`
- `TODO.md`

## 执行模型

ForgeFlow 会把任务送入一条分阶段执行图：

```text
planning -> coding -> reviewing -> testing
                      |             |
                      +--> debugging +
```

这条执行链已经具备：

- 状态机驱动流转
- 分阶段重试与退避
- 从 planner / coder / tester 显式恢复
- reviewer 和 debugger 在真实流程中生效
- fallback model 执行
- 先在隔离工作区执行，再同步回项目
- 危险命令拦截
- 基于允许/禁止路径的写入校验
- git diff 与回滚产物记录

## 本地 CLI 与 HTTP Executor

ForgeFlow 支持两种执行模式。

### 本地 OpenCode CLI

当 `OPENCODE_BASE_URL` 为空时，ForgeFlow 会直接调用本机安装的 OpenCode CLI。

这最适合本地调试和快速试验。

### HTTP Executor

当设置了 `OPENCODE_BASE_URL` 时，ForgeFlow 会请求一个兼容 OpenCode 的 HTTP 执行服务。

适合：

- 集中管理模型凭证
- 远端执行
- 需要比本地 CLI 更稳定的执行封装

## 常用命令

```powershell
pnpm dev
pnpm build
pnpm exec turbo run typecheck
pnpm test:unit
pnpm db:push
pnpm db:generate
```

## 测试

当前仓库已经覆盖了这些重点测试：

- intake 启发式识别
- intake job 状态迁移
- 项目记忆
- 执行边界
- fallback model
- 任务回写
- 状态机行为

运行：

```powershell
pnpm test:unit
```

## 文档

- [故障排查](./docs/troubleshooting.md)
- [已知问题](./docs/known-issues.md)
- [发布准备清单](./docs/release-readiness-checklist.md)
- [发布执行清单](./docs/release-checklist.md)
- [路线图 TODO](./TODO.md)

## 贡献

ForgeFlow 现在定位为公开的本地开发者工具。贡献时优先考虑：

- 本地安全
- 可审计性
- 明确边界
- 可预期的 fallback

- [贡献指南](./CONTRIBUTING.md)
- [行为准则](./CODE_OF_CONDUCT.md)
- [许可证](./LICENSE)

## License

MIT
