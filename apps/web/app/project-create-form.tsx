"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CLIENT_API_BASE_URL } from "../lib/client-api";
import { parseJsonResponse, readApiError } from "../lib/http";
import { PROVIDER_PRESETS, getDefaultModelForProvider, getProviderModels } from "../lib/model-presets";
import { CliTerminalPanel } from "./cli-terminal-panel";
import { useLanguage } from "./language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type ProjectMode = "greenfield" | "existing";
type IntakeStrategy = "auto" | "heuristic";

type IntakeMessage = {
  role: "user" | "assistant";
  content: string;
};

type ProjectFormState = {
  name: string;
  rootPath: string;
  introFilePath: string;
  doneProgressFilePath: string;
  futureFilePath: string;
  implementationPlanFilePath: string;
  designBriefFilePath: string;
  interactionRulesFilePath: string;
  visualReferencesFilePath: string;
  referenceDocs: string;
  todoProgressFilePath: string;
  buildCommand: string;
  testCommand: string;
  lintCommand: string;
  startCommand: string;
  allowedPaths: string;
  blockedPaths: string;
  defaultBranch: string;
};

type BootstrapFile = {
  path: string;
  title: string;
  content: string;
};

type BrainstormDraft = {
  engine: string;
  provider: string;
  model: string;
  summary: string;
  assistantMessage: string;
  suggestedProject: {
    name: string;
    rootPath: string;
    introFilePath: string;
    implementationPlanFilePath: string;
    designBriefFilePath?: string;
    interactionRulesFilePath?: string;
    visualReferencesFilePath?: string;
    todoProgressFilePath: string;
    buildCommand: string;
    testCommand: string;
    lintCommand: string;
    startCommand: string;
    allowedPaths: string[];
    blockedPaths: string[];
    defaultBranch: string;
  };
  assumptions: string[];
  milestones: string[];
  openQuestions: string[];
  bootstrapFiles: BootstrapFile[];
};

type ExistingProjectAnalysis = {
  engine: string;
  provider: string;
  model: string;
  summary: string;
  assistantMessage: string;
  suggestedProject: {
    name: string;
    rootPath: string;
    introFilePath: string;
    doneProgressFilePath: string;
    futureFilePath: string;
    implementationPlanFilePath: string;
    designBriefFilePath?: string;
    interactionRulesFilePath?: string;
    visualReferencesFilePath?: string;
    referenceDocs: string[];
    todoProgressFilePath: string;
    buildCommand: string;
    testCommand: string;
    lintCommand: string;
    startCommand: string;
    allowedPaths: string[];
    blockedPaths: string[];
    defaultBranch: string;
  };
  scripts: Array<{
    name: string;
    command: string;
  }>;
  keyDirectories: string[];
  workspace: {
    workspaceRoot: string;
    docsRoot: string | null;
    frontendRoot: string | null;
    backendRoot: string | null;
    packageRoots: Array<{
      path: string;
      packageName: string | null;
      role: "frontend" | "backend" | "fullstack" | "tooling" | "unknown";
      scripts: string[];
    }>;
  };
  docMemory: Array<{
    path: string;
    snippet: string;
  }>;
  memorySummary: string[];
};

type SuggestedProjectInput = {
  name?: string;
  rootPath?: string;
  introFilePath?: string;
  doneProgressFilePath?: string;
  futureFilePath?: string;
  implementationPlanFilePath?: string;
  designBriefFilePath?: string;
  interactionRulesFilePath?: string;
  visualReferencesFilePath?: string;
  todoProgressFilePath?: string;
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  startCommand?: string;
  defaultBranch?: string;
  referenceDocs?: string[];
  allowedPaths?: string[];
  blockedPaths?: string[];
};

type IntakeJob<T> = {
  id: string;
  kind: "brainstorm" | "detect-existing";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: string[];
  result?: T;
  error?: string;
};

type ModelHealthCheck = {
  ok: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  provider: string;
  model: string;
  latencyMs: number;
  summary: string;
  errorCode?: string;
  checks?: Array<{
    id: "cli" | "provider" | "model";
    label: string;
    ok: boolean;
    status: "healthy" | "degraded" | "unhealthy";
    latencyMs: number;
    summary: string;
    errorCode?: string;
  }>;
};

const initialState: ProjectFormState = {
  name: "",
  rootPath: "",
  introFilePath: "",
  doneProgressFilePath: "",
  futureFilePath: "",
  implementationPlanFilePath: "",
  designBriefFilePath: "",
  interactionRulesFilePath: "",
  visualReferencesFilePath: "",
  referenceDocs: "",
  todoProgressFilePath: "",
  buildCommand: "",
  testCommand: "",
  lintCommand: "",
  startCommand: "",
  allowedPaths: "",
  blockedPaths: "",
  defaultBranch: "main",
};

function joinLines(items: string[] | undefined) {
  return items?.join("\n") ?? "";
}

function appendConversation(
  current: IntakeMessage[],
  userMessage: string,
  assistantMessage: string,
) {
  const next = [...current];

  if (userMessage.trim()) {
    next.push({
      role: "user",
      content: userMessage.trim(),
    });
  }

  next.push({
    role: "assistant",
    content: assistantMessage.trim(),
  });

  return next;
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function normalizeIntakeEngine(engine: string) {
  if (engine === "heuristic-forced") {
    return "heuristic";
  }
  return engine;
}

function nowStamp() {
  return new Date().toLocaleTimeString("en-CA", { hour12: false });
}

export function ProjectCreateForm() {
  const router = useRouter();
  const { language } = useLanguage();
  const [mode, setMode] = useState<ProjectMode>("greenfield");
  const [form, setForm] = useState<ProjectFormState>(initialState);
  const [intakeStrategy, setIntakeStrategy] = useState<IntakeStrategy>("auto");
  const [intakeProvider, setIntakeProvider] = useState("mock");
  const [intakeModel, setIntakeModel] = useState("forgeflow-intake-mock");
  const [projectIdea, setProjectIdea] = useState("");
  const [brainstormFollowUp, setBrainstormFollowUp] = useState("");
  const [existingFollowUp, setExistingFollowUp] = useState("");
  const [brainstormMessages, setBrainstormMessages] = useState<IntakeMessage[]>([]);
  const [existingMessages, setExistingMessages] = useState<IntakeMessage[]>([]);
  const [bootstrapFiles, setBootstrapFiles] = useState<BootstrapFile[]>([]);
  const [draft, setDraft] = useState<BrainstormDraft | null>(null);
  const [analysis, setAnalysis] = useState<ExistingProjectAnalysis | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [brainstorming, setBrainstorming] = useState(false);
  const [intakeLogs, setIntakeLogs] = useState<string[]>([]);
  const [activeIntakeJobId, setActiveIntakeJobId] = useState<string | null>(null);
  const activeJobStreamRef = useRef<EventSource | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [lastHealthCheck, setLastHealthCheck] = useState<ModelHealthCheck | null>(null);
  const [feedback, setFeedback] = useState(
    language === "zh"
      ? "可以先用 mock 做稳定接入，也可以切到本地 OpenCode CLI 的 provider 和 model，获得更智能的 intake 对话。"
      : "Use mock for deterministic intake, or switch to an OpenCode CLI provider and model for a smarter intake conversation.",
  );
  const intakeModelOptions = getProviderModels(intakeProvider);

  function resetLogs(title: string, lines: string[]) {
    setIntakeLogs([`[${nowStamp()}] ${title}`, ...lines.map((line) => `[${nowStamp()}] ${line}`)]);
  }

  function appendLog(line: string) {
    setIntakeLogs((current) => [...current, `[${nowStamp()}] ${line}`].slice(-80));
  }

  function closeActiveJobStream() {
    activeJobStreamRef.current?.close();
    activeJobStreamRef.current = null;
  }

  useEffect(() => {
    return () => {
      closeActiveJobStream();
    };
  }, []);

  useEffect(() => {
    setFeedback((current) => {
      const english =
        "Use mock for deterministic intake, or switch to an OpenCode CLI provider and model for a smarter intake conversation.";
      const chinese =
        "可以先用 mock 做稳定接入，也可以切到本地 OpenCode CLI 的 provider 和 model，获得更智能的 intake 对话。";

      if (!current || current === english || current.includes("OpenCode CLI")) {
        return language === "zh" ? chinese : english;
      }

      return current;
    });
  }, [language]);

  async function waitForIntakeJob<T>(jobId: string) {
    return await new Promise<T>((resolve, reject) => {
      closeActiveJobStream();
      const stream = new EventSource(`${API_BASE_URL}/intake/jobs/${jobId}/events`);
      activeJobStreamRef.current = stream;

      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { job?: IntakeJob<T> };

          if (!payload.job) {
            return;
          }

          setIntakeLogs(payload.job.logs);

          if (payload.job.status === "completed") {
            closeActiveJobStream();
            resolve(payload.job.result as T);
            return;
          }

          if (payload.job.status === "failed" || payload.job.status === "cancelled") {
            closeActiveJobStream();
            reject(new Error(payload.job.error ?? "Intake job failed"));
          }
        } catch (error) {
          closeActiveJobStream();
          reject(error instanceof Error ? error : new Error("Failed to parse intake event"));
        }
      };

      stream.onerror = async () => {
        closeActiveJobStream();

        try {
          const response = await fetch(`${API_BASE_URL}/intake/jobs/${jobId}`, {
            cache: "no-store",
          });
          const payload = await parseJsonResponse<{ job?: IntakeJob<T>; error?: string; message?: string }>(response);

          if (!response.ok || !payload.job) {
            reject(new Error(readApiError(payload, "Failed to read intake job")));
            return;
          }

          setIntakeLogs(payload.job.logs);

          if (payload.job.status === "completed") {
            resolve(payload.job.result as T);
            return;
          }

          if (payload.job.status === "failed" || payload.job.status === "cancelled") {
            reject(new Error(payload.job.error ?? "Intake job failed"));
            return;
          }

          reject(new Error("Intake stream disconnected before the job finished"));
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Intake stream failed"));
        }
      };
    });
  }

  function setProvider(provider: string) {
    setIntakeProvider(provider);

    const defaultModel = getDefaultModelForProvider(provider);

    if (defaultModel) {
      setIntakeModel(defaultModel);
    }
  }

  function applySuggestedProject(suggested: SuggestedProjectInput) {
    setForm((current) => ({
      ...current,
      ...(suggested.name !== undefined ? { name: suggested.name } : {}),
      ...(suggested.rootPath !== undefined ? { rootPath: suggested.rootPath } : {}),
      ...(suggested.introFilePath !== undefined ? { introFilePath: suggested.introFilePath } : {}),
      ...(suggested.doneProgressFilePath !== undefined
        ? { doneProgressFilePath: suggested.doneProgressFilePath }
        : {}),
      ...(suggested.futureFilePath !== undefined ? { futureFilePath: suggested.futureFilePath } : {}),
      ...(suggested.implementationPlanFilePath !== undefined
        ? { implementationPlanFilePath: suggested.implementationPlanFilePath }
        : {}),
      ...(suggested.designBriefFilePath !== undefined
        ? { designBriefFilePath: suggested.designBriefFilePath }
        : {}),
      ...(suggested.interactionRulesFilePath !== undefined
        ? { interactionRulesFilePath: suggested.interactionRulesFilePath }
        : {}),
      ...(suggested.visualReferencesFilePath !== undefined
        ? { visualReferencesFilePath: suggested.visualReferencesFilePath }
        : {}),
      ...(suggested.todoProgressFilePath !== undefined
        ? { todoProgressFilePath: suggested.todoProgressFilePath }
        : {}),
      ...(suggested.buildCommand !== undefined ? { buildCommand: suggested.buildCommand } : {}),
      ...(suggested.testCommand !== undefined ? { testCommand: suggested.testCommand } : {}),
      ...(suggested.lintCommand !== undefined ? { lintCommand: suggested.lintCommand } : {}),
      ...(suggested.startCommand !== undefined ? { startCommand: suggested.startCommand } : {}),
      ...(suggested.defaultBranch !== undefined ? { defaultBranch: suggested.defaultBranch } : {}),
      referenceDocs: Array.isArray(suggested.referenceDocs) ? joinLines(suggested.referenceDocs) : current.referenceDocs,
      allowedPaths: Array.isArray(suggested.allowedPaths) ? joinLines(suggested.allowedPaths) : current.allowedPaths,
      blockedPaths: Array.isArray(suggested.blockedPaths) ? joinLines(suggested.blockedPaths) : current.blockedPaths,
    }));
  }

  function resetMode(nextMode: ProjectMode) {
    setMode(nextMode);
    setDraft(null);
    setAnalysis(null);
    setBootstrapFiles([]);
    setFeedback(
      language === "zh"
        ? nextMode === "greenfield"
          ? "先把项目设想说清楚，再通过 intake 模型反复细化，最后确认创建。"
          : "先让 intake 模型识别现有仓库和文档，再通过补充说明细化导入结果。"
        : nextMode === "greenfield"
          ? "Start with an idea, then keep refining it with the intake model before you create the project."
          : "Point the intake model at an existing repo, review its memory summary, then keep refining the import with follow-up messages.",
    );
  }

  async function runModelHealthCheck() {
    const startedAt = Date.now();
    setHealthChecking(true);
    appendLog(`POST ${API_BASE_URL}/intake/health-check`);
    appendLog(`health provider=${intakeProvider}`);
    appendLog(`health model=${intakeModel}`);

    try {
      const response = await fetch(`${API_BASE_URL}/intake/health-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: intakeProvider,
          model: intakeModel,
          rootPath: form.rootPath.trim() || undefined,
        }),
      });

      const payload = await parseJsonResponse<{
        health?: ModelHealthCheck;
        error?: string;
        message?: string;
      }>(response);

      if (!response.ok || !payload.health) {
        throw new Error(readApiError(payload, "Failed to run model health check"));
      }

      setLastHealthCheck(payload.health);
      appendLog(`Health check completed in ${formatElapsed(Date.now() - startedAt)}.`);
      appendLog(
        payload.health.ok
          ? `Health check passed in ${payload.health.latencyMs}ms.`
          : payload.health.status === "degraded"
            ? `Health check timed out after ${payload.health.latencyMs}ms. Continuing is allowed: ${payload.health.summary}`
            : `Health check failed in ${payload.health.latencyMs}ms: ${payload.health.summary}`,
      );
      setFeedback(
        payload.health.ok
          ? `Model looks healthy: ${payload.health.provider}/${payload.health.model}.`
          : payload.health.status === "degraded"
            ? `Model health check timed out, but you can still continue: ${payload.health.summary}`
            : `Model health check failed: ${payload.health.summary}`,
      );

      return payload.health;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run model health check";
      const failed: ModelHealthCheck = {
        ok: false,
        status: "unhealthy",
        provider: intakeProvider,
        model: intakeModel,
        latencyMs: Date.now() - startedAt,
        summary: message,
      };

      setLastHealthCheck(failed);
      appendLog(message);
      setFeedback(message);
      return failed;
    } finally {
      setHealthChecking(false);
    }
  }

  async function ensureModelHealthBeforeIntake() {
    if (intakeStrategy === "heuristic" || intakeProvider === "mock") {
      return true;
    }

    if (
      lastHealthCheck &&
      lastHealthCheck.ok &&
      lastHealthCheck.provider === intakeProvider &&
      lastHealthCheck.model === intakeModel
    ) {
      appendLog(`Reusing recent health check for ${intakeProvider}/${intakeModel}.`);
      return true;
    }

    const health = await runModelHealthCheck();
    if (health.ok) {
      return true;
    }

    appendLog(`Proceeding despite health check status=${health.status} for ${intakeProvider}/${intakeModel}.`);
    setFeedback(
      health.status === "unhealthy"
        ? `Health check did not pass, but ForgeFlow will still continue: ${health.summary}`
        : `Health check was degraded, but ForgeFlow will continue: ${health.summary}`,
    );
    return true;
  }

  async function handleBrainstorm() {
    if (!form.rootPath.trim()) {
      appendLog("Cannot start new-project intake: missing target root path.");
      setFeedback("Fill in the target root path first.");
      return;
    }

    const initialIdea = projectIdea.trim();
    const followUp = brainstormFollowUp.trim();
    const seedMessage = initialIdea || followUp;

    if (!seedMessage) {
      appendLog("Cannot start new-project intake: missing project idea or follow-up message.");
      setFeedback("Describe the project idea or enter a follow-up instruction first.");
      return;
    }

    const latestUserMessage =
      followUp || (brainstormMessages.length === 0 ? initialIdea : "");
    const startedAt = Date.now();

    setBrainstorming(true);
    resetLogs("New-project intake started", [
      `POST ${API_BASE_URL}/intake/brainstorm`,
      `strategy=${intakeStrategy}`,
      `provider=${intakeProvider}`,
      `model=${intakeModel}`,
      `rootPath=${form.rootPath}`,
      latestUserMessage ? `message=${latestUserMessage}` : "message=<empty>",
    ]);
    setFeedback(`Generating a project draft with ${intakeProvider}/${intakeModel}...`);

    try {
      const healthy = await ensureModelHealthBeforeIntake();

      const response = await fetch(`${API_BASE_URL}/intake/brainstorm/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rootPath: form.rootPath,
          projectName: form.name,
          idea: initialIdea || followUp,
          notes: latestUserMessage,
          strategy: intakeStrategy,
          provider: intakeProvider,
          model: intakeModel,
          conversation: brainstormMessages,
        }),
      });

      const payload = await parseJsonResponse<{
        job?: IntakeJob<BrainstormDraft>;
        error?: string;
        message?: string;
      }>(response);

      if (!response.ok || !payload.job) {
        throw new Error(readApiError(payload, "Failed to start project draft job"));
      }

      setActiveIntakeJobId(payload.job.id);
      setIntakeLogs(payload.job.logs);
      appendLog(`Streaming job ${payload.job.id}`);
      const nextDraft = await waitForIntakeJob<BrainstormDraft>(payload.job.id);

      setDraft(nextDraft);
      setAnalysis(null);
      setBootstrapFiles(nextDraft.bootstrapFiles);
      applySuggestedProject(nextDraft.suggestedProject);
      setBrainstormMessages((current) =>
        appendConversation(current, latestUserMessage || seedMessage, nextDraft.assistantMessage),
      );
      setBrainstormFollowUp("");
      appendLog(`Request completed in ${formatElapsed(Date.now() - startedAt)}.`);
      appendLog(`engine=${nextDraft.engine} provider=${nextDraft.provider} model=${nextDraft.model}`);
      setFeedback(`Draft updated via ${nextDraft.engine}/${nextDraft.model}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate project draft";
      appendLog(`Request failed after ${formatElapsed(Date.now() - startedAt)}.`);
      appendLog(message);
      setFeedback(message);
    } finally {
      setActiveIntakeJobId(null);
      setBrainstorming(false);
    }
  }

  async function handleDetectExisting() {
    if (!form.rootPath.trim()) {
      setFeedback("Fill in the existing project path first.");
      return;
    }

    const latestUserMessage =
      existingFollowUp.trim() || (existingMessages.length === 0 ? `Inspect project at ${form.rootPath}` : "");
    const startedAt = Date.now();

    setDetecting(true);
    resetLogs("Existing-project intake started", [
      `POST ${API_BASE_URL}/intake/detect-existing`,
      `strategy=${intakeStrategy}`,
      `provider=${intakeProvider}`,
      `model=${intakeModel}`,
      `rootPath=${form.rootPath}`,
      latestUserMessage ? `message=${latestUserMessage}` : "message=<empty>",
    ]);
    setFeedback(`Inspecting the project with ${intakeProvider}/${intakeModel}...`);

    try {
      const healthy = await ensureModelHealthBeforeIntake();

      const response = await fetch(`${API_BASE_URL}/intake/detect-existing/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rootPath: form.rootPath,
          notes: latestUserMessage,
          strategy: intakeStrategy,
          provider: intakeProvider,
          model: intakeModel,
          conversation: existingMessages,
        }),
      });

      const payload = await parseJsonResponse<{
        job?: IntakeJob<ExistingProjectAnalysis>;
        error?: string;
        message?: string;
      }>(
        response,
      );

      if (!response.ok || !payload.job) {
        throw new Error(readApiError(payload, "Failed to start existing-project intake job"));
      }

      setActiveIntakeJobId(payload.job.id);
      setIntakeLogs(payload.job.logs);
      appendLog(`Streaming job ${payload.job.id}`);
      const nextAnalysis = await waitForIntakeJob<ExistingProjectAnalysis>(payload.job.id);

      setAnalysis(nextAnalysis);
      setDraft(null);
      setBootstrapFiles([]);
      applySuggestedProject(nextAnalysis.suggestedProject);
      setExistingMessages((current) =>
        appendConversation(current, latestUserMessage || `Inspect project at ${form.rootPath}`, nextAnalysis.assistantMessage),
      );
      setExistingFollowUp("");
      appendLog(`Request completed in ${formatElapsed(Date.now() - startedAt)}.`);
      appendLog(`engine=${nextAnalysis.engine} provider=${nextAnalysis.provider} model=${nextAnalysis.model}`);
      setFeedback(`Existing-project analysis updated via ${nextAnalysis.engine}/${nextAnalysis.model}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to inspect existing project";
      appendLog(`Request failed after ${formatElapsed(Date.now() - startedAt)}.`);
      appendLog(message);
      setFeedback(message);
    } finally {
      setActiveIntakeJobId(null);
      setDetecting(false);
    }
  }

  async function handleCancelIntake() {
    if (!activeIntakeJobId) {
      return;
    }

    closeActiveJobStream();
    appendLog(`POST ${API_BASE_URL}/intake/jobs/${activeIntakeJobId}/cancel`);

    try {
      const response = await fetch(`${API_BASE_URL}/intake/jobs/${activeIntakeJobId}/cancel`, {
        method: "POST",
      });

      const payload = await parseJsonResponse<{
        job?: IntakeJob<unknown>;
        error?: string;
        message?: string;
      }>(response);

      if (!response.ok || !payload.job) {
        throw new Error(readApiError(payload, "Failed to cancel intake job"));
      }

      setIntakeLogs(payload.job.logs);
      setFeedback(payload.job.error ?? "Intake job cancelled.");
      setActiveIntakeJobId(null);
      setBrainstorming(false);
      setDetecting(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to cancel intake job";
      appendLog(message);
      setFeedback(message);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startedAt = Date.now();
    setSubmitting(true);
    resetLogs("Project creation started", [
      `POST ${API_BASE_URL}/projects`,
      `projectType=${mode}`,
      `name=${form.name}`,
      `rootPath=${form.rootPath}`,
    ]);
    setFeedback(mode === "existing" ? "Importing existing project..." : "Creating project from the confirmed draft...");

    try {
      const response = await fetch(`${API_BASE_URL}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          projectType: mode,
          referenceDocs: form.referenceDocs
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          allowedPaths: form.allowedPaths
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          blockedPaths: form.blockedPaths
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          bootstrapFiles: mode === "greenfield" ? bootstrapFiles.map(({ path, content }) => ({ path, content })) : [],
        }),
      });

      const payload = await parseJsonResponse<{
        detail?: { project: { id: string } };
        error?: string;
        message?: string;
      }>(response);

      if (!response.ok || !payload.detail) {
        throw new Error(readApiError(payload, "Failed to create project"));
      }

      setFeedback("Project created. Opening the detail page...");
      setForm(initialState);
      setProjectIdea("");
      setBrainstormFollowUp("");
      setExistingFollowUp("");
      setDraft(null);
      setAnalysis(null);
      setBootstrapFiles([]);
      setBrainstormMessages([]);
      setExistingMessages([]);
      appendLog(`Project created in ${formatElapsed(Date.now() - startedAt)}.`);
      appendLog(`projectId=${payload.detail.project.id}`);
      router.push(`/projects/${payload.detail.project.id}`);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create project";
      appendLog(`Project creation failed after ${formatElapsed(Date.now() - startedAt)}.`);
      appendLog(message);
      setFeedback(message);
    } finally {
      setSubmitting(false);
    }
  }

  const currentConversation = mode === "greenfield" ? brainstormMessages : existingMessages;
  const text =
    language === "zh"
      ? {
          modeAria: "项目模式",
          newProject: "新项目",
          newProjectHint: "先头脑风暴、反复细化，再生成初始文件",
          existingProject: "老项目",
          existingProjectHint: "先识别仓库、整理记忆，再确认导入",
          greenfieldFlow: "这个流程既可以只靠启发式和 mock，也可以切到本地 OpenCode CLI 的真实 provider 和 model。",
          existingFlow: "这个流程会先扫描仓库，再让 intake 模型细化导入选择和项目记忆。",
          intakeModel: "Intake 模型",
          intakeStrategy: "Intake 策略",
          modelRefine: "模型细化",
          heuristicOnly: "仅启发式",
          presetProvider: "预设 Provider",
          presetModel: "预设 Model",
          customModel: "自定义模型 ID",
          provider: "Provider",
          model: "Model",
          heuristicHint: "仅启发式模式会跳过模型执行，只根据本地文件发现和文档打分来导入。",
          modelHint: "模型细化模式会先完成本地启发式扫描，再用选中的 provider 和 model 做补充判断。",
          checking: "检查中...",
          checkModelHealth: "检查模型健康度",
          projectName: "项目名称",
          projectPath: "项目路径",
          targetRootPath: "目标根路径",
          projectIdea: "项目设想",
          projectIdeaPlaceholder: "描述产品、目标用户以及你想构建的核心能力。",
          talkToModel: "与 Intake 模型对话",
          brainstormPlaceholder: "告诉模型你想怎么调整范围、技术栈、里程碑、文件结构或 TODO 组织。",
          existingPlaceholder: "告诉模型应优先什么、哪份文档应作为主参考，或如何限定导入范围。",
          thinking: "思考中...",
          generateDraft: "生成 / 细化草案",
          cancelIntake: "取消 Intake",
          inspecting: "识别中...",
          inspectImport: "识别 / 细化导入",
          conversation: "对话记录",
          draftPreview: "草案预览",
          summary: "摘要",
          assumptions: "前提假设",
          milestones: "里程碑",
          openQuestions: "待确认问题",
          projectAnalysis: "项目分析",
          systemMemory: "系统记忆",
          keyDirectories: "关键目录",
          workspaceLayout: "工作区结构",
          notFound: "未找到",
          detectedScripts: "识别到的脚本",
          noScripts: "未发现 package.json 脚本。",
          docMemory: "文档记忆",
          noSnippet: "暂无摘要。",
          projectConfig: "将要创建的项目配置",
          todoSource: "TODO 来源",
          primaryReference: "主参考文档",
          completedDoc: "已完成功能文档",
          futureDoc: "未来功能文档",
          implementationPlan: "实现计划文档",
          designBrief: "设计简报",
          interactionRules: "交互规则",
          visualReferences: "视觉参考",
          extraDocs: "额外参考文档",
          testCommand: "测试命令",
          buildCommand: "构建命令",
          lintCommand: "Lint 命令",
          startCommand: "启动命令",
          allowedPaths: "允许修改路径",
          blockedPaths: "禁止修改路径",
          defaultBranch: "默认分支",
          optional: "可选",
          onePathPerLine: "每行一个绝对路径",
          oneRelativePerLine: "每行一个相对路径",
          liveLog: "实时 Intake 日志",
          processing: "处理中...",
          confirmImport: "确认导入",
          confirmCreate: "确认创建",
        }
      : {
          modeAria: "project mode",
          newProject: "New Project",
          newProjectHint: "Brainstorm, refine, then generate the starter files",
          existingProject: "Existing Project",
          existingProjectHint: "Inspect the repo, refine the memory, then import it",
          greenfieldFlow:
            "This flow can be heuristic with mock, or intelligent with your local OpenCode CLI provider and model.",
          existingFlow:
            "This flow first scans the repo, then lets the intake model refine the import choice and project memory.",
          intakeModel: "Intake Model",
          intakeStrategy: "Intake Strategy",
          modelRefine: "Model Refine",
          heuristicOnly: "Heuristic Only",
          presetProvider: "Preset Provider",
          presetModel: "Preset Model",
          customModel: "Custom model id",
          provider: "Provider",
          model: "Model",
          heuristicHint:
            "Heuristic-only mode skips model execution and imports based on local file discovery and document scoring.",
          modelHint: "Model refine mode uses the selected provider and model after the local heuristic pass.",
          checking: "Checking...",
          checkModelHealth: "Check Model Health",
          projectName: "Project Name",
          projectPath: "Project Path",
          targetRootPath: "Target Root Path",
          projectIdea: "Project Idea",
          projectIdeaPlaceholder: "Describe the product, user, and the core capabilities you want to build.",
          talkToModel: "Talk To The Intake Model",
          brainstormPlaceholder: "Ask the model to adjust the scope, stack, milestones, files, or TODO structure.",
          existingPlaceholder:
            "Ask the model what to prioritize, what to treat as the main reference, or how to scope the import.",
          thinking: "Thinking...",
          generateDraft: "Generate / Refine Draft",
          cancelIntake: "Cancel Intake",
          inspecting: "Inspecting...",
          inspectImport: "Inspect / Refine Import",
          conversation: "Conversation",
          draftPreview: "Draft Preview",
          summary: "Summary",
          assumptions: "Assumptions",
          milestones: "Milestones",
          openQuestions: "Open Questions",
          projectAnalysis: "Project Analysis",
          systemMemory: "System Memory",
          keyDirectories: "Key Directories",
          workspaceLayout: "Workspace Layout",
          notFound: "Not found",
          detectedScripts: "Detected Scripts",
          noScripts: "No package.json scripts detected.",
          docMemory: "Doc Memory",
          noSnippet: "No snippet available.",
          projectConfig: "Project Config To Create",
          todoSource: "TODO Source",
          primaryReference: "Primary Reference Doc",
          completedDoc: "Completed Features Doc",
          futureDoc: "Future Features Doc",
          implementationPlan: "Implementation Plan Doc",
          designBrief: "Design Brief",
          interactionRules: "Interaction Rules",
          visualReferences: "Visual References",
          extraDocs: "Extra Reference Docs",
          testCommand: "Test Command",
          buildCommand: "Build Command",
          lintCommand: "Lint Command",
          startCommand: "Start Command",
          allowedPaths: "Allowed Paths",
          blockedPaths: "Blocked Paths",
          defaultBranch: "Default Branch",
          optional: "Optional",
          onePathPerLine: "One absolute path per line",
          oneRelativePerLine: "One relative path per line",
          liveLog: "Live Intake Log",
          processing: "Processing...",
          confirmImport: "Confirm Import",
          confirmCreate: "Confirm Create",
        };

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="mode-switch" role="tablist" aria-label={text.modeAria}>
        <button
          type="button"
          className={`mode-option ${mode === "greenfield" ? "active" : ""}`}
          onClick={() => resetMode("greenfield")}
        >
          <strong>{text.newProject}</strong>
          <span>{text.newProjectHint}</span>
        </button>
        <button
          type="button"
          className={`mode-option ${mode === "existing" ? "active" : ""}`}
          onClick={() => resetMode("existing")}
        >
          <strong>{text.existingProject}</strong>
          <span>{text.existingProjectHint}</span>
        </button>
      </div>

      <div className="mode-hint">
        {mode === "greenfield"
          ? text.greenfieldFlow
          : text.existingFlow}
      </div>

      <div className="preview-panel">
        <h3>{text.intakeModel}</h3>
        <div className="field">
          <label htmlFor="intakeStrategy">{text.intakeStrategy}</label>
          <select
            id="intakeStrategy"
            value={intakeStrategy}
            onChange={(event) => setIntakeStrategy(event.target.value as IntakeStrategy)}
          >
            <option value="auto">{text.modelRefine}</option>
            <option value="heuristic">{text.heuristicOnly}</option>
          </select>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="intakeProviderPreset">{text.presetProvider}</label>
            <select
              id="intakeProviderPreset"
              value={intakeProvider}
              onChange={(event) => setProvider(event.target.value)}
              disabled={intakeStrategy === "heuristic"}
            >
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="intakeModelPreset">{text.presetModel}</label>
            <select
              id="intakeModelPreset"
              value={intakeModelOptions.some((option) => option.value === intakeModel) ? intakeModel : ""}
              onChange={(event) => setIntakeModel(event.target.value)}
              disabled={intakeStrategy === "heuristic"}
            >
              <option value="">{text.customModel}</option>
              {intakeModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="intakeProvider">{text.provider}</label>
            <input
              id="intakeProvider"
              value={intakeProvider}
              onChange={(event) => setIntakeProvider(event.target.value)}
              placeholder="mock, opencode, nvidia, openai"
              disabled={intakeStrategy === "heuristic"}
            />
          </div>
          <div className="field">
            <label htmlFor="intakeModel">{text.model}</label>
            <input
              id="intakeModel"
              value={intakeModel}
              onChange={(event) => setIntakeModel(event.target.value)}
              placeholder="mimo-v2-pro-free, z-ai/glm5, gpt-5.4"
              disabled={intakeStrategy === "heuristic"}
            />
          </div>
        </div>
        <div className="mode-hint">
          {intakeStrategy === "heuristic" ? text.heuristicHint : text.modelHint}
        </div>
        <div className="button-row">
          <button
            className="button ghost"
            type="button"
            onClick={() => void runModelHealthCheck()}
            disabled={healthChecking || intakeStrategy === "heuristic"}
          >
            {healthChecking ? text.checking : text.checkModelHealth}
          </button>
          {lastHealthCheck ? (
            <span
              className={`tag ${
                lastHealthCheck.ok ? "good" : lastHealthCheck.status === "degraded" ? "warn" : "bad"
              }`}
            >
              {lastHealthCheck.status} {lastHealthCheck.latencyMs}ms
            </span>
          ) : null}
        </div>
        {lastHealthCheck ? (
          <div className="mode-hint">
            {lastHealthCheck.provider}/{lastHealthCheck.model}: {lastHealthCheck.summary}
            {lastHealthCheck.errorCode ? ` (${lastHealthCheck.errorCode})` : ""}
          </div>
        ) : null}
        {lastHealthCheck?.checks?.length ? (
          <div className="stack compact">
            {lastHealthCheck.checks.map((check) => (
              <div key={check.id} className="preview-block">
                <div className="inline-meta">
                  <strong>{check.label}</strong>
                  <span className={`tag ${check.ok ? "good" : check.status === "degraded" ? "warn" : "bad"}`}>
                    {check.status}
                  </span>
                  <span className="tag">{check.latencyMs}ms</span>
                  {check.errorCode ? <span className="tag">{check.errorCode}</span> : null}
                </div>
                <div className="muted">{check.summary}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <CliTerminalPanel
        rootPath={form.rootPath}
        intakeProvider={intakeProvider}
        intakeModel={intakeModel}
      />

      <div className="grid-2">
        <div className="field">
          <label htmlFor="name">{text.projectName}</label>
          <input
            id="name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder={mode === "existing" ? "Song Web" : "My New Product"}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="rootPath">{mode === "existing" ? text.projectPath : text.targetRootPath}</label>
          <input
            id="rootPath"
            value={form.rootPath}
            onChange={(event) => setForm((current) => ({ ...current, rootPath: event.target.value }))}
            placeholder={mode === "existing" ? "D:\\Song" : "D:\\Projects\\my-new-product"}
            required
          />
        </div>
      </div>

      {mode === "greenfield" ? (
        <>
          <div className="field">
            <label htmlFor="projectIdea">{text.projectIdea}</label>
            <textarea
              id="projectIdea"
              value={projectIdea}
              onChange={(event) => setProjectIdea(event.target.value)}
              placeholder={text.projectIdeaPlaceholder}
            />
          </div>
          <div className="field">
            <label htmlFor="brainstormFollowUp">{text.talkToModel}</label>
            <textarea
              id="brainstormFollowUp"
              value={brainstormFollowUp}
              onChange={(event) => setBrainstormFollowUp(event.target.value)}
              placeholder={text.brainstormPlaceholder}
            />
          </div>
          <div className="button-row">
            <button className="button secondary" type="button" onClick={handleBrainstorm} disabled={brainstorming}>
              {brainstorming ? text.thinking : text.generateDraft}
            </button>
            {activeIntakeJobId ? (
              <button className="button ghost" type="button" onClick={handleCancelIntake}>
                {text.cancelIntake}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="existingFollowUp">{text.talkToModel}</label>
            <textarea
              id="existingFollowUp"
              value={existingFollowUp}
              onChange={(event) => setExistingFollowUp(event.target.value)}
              placeholder={text.existingPlaceholder}
            />
          </div>
          <div className="button-row">
            <button className="button secondary" type="button" onClick={handleDetectExisting} disabled={detecting}>
              {detecting ? text.inspecting : text.inspectImport}
            </button>
            {activeIntakeJobId ? (
              <button className="button ghost" type="button" onClick={handleCancelIntake}>
                {text.cancelIntake}
              </button>
            ) : null}
          </div>
        </>
      )}

      {currentConversation.length > 0 ? (
        <section className="preview-panel">
          <h3>{text.conversation}</h3>
          <div className="stack">
            {currentConversation.map((message, index) => (
              <div key={`${message.role}-${index}`} className="preview-block">
                <div className="inline-meta">
                  <span className={`tag ${message.role === "assistant" ? "good" : ""}`}>{message.role}</span>
                </div>
                <div>{message.content}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {draft ? (
        <section className="preview-panel">
          <h3>{text.draftPreview}</h3>
          <div className="inline-meta">
            <span className="tag">{normalizeIntakeEngine(draft.engine)}</span>
            <span className="tag">{draft.provider}</span>
            <span className="tag">{draft.model}</span>
          </div>
          <div className="preview-block">
            <strong>{text.summary}</strong>
            <div className="muted">{draft.summary}</div>
            <div>{draft.assistantMessage}</div>
          </div>
          <div className="preview-grid">
            <div className="preview-block">
              <strong>{text.assumptions}</strong>
              <div className="stack compact">
                {draft.assumptions.map((item) => (
                  <span key={item} className="tag">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="preview-block">
              <strong>{text.milestones}</strong>
              <div className="stack compact">
                {draft.milestones.map((item) => (
                  <div key={item} className="muted">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="preview-block">
            <strong>{text.openQuestions}</strong>
            <div className="stack compact">
              {draft.openQuestions.map((item) => (
                <div key={item} className="muted">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="stack">
            {bootstrapFiles.map((file, index) => (
              <div key={file.path} className="preview-block">
                <div className="inline-meta">
                  <span className="tag">{file.title}</span>
                  <span className="tag">{file.path}</span>
                </div>
                <textarea
                  value={file.content}
                  onChange={(event) =>
                    setBootstrapFiles((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, content: event.target.value } : entry,
                      ),
                    )
                  }
                  className="code-area"
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analysis ? (
        <section className="preview-panel">
          <h3>{text.projectAnalysis}</h3>
          <div className="inline-meta">
            <span className="tag">{normalizeIntakeEngine(analysis.engine)}</span>
            <span className="tag">{analysis.provider}</span>
            <span className="tag">{analysis.model}</span>
          </div>
          <div className="preview-block">
            <strong>{text.summary}</strong>
            <div className="muted">{analysis.summary}</div>
            <div>{analysis.assistantMessage}</div>
          </div>
          <div className="preview-grid">
            <div className="preview-block">
              <strong>{text.systemMemory}</strong>
              <div className="stack compact">
                {analysis.memorySummary.map((item) => (
                  <div key={item} className="muted">
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="preview-block">
              <strong>{text.keyDirectories}</strong>
              <div className="inline-meta">
                {analysis.keyDirectories.map((item) => (
                  <span key={item} className="tag">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="preview-block">
            <strong>{text.workspaceLayout}</strong>
            <div className="stack compact">
              <div className="muted">workspace: {analysis.workspace.workspaceRoot}</div>
              <div className="muted">frontend: {analysis.workspace.frontendRoot ?? text.notFound}</div>
              <div className="muted">backend: {analysis.workspace.backendRoot ?? text.notFound}</div>
              <div className="muted">docs: {analysis.workspace.docsRoot ?? text.notFound}</div>
            </div>
            {analysis.workspace.packageRoots.length > 0 ? (
              <div className="stack compact">
                {analysis.workspace.packageRoots.map((pkg) => (
                  <div key={pkg.path} className="preview-doc">
                    <div className="inline-meta">
                      <span className="tag">{pkg.role}</span>
                      {pkg.packageName ? <span className="tag">{pkg.packageName}</span> : null}
                    </div>
                    <div className="muted">{pkg.path}</div>
                    {pkg.scripts.length > 0 ? <div>{pkg.scripts.join(", ")}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="preview-block">
            <strong>{text.detectedScripts}</strong>
            {analysis.scripts.length === 0 ? (
              <div className="muted">{text.noScripts}</div>
            ) : (
              <div className="stack compact">
                {analysis.scripts.map((script) => (
                  <div key={script.name} className="muted">
                    {script.name}: {script.command}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="preview-block">
            <strong>{text.docMemory}</strong>
            <div className="stack compact">
              {analysis.docMemory.map((doc) => (
                <div key={doc.path} className="preview-doc">
                  <div className="muted">{doc.path}</div>
                  <div>{doc.snippet || text.noSnippet}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="preview-panel">
        <h3>{text.projectConfig}</h3>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="todoProgressFilePath">{text.todoSource}</label>
            <input
              id="todoProgressFilePath"
              value={form.todoProgressFilePath}
              onChange={(event) => setForm((current) => ({ ...current, todoProgressFilePath: event.target.value }))}
              placeholder="D:\\Path\\TODO.md"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="introFilePath">{text.primaryReference}</label>
            <input
              id="introFilePath"
              value={form.introFilePath}
              onChange={(event) => setForm((current) => ({ ...current, introFilePath: event.target.value }))}
              placeholder="D:\\Path\\docs\\project-reference.md"
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="doneProgressFilePath">{text.completedDoc}</label>
            <input
              id="doneProgressFilePath"
              value={form.doneProgressFilePath}
              onChange={(event) => setForm((current) => ({ ...current, doneProgressFilePath: event.target.value }))}
              placeholder={text.optional}
            />
          </div>
          <div className="field">
            <label htmlFor="futureFilePath">{text.futureDoc}</label>
            <input
              id="futureFilePath"
              value={form.futureFilePath}
              onChange={(event) => setForm((current) => ({ ...current, futureFilePath: event.target.value }))}
              placeholder={text.optional}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="implementationPlanFilePath">{text.implementationPlan}</label>
            <input
              id="implementationPlanFilePath"
              value={form.implementationPlanFilePath}
              onChange={(event) =>
                setForm((current) => ({ ...current, implementationPlanFilePath: event.target.value }))
              }
              placeholder={text.optional}
            />
          </div>
          <div className="field">
            <label htmlFor="designBriefFilePath">{text.designBrief}</label>
            <input
              id="designBriefFilePath"
              value={form.designBriefFilePath}
              onChange={(event) => setForm((current) => ({ ...current, designBriefFilePath: event.target.value }))}
              placeholder={text.optional}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="interactionRulesFilePath">{text.interactionRules}</label>
            <input
              id="interactionRulesFilePath"
              value={form.interactionRulesFilePath}
              onChange={(event) =>
                setForm((current) => ({ ...current, interactionRulesFilePath: event.target.value }))
              }
              placeholder={text.optional}
            />
          </div>
          <div className="field">
            <label htmlFor="visualReferencesFilePath">{text.visualReferences}</label>
            <input
              id="visualReferencesFilePath"
              value={form.visualReferencesFilePath}
              onChange={(event) =>
                setForm((current) => ({ ...current, visualReferencesFilePath: event.target.value }))
              }
              placeholder={text.optional}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="referenceDocs">{text.extraDocs}</label>
            <textarea
              id="referenceDocs"
              value={form.referenceDocs}
              onChange={(event) => setForm((current) => ({ ...current, referenceDocs: event.target.value }))}
              placeholder={text.onePathPerLine}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="testCommand">{text.testCommand}</label>
            <input
              id="testCommand"
              value={form.testCommand}
              onChange={(event) => setForm((current) => ({ ...current, testCommand: event.target.value }))}
              placeholder="npm run test"
            />
          </div>
          <div className="field">
            <label htmlFor="buildCommand">{text.buildCommand}</label>
            <input
              id="buildCommand"
              value={form.buildCommand}
              onChange={(event) => setForm((current) => ({ ...current, buildCommand: event.target.value }))}
              placeholder="npm run build"
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="lintCommand">{text.lintCommand}</label>
            <input
              id="lintCommand"
              value={form.lintCommand}
              onChange={(event) => setForm((current) => ({ ...current, lintCommand: event.target.value }))}
              placeholder="npm run lint"
            />
          </div>
          <div className="field">
            <label htmlFor="startCommand">{text.startCommand}</label>
            <input
              id="startCommand"
              value={form.startCommand}
              onChange={(event) => setForm((current) => ({ ...current, startCommand: event.target.value }))}
              placeholder="npm run dev"
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="allowedPaths">{text.allowedPaths}</label>
            <textarea
              id="allowedPaths"
              value={form.allowedPaths}
              onChange={(event) => setForm((current) => ({ ...current, allowedPaths: event.target.value }))}
              placeholder={text.oneRelativePerLine}
            />
          </div>
          <div className="field">
            <label htmlFor="blockedPaths">{text.blockedPaths}</label>
            <textarea
              id="blockedPaths"
              value={form.blockedPaths}
              onChange={(event) => setForm((current) => ({ ...current, blockedPaths: event.target.value }))}
              placeholder=".env\nnode_modules"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="defaultBranch">{text.defaultBranch}</label>
          <input
            id="defaultBranch"
            value={form.defaultBranch}
            onChange={(event) => setForm((current) => ({ ...current, defaultBranch: event.target.value }))}
            placeholder="main"
          />
        </div>
      </section>

      {intakeLogs.length > 0 ? (
        <section className="log-panel">
          <div className="inline-meta">
            <span className="tag">{text.liveLog}</span>
            <span className="tag">{intakeProvider}</span>
            <span className="tag">{intakeModel}</span>
          </div>
          <div className="log-lines">
            {intakeLogs.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="feedback">{feedback}</div>

      <div className="button-row">
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? text.processing : mode === "existing" ? text.confirmImport : text.confirmCreate}
        </button>
      </div>
    </form>
  );
}
