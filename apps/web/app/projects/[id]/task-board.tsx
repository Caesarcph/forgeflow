"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ProjectTask } from "../../../lib/api";
import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { useLanguage } from "../../language-provider";

const SAFE_TASK_PATTERNS = [
  /document|文档|readme|changelog|md$/i,
  /ui\s*(text|copy|label|string|message)|文案|文本|标签|提示/i,
  /i18n|internationalization|localization|翻译|国际化|本地化/i,
  /comment|注释|注释$/i,
  /typo|错别字|拼写|错字/i,
  /help\s*(text|tip|message)|帮助|提示文本/i,
  /placeholder|占位|placeholder/i,
  /button\s*(text|label)|按钮文本/i,
  /error\s*message|error\s*text|错误提示|错误信息/i,
  /success\s*message|成功提示/i,
  /tooltip|工具提示|悬停提示/i,
  /accessibility|a11y|无障碍/i,
  /aria-|aria:/i,
  /license|licensing|许可|许可证/i,
  /contributing|贡献指南/i,
  /update\s*(changelog|release\s*note)|更新日志|发布说明/i,
];

const HIGH_RISK_PATTERNS = [
  /api\s*(key|token|secret)|密码|密钥|token|secret/i,
  /database|schema|migration|数据库|表结构/i,
  /auth|authentication|authorization|认证|鉴权/i,
  /security|安全漏洞|漏洞修复/i,
  /payment|支付|billing|计费/i,
  /delete|删除|drop|truncate/i,
  /deploy|deployment|部署/i,
  /config|configuration|配置文件/i,
  /env|environment|环境变量/i,
];

function isSafeTask(rawText: string): boolean {
  const text = rawText.toLowerCase();

  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(text)) {
      return false;
    }
  }

  for (const pattern of SAFE_TASK_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

const API_BASE_URL = CLIENT_API_BASE_URL;
type RecoveryStage = "planning" | "coding" | "testing";
type TaskStatusFilter = "all" | "active" | "waiting_human" | "failed" | "done" | "queued";
type TaskTypeFilter = "all" | "auto" | "human_gate";

function isActiveStatus(status: string) {
  return ["planning", "ready_for_coding", "coding", "reviewing", "testing", "debugging", "blocked"].includes(status);
}

function buildTaskIndex(tasks: ProjectTask[]) {
  return new Map(tasks.map((task) => [task.taskCode, task]));
}

function buildDependents(tasks: ProjectTask[]) {
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.taskCode]);
    }
  }

  return dependents;
}

function getText(language: "en" | "zh") {
  if (language === "zh") {
    return {
      idle: "可以在这里运行任务、审批人工闸门，或强制回写 Markdown。",
      running: "正在把任务加入后台执行...",
      runQueued:
        "任务已加入后台队列。若当前筛选不是“全部状态”，状态变化后它可能暂时从列表中消失。请查看实时活动。",
      runFailed: "运行任务失败",
      writingBack: "正在回写 Markdown 勾选状态...",
      writebackDone: "任务已回写并标记完成。",
      writebackFailed: "回写任务失败",
      approving: "正在批准任务并写回进度...",
      approved: "任务已批准。",
      approveFailed: "批准任务失败",
      rejecting: "正在退回到规划阶段...",
      rejected: "任务已退回规划阶段。",
      rejectFailed: "退回任务失败",
      restartFrom: (stage: RecoveryStage) => `正在从 ${stage} 恢复执行路径...`,
      recoveredFrom: (stage: RecoveryStage) => `已从 ${stage} 执行恢复路径。`,
      recoverFailed: (stage: RecoveryStage) => `从 ${stage} 恢复失败`,
      statusFilter: "状态筛选",
      allStatuses: "全部状态",
      activeStages: "进行中的阶段",
      queued: "排队中",
      waitingHuman: "等待人工",
      failed: "失败",
      done: "已完成",
      taskType: "任务类型",
      allTaskTypes: "全部任务类型",
      auto: "自动",
      humanGate: "人工闸门",
      search: "搜索",
      searchPlaceholder: "任务编号、标题、依赖、文件",
      visible: "可见",
      withDeps: "带依赖",
      depsSatisfied: "依赖已满足",
      waitingOnDeps: "等待依赖",
      dependencyMap: "依赖关系图",
      dependsOn: "依赖",
      missing: "缺失",
      unlocks: "解锁",
      unsectioned: "未分组",
      dependencies: "依赖",
      acceptanceCriteria: "验收标准",
      relevantFiles: "相关文件",
      processing: "处理中...",
      retryTask: "重试任务",
      runTask: "运行任务",
      approveWriteback: "批准并回写",
      returnPlanning: "退回规划阶段",
      restartPlanner: "从 Planner 重来",
      restartCoder: "从 Coder 重来",
      retryTester: "仅重试 Tester",
      forceWriteback: "强制回写",
  noTasks: "没有任务符合当前筛选条件。",
  safeTask: "安全任务",
  safeTaskHint: "可由安全自动驾驶处理",
  };
  }

  return {
  idle: "Run tasks, approve human gates, or force Markdown writeback from here.",
  running: "Queueing the task in the background...",
  runQueued:
    "Task queued in the background. If the current filter is not All statuses, it may disappear from this view once its status changes. Check Live Activity.",
  runFailed: "Failed to run task",
  writingBack: "Writing back the Markdown checkbox...",
  writebackDone: "Task written back and marked complete.",
  writebackFailed: "Failed to write back task",
  approving: "Approving task and writing progress...",
  approved: "Task approved.",
  approveFailed: "Failed to approve task",
  rejecting: "Returning task to planning...",
  rejected: "Task returned to planning.",
  rejectFailed: "Failed to reject task",
  restartFrom: (stage: RecoveryStage) => `Restarting from ${stage}...`,
  recoveredFrom: (stage: RecoveryStage) => `Recovery path executed from ${stage}.`,
  recoverFailed: (stage: RecoveryStage) => `Failed to recover from ${stage}`,
  statusFilter: "Status Filter",
  allStatuses: "All statuses",
  activeStages: "Active stages",
  queued: "Queued",
  waitingHuman: "Waiting human",
  failed: "Failed",
  done: "Done",
  taskType: "Task Type",
  allTaskTypes: "All task types",
  auto: "Auto",
  humanGate: "Human gate",
  search: "Search",
  searchPlaceholder: "Task code, title, dependency, file",
  visible: "visible",
  withDeps: "with deps",
  depsSatisfied: "deps satisfied",
  waitingOnDeps: "waiting on deps",
  dependencyMap: "Dependency Map",
  dependsOn: "depends on",
  missing: "missing",
  unlocks: "unlocks",
  unsectioned: "Unsectioned",
  dependencies: "Dependencies",
  acceptanceCriteria: "Acceptance Criteria",
  relevantFiles: "Relevant Files",
  processing: "Processing...",
  retryTask: "Retry Task",
  runTask: "Run Task",
  approveWriteback: "Approve And Write Back",
  returnPlanning: "Return To Planning",
  restartPlanner: "Restart From Planner",
  restartCoder: "Restart From Coder",
  retryTester: "Retry Tester Only",
  forceWriteback: "Force Writeback",
  noTasks: "No tasks matched the current filters.",
  safeTask: "Safe task",
  safeTaskHint: "Can be processed by safe autopilot",
  };
}

export function TaskBoard({ tasks }: { tasks: ProjectTask[] }) {
  const { language } = useLanguage();
  const router = useRouter();
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const text = getText(language);
  const [message, setMessage] = useState(text.idle);
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const taskIndex = useMemo(() => buildTaskIndex(tasks), [tasks]);
  const dependents = useMemo(() => buildDependents(tasks), [tasks]);
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (statusFilter === "active" && !isActiveStatus(task.status)) {
        return false;
      }

      if (statusFilter !== "all" && statusFilter !== "active" && task.status !== statusFilter) {
        return false;
      }

      if (typeFilter !== "all" && task.taskType !== typeFilter) {
        return false;
      }

      if (!deferredQuery) {
        return true;
      }

      const haystack = [
        task.taskCode,
        task.title,
        task.section ?? "",
        task.subsection ?? "",
        task.status,
        ...(task.dependencies ?? []),
        ...(task.relevantFiles ?? []),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(deferredQuery);
    });
  }, [tasks, statusFilter, typeFilter, deferredQuery]);

  const dependencySummary = useMemo(() => {
    const blockedTasks = tasks.filter((task) => task.dependencies.length > 0);
    const readyTasks = blockedTasks.filter((task) =>
      task.dependencies.every((dependency) => taskIndex.get(dependency)?.status === "done"),
    );
    const waitingTasks = blockedTasks.filter((task) =>
      task.dependencies.some((dependency) => taskIndex.get(dependency)?.status !== "done"),
    );

    return {
      blockedTasks,
      readyTasks,
      waitingTasks,
    };
  }, [tasks, taskIndex]);

  async function post(path: string, body?: Record<string, unknown>) {
    const hasBody = body !== undefined;
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      ...(hasBody
        ? {
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }
        : {}),
    });

    const payload = await parseJsonResponse<{ error?: string; message?: string; accepted?: boolean }>(response);

    if (!response.ok) {
      throw new Error(readApiError(payload, "Request failed"));
    }

    return payload;
  }

  async function handleRun(taskId: string) {
    setPendingTaskId(taskId);
    setMessage(text.running);

    try {
      const payload = await post(`/tasks/${taskId}/run`);
      setMessage(payload.message ?? text.runQueued);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.runFailed);
    } finally {
      setPendingTaskId(null);
    }
  }

  async function handleWriteback(taskId: string) {
    setPendingTaskId(taskId);
    setMessage(text.writingBack);

    try {
      await post(`/tasks/${taskId}/writeback`, {
        summary: "Marked done from ForgeFlow console",
      });
      setMessage(text.writebackDone);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.writebackFailed);
    } finally {
      setPendingTaskId(null);
    }
  }

  async function handleApprove(taskId: string) {
    setPendingTaskId(taskId);
    setMessage(text.approving);

    try {
      await post(`/tasks/${taskId}/approve`, {
        summary: "Approved from ForgeFlow console",
      });
      setMessage(text.approved);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.approveFailed);
    } finally {
      setPendingTaskId(null);
    }
  }

  async function handleReject(taskId: string) {
    setPendingTaskId(taskId);
    setMessage(text.rejecting);

    try {
      await post(`/tasks/${taskId}/reject`, {
        reason: "Rejected from ForgeFlow console",
      });
      setMessage(text.rejected);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.rejectFailed);
    } finally {
      setPendingTaskId(null);
    }
  }

  async function handleRecover(taskId: string, targetStage: RecoveryStage) {
    setPendingTaskId(taskId);
    setMessage(text.restartFrom(targetStage));

    try {
      await post(`/tasks/${taskId}/recover`, {
        targetStage,
      });
      setMessage(text.recoveredFrom(targetStage));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.recoverFailed(targetStage));
    } finally {
      setPendingTaskId(null);
    }
  }

  return (
    <div className="stack">
      <div className="feedback">{message}</div>

      <section className="task-toolbar">
        <div className="grid-3">
          <div className="field">
            <label>{text.statusFilter}</label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TaskStatusFilter)}>
              <option value="all">{text.allStatuses}</option>
              <option value="active">{text.activeStages}</option>
              <option value="queued">{text.queued}</option>
              <option value="waiting_human">{text.waitingHuman}</option>
              <option value="failed">{text.failed}</option>
              <option value="done">{text.done}</option>
            </select>
          </div>
          <div className="field">
            <label>{text.taskType}</label>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TaskTypeFilter)}>
              <option value="all">{text.allTaskTypes}</option>
              <option value="auto">{text.auto}</option>
              <option value="human_gate">{text.humanGate}</option>
            </select>
          </div>
          <div className="field">
            <label>{text.search}</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text.searchPlaceholder}
            />
          </div>
        </div>

        <div className="inline-meta">
          <span className="tag">{filteredTasks.length} {text.visible}</span>
          <span className="tag">{dependencySummary.blockedTasks.length} {text.withDeps}</span>
          <span className="tag good">{dependencySummary.readyTasks.length} {text.depsSatisfied}</span>
          <span className="tag warn">{dependencySummary.waitingTasks.length} {text.waitingOnDeps}</span>
        </div>
      </section>

      {dependencySummary.blockedTasks.length > 0 ? (
        <section className="dependency-panel">
          <h3>{text.dependencyMap}</h3>
          <div className="dependency-list">
            {dependencySummary.blockedTasks.map((task) => (
              <article key={`dep-${task.id}`} className="dependency-item">
                <strong>{task.taskCode}</strong>
                <div className="muted">{task.title}</div>
                <div className="inline-meta">
                  {task.dependencies.map((dependency) => {
                    const dependencyTask = taskIndex.get(dependency);
                    const dependencyDone = dependencyTask?.status === "done";

                    return (
                      <span key={`${task.id}-${dependency}`} className={`tag ${dependencyDone ? "good" : "warn"}`}>
                        {text.dependsOn} {dependency} {dependencyTask ? `(${dependencyTask.status})` : `(${text.missing})`}
                      </span>
                    );
                  })}
                </div>
                {dependents.get(task.taskCode)?.length ? (
                  <div className="inline-meta">
                    {dependents.get(task.taskCode)?.map((dependent) => (
                      <span key={`${task.id}-dependent-${dependent}`} className="tag">
                        {text.unlocks} {dependent}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

  <div className="task-list">
    {filteredTasks.map((task) => {
    const busy = pendingTaskId === task.id;
    const canWriteback = task.status !== "done" && task.status !== "skipped";
    const canApprove = task.status === "waiting_human";
    const canReject = task.status === "waiting_human";
    const canRecover =
    task.status === "failed" ||
    task.status === "blocked" ||
    task.status === "waiting_human" ||
    task.status === "ready_for_coding" ||
    task.status === "coding" ||
    task.status === "reviewing" ||
    task.status === "testing" ||
    task.status === "debugging";
    const runLabel = task.status === "failed" || task.status === "blocked" ? text.retryTask : text.runTask;
    const dependentCodes = dependents.get(task.taskCode) ?? [];
    const taskIsSafe = isSafeTask(task.rawText ?? task.title);

    return (
    <article key={task.id} className="task-item">
    <div>
    <strong>{task.taskCode}</strong>
    <div>{task.title}</div>
    <div className="muted">
    {task.section ?? text.unsectioned} / line {task.sourceLineStart}
    </div>
    </div>

    <div className="inline-meta">
    <span className="tag">{task.status}</span>
    <span className={`tag ${task.taskType === "human_gate" ? "warn" : "good"}`}>{task.taskType}</span>
    {taskIsSafe ? (
    <span className="tag good" title={text.safeTaskHint}>
    {text.safeTask}
    </span>
    ) : null}
    {task.latestSummary ? <span className="tag">{task.latestSummary}</span> : null}
    </div>

              {task.dependencies.length > 0 ? (
                <div className="stack compact">
                  <strong>{text.dependencies}</strong>
                  <div className="inline-meta">
                    {task.dependencies.map((dependency) => {
                      const dependencyTask = taskIndex.get(dependency);
                      const dependencyDone = dependencyTask?.status === "done";

                      return (
                        <span key={`${task.id}-${dependency}`} className={`tag ${dependencyDone ? "good" : "warn"}`}>
                          {dependency} {dependencyTask ? `(${dependencyTask.status})` : `(${text.missing})`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {dependentCodes.length > 0 ? (
                <div className="stack compact">
                  <strong>{text.unlocks}</strong>
                  <div className="inline-meta">
                    {dependentCodes.map((dependent) => (
                      <span key={`${task.id}-unlocks-${dependent}`} className="tag">
                        {dependent}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {task.acceptanceCriteria?.length ? (
                <div className="stack compact">
                  <strong>{text.acceptanceCriteria}</strong>
                  <div className="stack compact">
                    {task.acceptanceCriteria.map((criterion) => (
                      <div key={`${task.id}-criterion-${criterion}`} className="muted">
                        {criterion}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {task.relevantFiles.length > 0 ? (
                <div className="stack compact">
                  <strong>{text.relevantFiles}</strong>
                  <div className="inline-meta">
                    {task.relevantFiles.map((filePath) => (
                      <span key={`${task.id}-file-${filePath}`} className="tag">
                        {filePath}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="button-row">
                <button className="button secondary" type="button" onClick={() => handleRun(task.id)} disabled={busy}>
                  {busy ? text.processing : runLabel}
                </button>
                {canApprove ? (
                  <button className="button" type="button" onClick={() => handleApprove(task.id)} disabled={busy}>
                    {text.approveWriteback}
                  </button>
                ) : null}
                {canReject ? (
                  <button className="button ghost" type="button" onClick={() => handleReject(task.id)} disabled={busy}>
                    {text.returnPlanning}
                  </button>
                ) : null}
                {canRecover ? (
                  <>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => handleRecover(task.id, "planning")}
                      disabled={busy}
                    >
                      {text.restartPlanner}
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => handleRecover(task.id, "coding")}
                      disabled={busy}
                    >
                      {text.restartCoder}
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => handleRecover(task.id, "testing")}
                      disabled={busy}
                    >
                      {text.retryTester}
                    </button>
                  </>
                ) : null}
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => handleWriteback(task.id)}
                  disabled={busy || !canWriteback}
                >
                  {text.forceWriteback}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {filteredTasks.length === 0 ? <div className="empty">{text.noTasks}</div> : null}
    </div>
  );
}
