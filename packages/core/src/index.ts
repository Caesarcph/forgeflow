export const TASK_STATUSES = [
  "queued",
  "planning",
  "ready_for_coding",
  "coding",
  "reviewing",
  "testing",
  "debugging",
  "waiting_human",
  "blocked",
  "done",
  "failed",
  "skipped",
] as const;

export const DEFAULT_AGENT_ROLES = [
  "planner",
  "coder",
  "reviewer",
  "tester",
  "debugger",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type AgentRole = (typeof DEFAULT_AGENT_ROLES)[number];

export type TaskType = "auto" | "human_gate";
export type ProjectType = "greenfield" | "existing";
export type OrchestratorStage = "planning" | "coding" | "reviewing" | "testing" | "debugging";

export interface ParsedTask {
  taskCode: string;
  title: string;
  section: string | null;
  subsection: string | null;
  rawText: string;
  sourceFilePath: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  status: TaskStatus;
  taskType: TaskType;
  autoApprovable: boolean;
  acceptanceCriteria: string[];
  dependencies: string[];
  relevantFiles: string[];
}

export interface ProjectFormInput {
  name: string;
  projectType?: ProjectType;
  rootPath: string;
  introFilePath?: string;
  doneProgressFilePath?: string;
  futureFilePath?: string;
  implementationPlanFilePath?: string;
  designBriefFilePath?: string;
  interactionRulesFilePath?: string;
  visualReferencesFilePath?: string;
  referenceDocs?: string[];
  todoProgressFilePath: string;
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  startCommand?: string;
  allowedPaths: string[];
  blockedPaths: string[];
  defaultBranch?: string;
  autoRunEnabled?: boolean;
}

export interface PlannerPayload {
  taskId: string;
  goal: string;
  acceptanceCriteria: string[];
  steps: string[];
  relevantFiles: string[];
  risks: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  status: string;
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  updatedAt: string;
}

export interface TaskLike {
  taskCode: string;
  status: TaskStatus;
  dependencies: string[];
  sourceLineStart?: number;
}

export interface OrchestratorStageDefinition {
  stage: OrchestratorStage;
  entryStatuses: TaskStatus[];
  activeStatus: TaskStatus;
  completionStatus: TaskStatus;
  nextStage: OrchestratorStage | null;
}

export interface StageRetryPolicy {
  maxAttempts: number;
  baseBackoffMs: number;
}

export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["planning", "skipped"],
  planning: ["ready_for_coding", "blocked", "failed"],
  ready_for_coding: ["coding", "blocked", "failed"],
  coding: ["reviewing", "testing", "blocked", "failed"],
  reviewing: ["testing", "debugging", "waiting_human", "blocked"],
  testing: ["done", "waiting_human", "debugging", "failed"],
  debugging: ["ready_for_coding", "testing", "blocked", "failed"],
  waiting_human: ["done", "planning", "coding", "skipped"],
  blocked: ["planning", "coding", "skipped"],
  done: [],
  failed: ["planning", "debugging", "skipped"],
  skipped: [],
};

export const ORCHESTRATOR_STAGES: Record<OrchestratorStage, OrchestratorStageDefinition> = {
  planning: {
    stage: "planning",
    entryStatuses: ["queued", "planning", "failed", "blocked"],
    activeStatus: "planning",
    completionStatus: "ready_for_coding",
    nextStage: "coding",
  },
  coding: {
    stage: "coding",
    entryStatuses: ["ready_for_coding", "coding"],
    activeStatus: "coding",
    completionStatus: "reviewing",
    nextStage: "reviewing",
  },
  reviewing: {
    stage: "reviewing",
    entryStatuses: ["reviewing"],
    activeStatus: "reviewing",
    completionStatus: "testing",
    nextStage: "testing",
  },
  testing: {
    stage: "testing",
    entryStatuses: ["testing"],
    activeStatus: "testing",
    completionStatus: "waiting_human",
    nextStage: null,
  },
  debugging: {
    stage: "debugging",
    entryStatuses: ["debugging"],
    activeStatus: "debugging",
    completionStatus: "ready_for_coding",
    nextStage: "coding",
  },
};

export const ORCHESTRATOR_STAGE_RETRY_POLICY: Record<OrchestratorStage, StageRetryPolicy> = {
  planning: {
    maxAttempts: 2,
    baseBackoffMs: 1000,
  },
  coding: {
    maxAttempts: 2,
    baseBackoffMs: 1500,
  },
  reviewing: {
    maxAttempts: 2,
    baseBackoffMs: 1500,
  },
  testing: {
    maxAttempts: 2,
    baseBackoffMs: 2000,
  },
  debugging: {
    maxAttempts: 1,
    baseBackoffMs: 1000,
  },
};

export function getProjectStatus(taskStatuses: TaskStatus[]): string {
  if (taskStatuses.length === 0) {
    return "idle";
  }

  if (taskStatuses.some((status) => status === "failed")) {
    return "attention";
  }

  if (taskStatuses.every((status) => status === "done")) {
    return "done";
  }

  if (taskStatuses.some((status) => status !== "queued")) {
    return "active";
  }

  return "idle";
}

export function normalizePathList(value?: string[] | null): string[] {
  return value?.filter(Boolean).map((entry) => entry.trim()) ?? [];
}

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export function assertTaskStatusTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new Error(`Invalid task status transition: ${from} -> ${to}`);
  }
}

export function getTaskCounts(taskStatuses: TaskStatus[]) {
  return taskStatuses.reduce<Record<TaskStatus, number>>(
    (counts, status) => {
      counts[status] += 1;
      return counts;
    },
    {
      queued: 0,
      planning: 0,
      ready_for_coding: 0,
      coding: 0,
      reviewing: 0,
      testing: 0,
      debugging: 0,
      waiting_human: 0,
      blocked: 0,
      done: 0,
      failed: 0,
      skipped: 0,
    },
  );
}

export function getOrchestratorStartStage(status: TaskStatus): OrchestratorStage | null {
  if (ORCHESTRATOR_STAGES.planning.entryStatuses.includes(status)) {
    return "planning";
  }

  if (ORCHESTRATOR_STAGES.coding.entryStatuses.includes(status)) {
    return "coding";
  }

  if (ORCHESTRATOR_STAGES.reviewing.entryStatuses.includes(status)) {
    return "reviewing";
  }

  if (ORCHESTRATOR_STAGES.testing.entryStatuses.includes(status)) {
    return "testing";
  }

  if (ORCHESTRATOR_STAGES.debugging.entryStatuses.includes(status)) {
    return "debugging";
  }

  return null;
}

export function getStageRetryDelayMs(stage: OrchestratorStage, attemptNumber: number): number {
  const policy = ORCHESTRATOR_STAGE_RETRY_POLICY[stage];
  return policy.baseBackoffMs * Math.max(1, attemptNumber - 1);
}

export function getNextRunnableTask<T extends TaskLike>(tasks: T[]): T | null {
  const byTaskCode = new Map(tasks.map((task) => [task.taskCode, task]));
  const resumableStatuses: TaskStatus[] = ["planning", "ready_for_coding", "coding", "reviewing", "testing", "debugging"];
  const freshStatuses: TaskStatus[] = ["queued", "failed", "blocked"];
  const runnableStatuses = new Set<TaskStatus>([...resumableStatuses, ...freshStatuses]);
  const statusPriority = new Map<TaskStatus, number>(
    [...resumableStatuses, ...freshStatuses].map((status, index) => [status, index]),
  );

  const candidates = tasks
    .filter((task) => runnableStatuses.has(task.status))
    .filter((task) =>
      task.dependencies.every((dependencyCode) => {
        const dependency = byTaskCode.get(dependencyCode);
        return !dependency || dependency.status === "done" || dependency.status === "skipped";
      }),
    )
    .sort((left, right) => {
      const statusDelta = (statusPriority.get(left.status) ?? Number.MAX_SAFE_INTEGER) -
        (statusPriority.get(right.status) ?? Number.MAX_SAFE_INTEGER);

      if (statusDelta !== 0) {
        return statusDelta;
      }

      return (left.sourceLineStart ?? 0) - (right.sourceLineStart ?? 0);
    });

  return candidates[0] ?? null;
}

export const SAFE_TASK_PATTERNS = [
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

export function isSafeTask(rawText: string): boolean {
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

export interface SafeTaskLike extends TaskLike {
  rawText: string;
}

export function getNextRunnableSafeTask<T extends SafeTaskLike>(tasks: T[]): T | null {
  const safeTasks = tasks.filter((task) => isSafeTask(task.rawText));
  return getNextRunnableTask(safeTasks);
}
