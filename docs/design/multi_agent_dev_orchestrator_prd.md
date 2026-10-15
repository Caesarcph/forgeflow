# 多 Agent AI 开发编排平台 PRD（可直接交给 LLM 实现）

## 1. 项目名称

暂定名称：**ForgeFlow**

一句话定义：

> 一个带前端界面的多 Agent AI 开发编排平台。用户可以指定本地项目路径、项目介绍文件、已完成进度文件、待完成进度文件，让多个职责独立的 AI Agent 按既定流程自动推进项目开发：规划、编码、审查、测试、调试、文档整理，并把结果同步回项目进度文件与前端控制台。

---

## 2. 项目背景

现有 AI Coding 工具大多偏单 Agent、单会话、单任务执行。它们擅长回答问题或完成某段代码，但不擅长围绕一个中大型项目，长期、结构化、可追踪地推进开发计划。

本项目希望构建一个“AI 开发项目执行系统”，而不只是一个聊天工具。它需要做到：

1. 能读取项目已有上下文，而不是每次从零开始。
2. 能识别“已完成 / 未完成”的开发进度。
3. 能把待办任务拆解成可执行步骤。
4. 能让多个独立角色的 Agent 协作，而不是一个 Agent 包办所有事情。
5. 能在每一步留下计划、代码 diff、测试结果、审查意见和失败原因。
6. 能按任务状态机自动推进，而不是依赖人工不断盯着每一步。
7. 能让不同角色绑定不同模型，以便控制成本和质量。
8. 能通过前端清晰展示项目进度、当前任务、Agent 日志、测试结果和产出物。

---

## 3. 产品目标

### 3.1 总目标

构建一个“面向项目交付”的多 Agent 开发编排平台，使用户能够把一个项目清单交给系统后，系统按任务顺序自动推进开发，并在可验证完成时自动打勾，在不适合自动确认的任务上停下来等待人工确认。

### 3.2 关键目标

- 支持本地项目路径接入。
- 支持读取项目介绍文档、已完成进度文档、待完成进度文档。
- 支持将 Markdown 清单解析成结构化任务。
- 支持多个 Agent 的职责分离与独立上下文。
- 支持每个 Agent 绑定不同模型。
- 支持任务状态机和自动流转。
- 支持测试 / 构建 / lint / 启动命令执行。
- 支持代码审查与失败回退。
- 支持自动回写待完成进度文件中的 checkbox。
- 支持前端监控与人工干预。

### 3.3 非目标

以下内容不是第一版必须实现的：

- 多人协作权限体系
- 云端多租户 SaaS
- 真正的生产环境自动发布
- 自动付款、计费、配额结算
- 完整的企业级审计合规系统
- 跨 IDE 深度插件能力

---

## 4. 目标用户

### 4.1 主要用户

- 独立开发者
- 小型技术团队负责人
- 使用 AI 辅助编程的高级工程师
- 想把长期项目交给 AI 半自动推进的人

### 4.2 典型场景

1. 用户有一个已有代码仓库，希望 AI 继续按 TODO 清单开发。
2. 用户有项目设计文档和开发计划，希望多个 Agent 分工合作推进。
3. 用户希望 AI 自动跑测试、修 bug、继续下一个功能。
4. 用户希望不同 Agent 使用不同模型，控制成本与质量。
5. 用户希望保留完整的执行记录，而不是只看聊天记录。

---

## 5. 产品形态

本项目是一个本地优先的全栈应用，包含：

1. **Web 前端控制台**
2. **后端 API + 调度器**
3. **任务状态机与数据库**
4. **OpenCode 执行引擎适配层**
5. **Git / Worktree / 命令执行管理层**

推荐部署方式：

- 本地运行
- 单用户优先
- 项目直接挂载本地路径
- 使用 OpenCode server 或兼容的执行引擎作为底层 Agent 运行环境

---

## 6. 核心概念

### 6.1 Project（项目）

一个项目对应一个本地代码目录和一组配置，包括：

- 项目名称
- 项目根路径
- 项目介绍文件路径
- 已完成进度文件路径
- 待完成进度文件路径
- 测试命令
- 构建命令
- 启动命令
- 忽略路径
- 可修改路径
- Git 默认分支
- Agent / 模型策略

### 6.2 Task（任务）

从待完成进度文件中解析出的结构化待办项。每个任务至少包含：

- 任务编号
- 标题
- 所属阶段
- 原始描述
- 依赖任务
- 状态
- 是否允许自动确认完成
- 验收标准
- 相关文件
- 最近执行摘要

### 6.3 Agent（角色代理）

系统中的独立职责执行者。每个 Agent 都有：

- 角色名称
- 职责定义
- 绑定模型
- 独立上下文
- 独立系统提示词
- 允许工具集
- 输出格式要求

### 6.4 Handoff（交接单）

Agent 之间不共享完整聊天历史，只共享结构化交接单。交接单用于保持职责独立，避免上下文污染。

### 6.5 Run（执行记录）

每次 Agent 对任务执行一次动作，都应生成 Run 记录，记录：

- 发起角色
- 输入内容
- 输出内容
- 代码 diff
- 命令执行结果
- 测试结果
- 审查意见
- token / cost 统计
- 开始和结束时间

### 6.6 Artifact（产物）

每次执行产生的文件性结果，例如：

- 计划书
- 代码 patch
- 审查报告
- 测试报告
- 调试总结
- 发布说明

---

## 7. Agent 角色设计

第一版建议包含以下角色：

### 7.1 Planner（计划者）

职责：

- 阅读项目介绍、进度文件、待办清单
- 选择下一个可执行任务
- 输出任务细化方案
- 生成验收标准
- 列出涉及文件与风险点
- 输出给 Coder 的结构化 handoff

要求：

- 非常细致
- 偏分析型
- 默认不直接改代码

### 7.2 Coder（编码者）

职责：

- 根据 Planner 的 handoff 写代码
- 修改必要文件
- 补充或更新测试
- 执行最小必要命令
- 生成实现说明

要求：

- 严谨
- 不擅自扩大改动范围
- 不自行宣布任务完成

### 7.3 Reviewer（审查者）

职责：

- 审查 Coder 的 diff
- 对照任务目标和验收标准检查
- 标记风险、回归风险、风格问题、架构问题
- 输出 pass / changes requested / blocked

要求：

- 保守
- 挑错能力强
- 默认不直接改代码

### 7.4 Tester（测试者）

职责：

- 执行测试、构建、lint、启动检查
- 可执行 smoke test
- 校验任务是否达到验收标准
- 输出失败报告

要求：

- 只负责验证
- 不负责改代码

### 7.5 Debugger（调试者）

职责：

- 读取测试失败报告和审查问题
- 做最小必要修复
- 解释根因
- 修复后重新提交给 Tester

要求：

- 专注排错
- 避免大规模重构

### 7.6 Docs/Release（文档与发布代理，可选）

职责：

- 生成更新说明
- 补充操作手册
- 生成上线说明 / 回滚说明
- 完成任务后同步文档

---

## 8. 多模型策略

系统必须支持：

- 每个 Agent 绑定不同模型
- 同一 Agent 在不同任务类型上可覆盖模型
- 支持模型 fallback
- 支持成本上限
- 支持用户从前端切换模型

推荐策略：

- Planner：强推理大模型
- Coder：高性价比代码模型
- Reviewer：强推理 / 强审查模型
- Tester：较快较便宜模型或无模型，仅命令执行
- Debugger：中高能力代码模型
- Docs/Release：中等模型

前端需允许用户为每个 Agent 配置：

- provider
- model
- temperature
- max tokens
- fallback model
- 是否启用该 Agent

---

## 9. 任务类型分类

系统需要支持不同类型任务，因为不是所有任务都适合自动完成。

### 9.1 Auto 任务

可以由系统自动推进并自动打勾：

- 明确功能实现
- 页面接入
- 接口调用
- UI 补齐
- 测试补充
- 基础监控接入
- 文档初稿

### 9.2 Human Gate 任务

必须经过人工确认后才可完成：

- 安全审计结论
- 生产发布
- 数值平衡结论
- 架构大改
- 成本控制决策
- 灰度策略最终确认
- 发布复盘结论

任务模型中必须有字段：

- `task_type: auto | human_gate`
- `auto_approvable: boolean`

---

## 10. 任务状态机

建议状态：

- `queued`
- `planning`
- `ready_for_coding`
- `coding`
- `reviewing`
- `testing`
- `debugging`
- `waiting_human`
- `blocked`
- `done`
- `failed`
- `skipped`

状态流建议：

1. `queued` → `planning`
2. `planning` → `ready_for_coding`
3. `ready_for_coding` → `coding`
4. `coding` → `reviewing`
5. `reviewing`：
   - pass → `testing`
   - changes requested → `debugging`
   - blocked → `waiting_human`
6. `testing`：
   - pass 且 auto → `done`
   - pass 且 human_gate → `waiting_human`
   - fail → `debugging`
7. `debugging` → `testing`
8. `waiting_human`：
   - approve → `done`
   - reject → `planning` 或 `coding`

---

## 11. 用户核心流程

### 11.1 创建项目

用户在前端填写：

- 项目名称
- 本地项目路径
- 项目介绍文件
- 已完成进度文件
- 待完成进度文件
- 测试 / 构建 / 启动命令
- Agent 模型配置

系统执行：

- 校验路径存在
- 解析 Markdown 文件
- 识别 checkbox 列表
- 建立项目记录
- 生成任务记录

### 11.2 启动自动推进

用户点击“开始执行”。

系统执行：

- 找到下一个可执行任务
- 调用 Planner 生成 handoff
- 调用 Coder 开始实现
- 产出 diff
- Reviewer 审查
- Tester 执行测试
- Debugger 修 bug
- 满足条件时自动打勾并回写进度文件
- 继续下一个任务

### 11.3 人工介入

当发生以下情况时，系统暂停并提示用户：

- 任务被标记为 human_gate
- Reviewer 判断 blocked
- 测试持续失败超过阈值
- 修改范围超出允许路径
- 成本超预算
- 发现敏感操作

### 11.4 查看执行过程

用户可以在前端查看：

- 当前任务
- 当前状态
- 当前角色
- 所有历史 run
- diff
- 日志
- 测试结果
- 审查意见
- 失败原因
- 文件回写情况

---

## 12. 功能模块设计

### 12.1 项目管理模块

功能：

- 创建项目
- 编辑项目配置
- 读取本地路径
- 删除项目
- 重新解析项目文件
- 查看项目概况

字段：

- name
- root_path
- intro_file_path
- done_progress_file_path
- todo_progress_file_path
- build_command
- test_command
- lint_command
- start_command
- allowed_paths
- blocked_paths
- default_branch
- auto_run_enabled

### 12.2 文档解析模块

功能：

- 解析 Markdown 清单
- 提取阶段 / 子阶段 / checkbox 项
- 识别任务编号
- 识别完成状态
- 生成结构化任务
- 支持重新同步

要求：

- 能处理 `- [ ]` 和 `- [x]`
- 能保留原始章节层级
- 能将任务与源文件行号关联
- 支持任务回写

### 12.3 任务编排模块

功能：

- 任务入队
- 依赖检测
- 任务选择
- 自动推进
- 人工闸门
- 重试控制
- 失败上限控制

要求：

- 支持串行执行
- 预留并行执行能力
- 支持只执行某个阶段
- 支持只执行指定任务编号

### 12.4 Agent 配置模块

功能：

- 配置角色是否启用
- 绑定模型
- 设置系统提示词模板
- 设置 temperature / max tokens
- 设置是否允许文件写入
- 设置是否允许运行命令

### 12.5 执行引擎适配模块

功能：

- 对接 OpenCode server / SDK
- 创建 session
- 调用不同 agent
- 指定 model
- 获取消息流
- 收集 tool 调用结果
- 保存完整 run

要求：

- 每个角色独立 session
- 同一任务可 fork 新 session
- 支持失败恢复
- 支持中止执行

### 12.6 Git / 工作区模块

功能：

- 检查仓库状态
- 创建分支或 worktree
- 限制改动范围
- 读取 diff
- 回滚失败任务
- 提交可选 commit

要求：

- 每个任务独立工作上下文
- 默认不污染主分支
- 可在前端查看改动文件列表

### 12.7 测试与验证模块

功能：

- 执行 test / build / lint / start
- 收集退出码
- 收集 stdout / stderr
- 做 smoke test
- 生成测试报告

要求：

- 测试结果作为真值来源
- 不能只依赖 Agent 自述
- 支持超时控制
- 支持失败重试

### 12.8 审查模块

功能：

- 展示 diff
- 展示审查意见
- 标记问题级别
- 输出 pass / changes requested / blocked

### 12.9 进度回写模块

功能：

- 将已完成任务回写为 `- [x]`
- 将失败任务补充备注
- 将执行摘要写入任务注释块（可选）
- 保持原 Markdown 结构不被破坏

### 12.10 前端控制台模块

页面建议：

1. 项目列表页
2. 项目详情页
3. 任务看板页
4. 当前执行页
5. Agent Runs 页面
6. 模型配置页面
7. 日志与产物页
8. 设置页面

---

## 13. 前端页面详细设计

### 13.1 项目列表页

展示：

- 项目名称
- 根路径
- 当前状态
- 任务总数 / 完成数 / 失败数
- 最后执行时间

操作：

- 新建项目
- 编辑
- 删除
- 进入详情

### 13.2 新建项目页

表单字段：

- 项目名称
- 项目根路径
- 项目介绍文件路径
- 已完成进度文件路径
- 待完成进度文件路径
- 测试命令
- 构建命令
- lint 命令
- 启动命令
- 允许修改路径
- 禁止修改路径
- Git 默认分支

### 13.3 项目详情页

展示：

- 项目基础信息
- 文档路径
- 最近任务
- 当前执行状态
- 任务分布统计
- Agent 配置摘要

### 13.4 任务看板页

展示：

- 按阶段分组的任务列表
- 每个任务状态
- 任务类型（auto / human_gate）
- 最近执行摘要
- 是否可重试

操作：

- 仅运行此任务
- 跳过任务
- 重试任务
- 强制标记完成（管理员）

### 13.5 当前执行页

展示：

- 当前任务
- 当前执行 Agent
- 实时日志
- 当前 diff
- 当前测试输出
- 当前审查意见

### 13.6 Runs 页面

展示所有历史 Run：

- 角色
- 模型
- 开始时间
- 结束时间
- token / cost
- 输出摘要
- 附件 / 产物

### 13.7 模型配置页面

展示：

- 每个 Agent 当前模型
- provider
- fallback
- temperature
- max tokens

### 13.8 设置页面

支持：

- OpenCode server 地址
- API key / provider 配置
- 默认提示词模板
- 成本阈值
- 自动停止规则

---

## 14. 数据库设计（建议）

### 14.1 projects

- id
- name
- root_path
- intro_file_path
- done_progress_file_path
- todo_progress_file_path
- build_command
- test_command
- lint_command
- start_command
- allowed_paths_json
- blocked_paths_json
- default_branch
- created_at
- updated_at

### 14.2 tasks

- id
- project_id
- task_code
- title
- section
- subsection
- raw_text
- source_file_path
- source_line_start
- source_line_end
- status
- task_type
- auto_approvable
- acceptance_criteria_json
- dependencies_json
- relevant_files_json
- latest_summary
- created_at
- updated_at

### 14.3 agent_configs

- id
- project_id
- role_name
- enabled
- provider
- model
- fallback_model
- temperature
- max_tokens
- can_write_files
- can_run_commands
- system_prompt_template
- created_at
- updated_at

### 14.4 task_runs

- id
- project_id
- task_id
- role_name
- model
- status
- input_summary
- output_summary
- full_output_path
- diff_path
- started_at
- ended_at
- token_usage_json
- cost_json

### 14.5 handoffs

- id
- task_id
- from_role
- to_role
- payload_json
- created_at

### 14.6 command_runs

- id
- task_run_id
- command
- cwd
- exit_code
- stdout_path
- stderr_path
- duration_ms
- created_at

### 14.7 artifacts

- id
- task_run_id
- artifact_type
- title
- file_path
- metadata_json
- created_at

### 14.8 approvals

- id
- task_id
- approval_type
- requested_reason
- status
- decided_by
- decided_at

---

## 15. 后端 API 设计（建议）

### 15.1 项目接口

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/reparse`

### 15.2 任务接口

- `GET /api/projects/:id/tasks`
- `GET /api/tasks/:taskId`
- `POST /api/tasks/:taskId/run`
- `POST /api/tasks/:taskId/retry`
- `POST /api/tasks/:taskId/skip`
- `POST /api/tasks/:taskId/approve`
- `POST /api/tasks/:taskId/reject`

### 15.3 执行接口

- `POST /api/projects/:id/start`
- `POST /api/projects/:id/stop`
- `GET /api/projects/:id/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/logs`
- `GET /api/runs/:runId/diff`

### 15.4 Agent 配置接口

- `GET /api/projects/:id/agents`
- `PATCH /api/projects/:id/agents/:role`

### 15.5 文件回写接口

- `POST /api/tasks/:taskId/writeback`
- `POST /api/projects/:id/writeback-all`

---

## 16. Agent 输出格式规范

所有 Agent 都必须尽量输出结构化 JSON + 简短文本摘要。

### 16.1 Planner 输出

```json
{
  "task_id": "WEB-B3-01",
  "goal": "补齐前端异常监控与埋点",
  "acceptance_criteria": [
    "前端全局异常捕获已接入",
    "页面级关键事件埋点已实现",
    "有最小文档说明",
    "测试通过"
  ],
  "steps": [
    "定位前端入口文件",
    "新增监控初始化模块",
    "接入页面级事件",
    "补测试与文档"
  ],
  "relevant_files": [
    "song-web/src/main.tsx",
    "song-web/src/lib/monitoring.ts"
  ],
  "risks": [
    "不要把密钥写进前端",
    "不要影响现有构建"
  ]
}
```

### 16.2 Reviewer 输出

```json
{
  "result": "changes_requested",
  "findings": [
    {
      "severity": "high",
      "file": "src/app.tsx",
      "issue": "缺少失败兜底逻辑"
    }
  ],
  "summary": "功能基本完成，但异常处理不完整。"
}
```

### 16.3 Tester 输出

```json
{
  "result": "fail",
  "commands": [
    {
      "command": "pnpm test",
      "exit_code": 1
    }
  ],
  "failures": [
    "MonitoringProvider test failed"
  ],
  "summary": "单元测试未通过。"
}
```

---

## 17. 系统提示词要求

每个 Agent 都应有独立系统提示词，必须强调：

- 只做本角色职责内的事情
- 不擅自宣布任务完成
- 不擅自修改不相关文件
- 输出结构化结果
- 遇到不确定时明确标注

### 17.1 Planner 提示词要点

- 关注任务拆解和验收标准
- 尽量细致
- 不直接改代码
- 不跳过依赖

### 17.2 Coder 提示词要点

- 只根据 handoff 改代码
- 优先最小改动
- 补测试
- 不自判完成

### 17.3 Reviewer 提示词要点

- 严格对照验收标准
- 关注风险和回归
- 尽量明确指出文件与问题

### 17.4 Tester 提示词要点

- 只验证，不写代码
- 命令退出码为真值
- 明确列出失败项

### 17.5 Debugger 提示词要点

- 只处理失败报告对应问题
- 做最小修复
- 解释根因

---

## 18. 自动打勾与进度文件回写规则

系统不能仅凭 Agent 说“完成了”就打勾。

必须满足以下条件之一：

### Auto 任务完成条件

- Reviewer 结果为 pass
- Tester 结果为 pass
- 必要命令退出码全部成功
- 没有超出允许修改路径
- 没有触发人工闸门

完成后：

- 将待完成进度文件中的 `- [ ]` 改为 `- [x]`
- 写入最近执行摘要（可选）
- 更新数据库中的任务状态为 `done`

### Human Gate 任务完成条件

- 系统跑完 review / test
- 状态进入 `waiting_human`
- 用户点击确认
- 才允许回写 `- [x]`

---

## 19. 安全与约束

第一版至少实现以下保护：

- 默认限制可写路径
- 默认不允许修改 `.env`、密钥文件、部署密钥文件
- 默认不允许直接推主分支
- 默认不允许执行危险命令
- 超过最大重试次数自动暂停
- 连续失败自动人工介入
- 成本超阈值自动暂停

建议危险命令黑名单：

- `rm -rf /`
- 任意格式化磁盘命令
- 任意会删除仓库历史的高风险 Git 命令
- 任意上传密钥到远端的命令

---

## 20. 日志、监控与可追溯性

系统必须保留：

- 每次 run 的输入与输出摘要
- 命令执行日志
- diff
- 测试结果
- 审查意见
- 失败原因
- handoff 记录
- 模型与 token 成本

前端要能按任务查看完整链路：

Planner → Coder → Reviewer → Tester → Debugger → Tester → Done

---

## 21. 技术选型建议

### 前端

- Next.js
- React
- Tailwind CSS
- shadcn/ui
- Zustand 或 TanStack Query

### 后端

- Node.js
- TypeScript
- Fastify 或 NestJS
- Prisma
- PostgreSQL
- Redis + BullMQ

### 执行引擎

- OpenCode server / SDK

### 代码与文件层

- simple-git
- Node child_process / execa
- chokidar

### 校验

- Zod

### 实时通信

- WebSocket 或 Server-Sent Events

---

## 22. 推荐目录结构

```text
forgeflow/
  apps/
    web/
    api/
  packages/
    core/
    db/
    ui/
    prompts/
    opencode-adapter/
    task-parser/
    task-writeback/
  prisma/
  scripts/
  docs/
```

### `apps/web`

负责前端界面：

- 项目管理
- 任务看板
- 实时执行
- 模型配置
- 日志查看

### `apps/api`

负责：

- REST API
- WebSocket
- 任务调度
- 调用 OpenCode
- 执行命令
- 文件回写

### `packages/core`

负责：

- 状态机
- 任务流转逻辑
- 自动推进策略
- 人工闸门逻辑

### `packages/prompts`

负责：

- Agent 系统提示词
- Handoff 模板
- 输出 schema

### `packages/task-parser`

负责：

- Markdown 清单解析
- 任务树构建
- 依赖提取

### `packages/task-writeback`

负责：

- checkbox 回写
- 行号定位
- 原文结构保护

---

## 23. 版本规划

## Phase 1：最小可用版本

目标：

做出一个能在本地接入项目、解析清单、跑单任务闭环的版本。

必须完成：

- 项目创建
- Markdown 清单解析
- 任务列表展示
- Planner / Coder / Tester 三角色
- OpenCode 接入
- 基础命令执行
- 任务状态流转
- 自动回写 checkbox
- 前端日志展示

## Phase 2：质量与协作增强

必须完成：

- Reviewer
- Debugger
- 模型分角色配置
- 人工审批闸门
- Git worktree
- 成本统计
- 失败重试策略
- 更完整的任务筛选与阶段执行

## Phase 3：高级能力

可选完成：

- Docs/Release Agent
- MCP / custom tools
- Prompt 模板管理
- 多项目并行
- 更完整的回滚与恢复
- Docker 沙箱
- 指标看板

---

## 24. 验收标准

第一版完成的标志：

1. 用户可以新建一个项目并配置路径。
2. 系统可以解析待完成进度文件中的 checkbox 任务。
3. 系统可以选择某个未完成任务开始执行。
4. Planner 能生成结构化计划。
5. Coder 能在项目里完成代码修改。
6. Tester 能执行测试命令并拿到退出码。
7. 通过测试后，系统能自动把该任务从 `- [ ]` 改成 `- [x]`。
8. 前端可以看到任务流转、日志、diff 和测试结果。
9. 用户可以停止、重试、人工确认任务。
10. 每个 Agent 可以配置不同模型。

---

## 25. 给实现型 LLM 的开发要求

请按以下原则生成代码：

1. 先搭建完整项目结构，再逐模块实现。
2. 优先保证本地可运行，不追求一次做满全部高级功能。
3. 所有核心逻辑都要有清晰类型定义。
4. 所有 Agent 输出尽量通过 schema 校验。
5. 所有任务状态变更必须集中在状态机中，不允许散落在前端。
6. 任务完成不能依赖模型自述，必须依赖外部测试 / review 结果。
7. 所有关键模块都要预留扩展点。
8. 尽量做成单仓 monorepo。
9. 前后端都要可运行。
10. 优先实现 Phase 1，再逐步扩展。

---

## 26. 给 LLM 的首轮开发任务建议

建议先让 LLM 完成以下内容：

### 第一轮

- 初始化 monorepo
- 搭建 `apps/web` 与 `apps/api`
- 配置 Prisma + PostgreSQL
- 设计基础表结构
- 做项目创建与任务解析 API
- 做项目列表页与项目详情页

### 第二轮

- 实现 Markdown 清单解析器
- 实现任务列表页
- 实现项目配置表单
- 实现 Agent 配置表单

### 第三轮

- 接入 OpenCode server 客户端
- 实现 Planner / Coder / Tester 的最小调用链
- 实现任务状态机
- 实现命令执行和日志保存

### 第四轮

- 实现 checkbox 回写
- 实现实时执行页
- 实现 diff 和测试日志展示
- 实现停止 / 重试 / 人工确认

### 第五轮

- 增加 Reviewer 和 Debugger
- 增加任务依赖
- 增加 auto / human_gate 任务区分
- 增加失败自动暂停规则

---

## 27. 最后一句产品定义

这不是一个普通的 AI 聊天工具，也不是一个单 Agent 代码助手。

它是一个：

> **面向真实项目推进的多 Agent AI 开发编排系统**。

它的核心价值不是“回答得多聪明”，而是：

- 能长期推进项目
- 能分工协作
- 能自动验证
- 能可追溯
- 能在该停下的时候停下
- 能把未完成清单一步步变成已完成清单

