import { parseJsonResponse } from "./http";

const API_BASE_URL = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4010";

export interface ProjectSummary {
  id: string;
  name: string;
  projectType?: string;
  rootPath: string;
  status: string;
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  waitingHumanTasks: number;
  activeTasks: number;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  taskCode: string;
  title: string;
  section: string | null;
  subsection: string | null;
  rawText?: string;
  status: string;
  taskType: string;
  autoApprovable: boolean;
  latestSummary: string | null;
  sourceLineStart: number;
  acceptanceCriteria?: string[];
  dependencies: string[];
  relevantFiles: string[];
}

export interface ProjectDetailResponse {
  detail: {
    project: {
      id: string;
      name: string;
      projectType: string;
      rootPath: string;
      introFilePath: string | null;
      doneProgressFilePath: string | null;
      futureFilePath: string | null;
      implementationPlanFilePath: string | null;
      designBriefFilePath: string | null;
      interactionRulesFilePath: string | null;
      visualReferencesFilePath: string | null;
      referenceDocs: string[];
      todoProgressFilePath: string;
      buildCommand: string | null;
      testCommand: string | null;
      lintCommand: string | null;
      startCommand: string | null;
      allowedPaths: string[];
      blockedPaths: string[];
      defaultBranch: string | null;
      autoRunEnabled: boolean;
      safeAutoRunEnabled: boolean;
      memoryUpdatedAt: string | null;
      createdAt: string;
      updatedAt: string;
    };
    summary: {
      status: string;
      counts: Record<string, number>;
      nextTaskCode: string | null;
    };
    memory: {
      summary: string[];
      promptBlock?: string;
      sources: Array<{
        kind:
          | "primary"
          | "completed"
          | "future"
          | "plan"
          | "todo"
          | "reference"
          | "design_brief"
          | "interaction_rules"
          | "visual_references";
        label: string;
        path: string;
        snippet: string;
      }>;
    };
    tasks: ProjectTask[];
    agents: AgentConfig[];
    runs: Array<{
      id: string;
      taskCode: string | null;
      taskTitle: string | null;
      roleName: string;
      model: string;
      status: string;
      taskId: string | null;
      inputSummary: string;
      outputSummary: string;
      startedAt: string;
      endedAt: string | null;
      commandRuns: Array<{
        id: string;
        command: string;
        cwd: string;
        exitCode: number;
        durationMs: number;
      }>;
    }>;
  };
}

export interface ProjectRun {
  id: string;
  taskId: string | null;
  taskCode: string | null;
  taskTitle: string | null;
  roleName: string;
  model: string;
  status: string;
  inputSummary: string;
  outputSummary: string;
  startedAt: string;
  endedAt: string | null;
  commandRuns: Array<{
    id: string;
    command: string;
    cwd: string;
    exitCode: number;
    durationMs: number;
    stdoutPath: string | null;
    stderrPath: string | null;
    stdout?: string | null;
    stderr?: string | null;
  }>;
}

export interface ProjectMemorySource {
  kind:
    | "primary"
    | "completed"
    | "future"
    | "plan"
    | "todo"
    | "reference"
    | "design_brief"
    | "interaction_rules"
    | "visual_references";
  label: string;
  path: string;
  snippet: string;
}

export interface RunExecutionContext {
  taskId: string;
  taskCode: string;
  projectId: string;
  projectRootPath: string;
  executionRootPath?: string;
  roleName: string;
  provider: string;
  model: string;
  goal: string;
  systemPrompt: string;
  promptText: string;
  rawTaskText: string;
  relevantFiles: string[];
  memory: {
    summary: string[];
    sources: ProjectMemorySource[];
    promptBlock: string;
    relevantFiles: string[];
  };
  fileChanges?: {
    all: string[];
    added: string[];
    modified: string[];
    deleted: string[];
  };
  gitPreflight?: {
    isGitRepo: boolean;
    repoRoot: string | null;
    branch: string | null;
    headCommit: string | null;
    statusLines: string[];
    defaultBranch: string | null;
    hasUncommittedChanges: boolean;
    warnings: string[];
  };
}

export interface RunArtifactSummary {
  id: string;
  artifactType: string;
  title: string;
  filePath: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface RunDetailResponse {
  run: ProjectRun & {
    project: {
      id: string;
      name: string;
    };
    rawOutput: string | null;
    gitDiff: string | null;
    gitStateBefore: {
      isGitRepo: boolean;
      repoRoot: string | null;
      branch: string | null;
      headCommit: string | null;
      statusLines: string[];
    } | null;
    gitStateAfter: {
      isGitRepo: boolean;
      repoRoot: string | null;
      branch: string | null;
      headCommit: string | null;
      statusLines: string[];
    } | null;
    executionContext: RunExecutionContext | null;
    artifacts: RunArtifactSummary[];
    rollbackAvailable: boolean;
  };
}

export interface AgentConfig {
  id: string;
  roleName: string;
  enabled: boolean;
  provider: string;
  model: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  canWriteFiles: boolean;
  canRunCommands: boolean;
  systemPromptTemplate: string;
}

export interface StartupDiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  details?: Record<string, unknown>;
}

export interface StartupDiagnosticsReport {
  checkedAt: string;
  overallStatus: "pass" | "warn" | "fail";
  checks: StartupDiagnosticCheck[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
  });

  const payload = await parseJsonResponse<T>(response);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return payload;
}

export async function getProjects() {
  return fetchJson<{ projects: ProjectSummary[] }>("/api/projects");
}

export async function getProjectDetail(projectId: string) {
  return fetchJson<ProjectDetailResponse>(`/api/projects/${projectId}`);
}

export async function getProjectRuns(projectId: string) {
  return fetchJson<{ runs: ProjectRun[] }>(`/api/projects/${projectId}/runs`);
}

export async function getRunDetail(runId: string) {
  return fetchJson<RunDetailResponse>(`/api/runs/${runId}`);
}

export async function getStartupDiagnostics() {
  return fetchJson<{ diagnostics: StartupDiagnosticsReport }>("/api/diagnostics/startup");
}
