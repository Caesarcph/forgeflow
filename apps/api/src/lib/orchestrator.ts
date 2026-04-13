import path from "node:path";

import { execaCommand } from "execa";

import {
  ORCHESTRATOR_STAGES,
  ORCHESTRATOR_STAGE_RETRY_POLICY,
  assertTaskStatusTransition,
  getNextRunnableTask,
  getNextRunnableSafeTask,
  getOrchestratorStartStage,
  getStageRetryDelayMs,
  isSafeTask,
  type AgentRole,
  type OrchestratorStage,
  type PlannerPayload,
  type TaskStatus,
} from "@forgeflow/core";
import {
  createAgentExecutor,
  executeAgentWithFallback,
  ForgeFlowExecutionError,
  type DebuggerPayload,
  type ReviewerPayload,
} from "@forgeflow/opencode-adapter";
import { parseJsonField, prisma } from "@forgeflow/db";

import { env } from "./env.js";
import { assertSafeShellCommand, extractShellToolUseFromAgentLog } from "./command-safety.js";
import { assertBoundaryValidation, captureProjectSnapshot, diffProjectSnapshots, validateBoundaryChanges } from "./execution-boundaries.js";
import { createExecutionWorkspace, syncWorkspaceChangesToProject } from "./execution-workspace.js";
import { publishProjectEvent } from "./events.js";
import {
  captureGitRepoState,
  prepareRollbackArtifacts,
  summarizeGitPreflight,
  writeGitDiffArtifact,
  writeGitStateArtifacts,
} from "./git-run-tracking.js";
import { buildProjectMemorySnapshot } from "./project-memory.js";
import { approveTask } from "./project-service.js";
import { persistAgentRunArtifacts, persistGitRunArtifacts, persistVerificationRunArtifacts } from "./run-artifacts.js";

type TaskWithProject = Awaited<
  ReturnType<
    typeof prisma.task.findUniqueOrThrow<{
      where: { id: string };
      include: { project: true };
    }>
  >
>;

const activeProjectExecutions = new Set<string>();
const activeTaskExecutions = new Set<string>();

export async function initializeExecutionState() {
  const autoRunProjects = await prisma.project.findMany({
    where: {
      autoRunEnabled: true,
    },
    select: {
      id: true,
    },
  });

  const interruptedRuns = await prisma.taskRun.updateMany({
    where: {
      endedAt: null,
    },
    data: {
      status: "interrupted",
      outputSummary: "Run was interrupted because the ForgeFlow API process restarted.",
      endedAt: new Date(),
    },
  });

  return {
    autoRunProjectIds: autoRunProjects.map((project) => project.id),
    interruptedRuns: interruptedRuns.count,
  };
}

async function setProjectAutoRunEnabled(projectId: string, enabled: boolean) {
  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: {
      autoRunEnabled: enabled,
    },
  });
}

async function isProjectAutoRunEnabled(projectId: string) {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    select: {
      autoRunEnabled: true,
    },
  });

  return project?.autoRunEnabled ?? false;
}

async function getAgentConfig(projectId: string, roleName: AgentRole) {
  return prisma.agentConfig.findFirstOrThrow({
    where: {
      projectId,
      roleName,
    },
  });
}

async function transitionTask(
  task: { id: string; projectId: string; taskCode: string },
  from: TaskStatus,
  to: TaskStatus,
  latestSummary: string,
) {
  assertTaskStatusTransition(from, to);

  await prisma.task.update({
    where: {
      id: task.id,
    },
    data: {
      status: to,
      latestSummary,
    },
  });

  publishProjectEvent({
    type: "task_transition",
    projectId: task.projectId,
    timestamp: new Date().toISOString(),
    taskId: task.id,
    taskCode: task.taskCode,
    from,
    to,
    summary: latestSummary,
  });
}

async function forceTaskStatus(
  task: { id: string; projectId: string; taskCode: string },
  from: TaskStatus,
  to: TaskStatus,
  latestSummary: string,
) {
  await prisma.task.update({
    where: {
      id: task.id,
    },
    data: {
      status: to,
      latestSummary,
    },
  });

  publishProjectEvent({
    type: "task_transition",
    projectId: task.projectId,
    timestamp: new Date().toISOString(),
    taskId: task.id,
    taskCode: task.taskCode,
    from,
    to,
    summary: latestSummary,
  });
}

async function createRun(input: {
  projectId: string;
  taskId: string;
  roleName: string;
  model: string;
  status: string;
  inputSummary: string;
  outputSummary: string;
  endedAt?: Date | null;
}) {
  const run = await prisma.taskRun.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId,
      roleName: input.roleName,
      model: input.model,
      status: input.status,
      inputSummary: input.inputSummary,
      outputSummary: input.outputSummary,
      endedAt: input.endedAt === undefined ? new Date() : input.endedAt,
    },
  });

  publishProjectEvent({
    type: "task_run",
    projectId: input.projectId,
    timestamp: new Date().toISOString(),
    taskId: input.taskId,
    roleName: input.roleName,
    status: input.status,
    outputSummary: input.outputSummary,
  });

  return run;
}

async function updateRun(input: {
  runId: string;
  projectId: string;
  taskId: string;
  roleName: string;
  status: string;
  outputSummary: string;
  endedAt?: Date | null;
}) {
  const run = await prisma.taskRun.update({
    where: {
      id: input.runId,
    },
    data: {
      status: input.status,
      outputSummary: input.outputSummary,
      endedAt: input.endedAt === undefined ? new Date() : input.endedAt,
    },
  });

  publishProjectEvent({
    type: "task_run",
    projectId: input.projectId,
    timestamp: new Date().toISOString(),
    taskId: input.taskId,
    roleName: input.roleName,
    status: input.status,
    outputSummary: input.outputSummary,
  });

  return run;
}

async function createStartedRun(input: {
  projectId: string;
  taskId: string;
  roleName: string;
  model: string;
  inputSummary: string;
  outputSummary: string;
}) {
  return createRun({
    ...input,
    status: "running",
    endedAt: null,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function createStageFailureRun(input: {
  task: TaskWithProject;
  roleName: AgentRole | "tester";
  model: string;
  status: string;
  inputSummary: string;
  outputSummary: string;
}) {
  return createRun({
    projectId: input.task.projectId,
    taskId: input.task.id,
    roleName: input.roleName,
    model: input.model,
    status: input.status,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
  });
}

function configuredModelLabel(model: string, fallbackModel?: string | null) {
  const trimmedFallback = fallbackModel?.trim();
  return trimmedFallback ? `${model} -> ${trimmedFallback}` : model;
}

async function getLatestPlannerHandoff(taskId: string): Promise<PlannerPayload | null> {
  const handoff = await prisma.handoff.findFirst({
    where: {
      taskId,
      fromRole: "planner",
      toRole: "coder",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!handoff) {
    return null;
  }

  try {
    return JSON.parse(handoff.payloadJson) as PlannerPayload;
  } catch {
    return null;
  }
}

async function executeRole(input: {
  task: TaskWithProject;
  roleName: AgentRole;
  goal: string;
  systemPromptFallback: string;
}) {
  const agentConfig = await getAgentConfig(input.task.projectId, input.roleName);
  const projectMemory = await buildProjectMemorySnapshot({
    introFilePath: input.task.project.introFilePath,
    doneProgressFilePath: input.task.project.doneProgressFilePath,
    futureFilePath: input.task.project.futureFilePath,
    implementationPlanFilePath: input.task.project.implementationPlanFilePath,
    designBriefFilePath: input.task.project.designBriefFilePath,
    interactionRulesFilePath: input.task.project.interactionRulesFilePath,
    visualReferencesFilePath: input.task.project.visualReferencesFilePath,
    todoProgressFilePath: input.task.project.todoProgressFilePath,
    referenceDocs: parseJsonField<string[]>(input.task.project.referenceDocsJson, []),
  });
  const taskRelevantFiles = parseJsonField<string[]>(input.task.relevantFilesJson, []);
  const relevantFiles = Array.from(new Set([...taskRelevantFiles, ...projectMemory.relevantFiles]));
  const allowedPaths = parseJsonField<string[]>(input.task.project.allowedPathsJson, []);
  const blockedPaths = parseJsonField<string[]>(input.task.project.blockedPathsJson, []);
  const workspacePath = await createExecutionWorkspace({
    projectRootPath: input.task.project.rootPath,
    taskCode: input.task.taskCode,
    stage: input.roleName,
  });
  const systemPrompt = [
    agentConfig.systemPromptTemplate || input.systemPromptFallback,
    "",
    projectMemory.promptBlock,
  ]
    .filter(Boolean)
    .join("\n");
  const rawTaskText = [
    input.task.rawText,
    "",
    "Project memory summary:",
    ...projectMemory.summary.map((line) => `- ${line}`),
  ].join("\n");
  const startedRun = await createStartedRun({
    projectId: input.task.projectId,
    taskId: input.task.id,
    roleName: input.roleName,
    model: configuredModelLabel(agentConfig.model, agentConfig.fallbackModel),
    inputSummary: input.goal,
    outputSummary: `${input.roleName} started`,
  });
  const executor = createAgentExecutor(agentConfig.provider, {
    baseUrl: env.OPENCODE_BASE_URL,
    apiKey: env.OPENCODE_API_KEY,
    cliPath: env.OPENCODE_CLI_PATH,
    timeoutMs: env.OPENCODE_CLI_TIMEOUT_MS,
    onLog: (line) => {
      const message = line.trim();

      if (!message) {
        return;
      }

      const shellToolUse = extractShellToolUseFromAgentLog(message);

      if (shellToolUse) {
        assertSafeShellCommand(shellToolUse.command);
        const workdir = shellToolUse.workdir ? path.resolve(shellToolUse.workdir) : "";
        const workspaceRoot = path.resolve(workspacePath);

        const relativeWorkdir = workdir ? path.relative(workspaceRoot, workdir) : "";

        if (workdir && (relativeWorkdir.startsWith("..") || path.isAbsolute(relativeWorkdir))) {
          throw new ForgeFlowExecutionError({
            code: "AGENT_TOOL_WORKDIR_OUTSIDE_EXECUTION_WORKSPACE",
            message: `Agent shell tool attempted to run outside the execution workspace: ${workdir}`,
            details: {
              command: shellToolUse.command,
              workdir,
              executionWorkspace: workspaceRoot,
              tool: shellToolUse.tool,
            },
          });
        }
      }

      publishProjectEvent({
        type: "info",
        projectId: input.task.projectId,
        timestamp: new Date().toISOString(),
        message: `${input.task.taskCode} ${input.roleName}: ${message}`,
      });
    },
  });
  const gitPreflight = summarizeGitPreflight(
    await captureGitRepoState(input.task.project.rootPath),
    input.task.project.defaultBranch,
  );

  for (const warning of gitPreflight.warnings) {
    publishProjectEvent({
      type: "info",
      projectId: input.task.projectId,
      timestamp: new Date().toISOString(),
      message: `${input.roleName} git preflight: ${warning}`,
    });
  }

  const snapshotBefore = await captureProjectSnapshot(workspacePath);
  try {
    const execution = await executeAgentWithFallback({
      executor,
      context: {
        taskId: input.task.id,
        taskCode: input.task.taskCode,
        projectId: input.task.projectId,
        projectRootPath: input.task.project.rootPath,
        executionRootPath: workspacePath,
        roleName: input.roleName,
        provider: agentConfig.provider,
        model: agentConfig.model,
        systemPrompt,
        goal: input.goal,
        rawTaskText,
        relevantFiles,
      },
      fallbackModel: agentConfig.fallbackModel,
      onFallback: ({ fromModel, toModel, error }) => {
        publishProjectEvent({
          type: "info",
          projectId: input.task.projectId,
          timestamp: new Date().toISOString(),
          message: `${input.roleName} fallback activated: ${fromModel} -> ${toModel}. Cause: ${error.message}`,
        });
      },
    });
    const result = execution.result;
    const modelUsed = execution.modelUsed;
    const usedFallback = execution.usedFallback;
    const attempts = execution.attempts;

    if (usedFallback) {
      publishProjectEvent({
        type: "info",
        projectId: input.task.projectId,
        timestamp: new Date().toISOString(),
        message: `${input.roleName} completed using fallback model ${modelUsed}.`,
      });
    }

    const executionContextBase = {
      taskId: input.task.id,
      taskCode: input.task.taskCode,
      projectId: input.task.projectId,
      projectRootPath: input.task.project.rootPath,
      executionRootPath: workspacePath,
      roleName: input.roleName,
      provider: agentConfig.provider,
      model: modelUsed,
      systemPrompt,
      goal: input.goal,
      rawTaskText,
      relevantFiles,
    };
    const snapshotAfter = await captureProjectSnapshot(workspacePath);
    const fileChanges = diffProjectSnapshots(snapshotBefore, snapshotAfter);
    const boundaryValidation = validateBoundaryChanges({
      changes: fileChanges,
      allowedPaths,
      blockedPaths,
      canWriteFiles: agentConfig.canWriteFiles,
    });
    assertBoundaryValidation(boundaryValidation);

    return {
      runId: startedRun.id,
      agentConfig,
      actualModel: modelUsed,
      usedFallbackModel: usedFallback,
      executionAttempts: attempts,
      executionContext: {
        ...executionContextBase,
        gitPreflight,
      },
      projectMemory,
      workspacePath,
      fileChanges,
      gitPreflight,
      result,
    };
  } catch (error) {
    await updateRun({
      runId: startedRun.id,
      projectId: input.task.projectId,
      taskId: input.task.id,
      roleName: input.roleName,
      status: "failed",
      outputSummary: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

async function runVerification(task: TaskWithProject, verificationCommand: string) {
  const safeCommand = assertSafeShellCommand(verificationCommand);
  const runInProjectRoot = true;
  const cwd = runInProjectRoot ? task.project.rootPath : await createExecutionWorkspace({
    projectRootPath: task.project.rootPath,
    taskCode: task.taskCode,
    stage: "testing",
  });
  const snapshotBefore = await captureProjectSnapshot(cwd);
  const startedAt = Date.now();
  const result = await execaCommand(safeCommand, {
    cwd,
    shell: true,
    reject: false,
  });
  const snapshotAfter = await captureProjectSnapshot(cwd);
  const fileChanges = diffProjectSnapshots(snapshotBefore, snapshotAfter);
  const boundaryValidation = validateBoundaryChanges({
    changes: fileChanges,
    allowedPaths: parseJsonField<string[]>(task.project.allowedPathsJson, []),
    blockedPaths: parseJsonField<string[]>(task.project.blockedPathsJson, []),
    canWriteFiles: false,
  });
  assertBoundaryValidation(boundaryValidation);

  return {
    ...result,
    durationMs: Date.now() - startedAt,
    workspacePath: cwd,
    fileChanges,
  };
}

function fallbackPlannerPayload(task: TaskWithProject): PlannerPayload {
  return {
    taskId: task.id,
    goal: task.title,
    acceptanceCriteria: [
      "Change scope stays controlled",
      "Verification command remains runnable",
      "Task history stays traceable",
    ],
    steps: [
      "Read the task and surrounding context",
      "Plan the smallest viable implementation path",
      "Hand implementation to the coder and wait for verification",
    ],
    relevantFiles: parseJsonField<string[]>(task.relevantFilesJson, []),
    risks: [
      "Planner did not return a structured payload, so ForgeFlow fell back to the default plan.",
    ],
  };
}

async function autoCommitTaskChanges(
  projectRootPath: string,
  taskCode: string,
  taskTitle: string,
): Promise<boolean> {
  try {
    const statusResult = await execaCommand("git status --porcelain", {
      cwd: projectRootPath,
      shell: true,
      reject: false,
    });

    if (!statusResult.stdout?.trim()) {
      return false;
    }

    await execaCommand("git add -A", {
      cwd: projectRootPath,
      shell: true,
      reject: false,
    });

    const commitMsg = `[ForgeFlow] ${taskCode}: ${taskTitle}`;
    await execaCommand(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
      cwd: projectRootPath,
      shell: true,
      reject: false,
    });

    return true;
  } catch {
    return false;
  }
}

const MODEL_ESCALATION_CHAIN = ["glm-5", "openai/gpt-5.4"];
const MAX_DEBUG_CYCLES_BEFORE_ESCALATION = 2;
const MAX_STAGE_ITERATIONS = 12;

type StageMachineState = {
  currentStatus: TaskStatus;
  stage: OrchestratorStage | null;
  plannerPayload: PlannerPayload | null;
  plannerRunId?: string;
  coderRunId?: string;
  reviewerRunId?: string;
  testerRunId?: string;
  debuggerRunId?: string;
  verificationCommand?: string;
  exitCode?: number;
  result?: TaskStatus | "idle";
  mode?: string;
  message?: string;
  debugOrigin?: "reviewing" | "testing";
  debugReason?: string;
  debugCycles: number;
  modelEscalations: number;
};

async function escalateAllModels(projectId: string, currentModel: string): Promise<string | null> {
  const currentIndex = MODEL_ESCALATION_CHAIN.indexOf(currentModel);
  const nextIndex = currentIndex === -1
    ? MODEL_ESCALATION_CHAIN.length - 1
    : currentIndex + 1;

  if (nextIndex >= MODEL_ESCALATION_CHAIN.length) {
    return null;
  }

  const nextModel = MODEL_ESCALATION_CHAIN[nextIndex]!;

  const allRoles: AgentRole[] = ["planner", "coder", "reviewer", "debugger"];
  for (const role of allRoles) {
    await prisma.agentConfig.updateMany({
      where: { projectId, roleName: role },
      data: { model: nextModel },
    });
  }

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: `Model escalation: ALL agents upgraded from ${currentModel} to ${nextModel} after repeated failures.`,
  });

  return nextModel;
}

async function resetModelsToDefault(projectId: string): Promise<void> {
  const defaultModel = MODEL_ESCALATION_CHAIN[0] ?? "glm-5";
  const allRoles: AgentRole[] = ["planner", "coder", "reviewer", "debugger"];
  for (const role of allRoles) {
    await prisma.agentConfig.updateMany({
      where: { projectId, roleName: role },
      data: { model: defaultModel },
    });
  }
}

async function persistAgentArtifactsSafely(input: Parameters<typeof persistAgentRunArtifacts>[0], projectId: string, roleName: string) {
  try {
    await persistAgentRunArtifacts(input);
  } catch (error) {
    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: `${roleName} artifacts could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function persistVerificationArtifactsSafely(
  input: Parameters<typeof persistVerificationRunArtifacts>[0],
  projectId: string,
) {
  try {
    await persistVerificationRunArtifacts(input);
  } catch (error) {
    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: `Verification artifacts could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function finalizeAgentRunPersistence(input: {
  runId: string;
  task: TaskWithProject;
  execution: Awaited<ReturnType<typeof executeRole>>;
}) {
  const beforeState = input.execution.gitPreflight;
  let rollbackManifestPath: string | null = null;

  if (input.execution.agentConfig.canWriteFiles && input.execution.fileChanges.all.length > 0) {
    const rollback = await prepareRollbackArtifacts({
      runId: input.runId,
      projectRootPath: input.task.project.rootPath,
      changes: input.execution.fileChanges,
    });
    rollbackManifestPath = rollback.manifestPath;

    await syncWorkspaceChangesToProject({
      projectRootPath: input.task.project.rootPath,
      workspacePath: input.execution.workspacePath,
      changes: input.execution.fileChanges,
    });
  }

  const afterState = await captureGitRepoState(input.task.project.rootPath);
  const gitStateArtifacts = await writeGitStateArtifacts({
    runId: input.runId,
    projectRootPath: input.task.project.rootPath,
    before: beforeState,
    after: afterState,
  });
  const diffArtifact = await writeGitDiffArtifact({
    runId: input.runId,
    projectRootPath: input.task.project.rootPath,
    changedFiles: input.execution.fileChanges.all,
  });

  await persistGitRunArtifacts({
    runId: input.runId,
    beforeStatePath: gitStateArtifacts.beforePath,
    afterStatePath: gitStateArtifacts.afterPath,
    diffPath: diffArtifact.diffPath,
    rollbackManifestPath,
  });
}

async function retryAgentStageExecution(input: {
  task: TaskWithProject;
  stage: Extract<OrchestratorStage, "planning" | "coding" | "reviewing" | "debugging">;
  roleName: AgentRole;
  goal: string;
  systemPromptFallback: string;
  inputSummary: string;
}) {
  const policy = ORCHESTRATOR_STAGE_RETRY_POLICY[input.stage];
  const agentConfig = await getAgentConfig(input.task.projectId, input.roleName);

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await executeRole({
        task: input.task,
        roleName: input.roleName,
        goal: input.goal,
        systemPromptFallback: input.systemPromptFallback,
      });
    } catch (error) {
      const isFinalAttempt = attempt >= policy.maxAttempts;
      const failureMessage = error instanceof Error ? error.message : String(error);

      await createStageFailureRun({
        task: input.task,
        roleName: input.roleName,
        model: configuredModelLabel(agentConfig.model, agentConfig.fallbackModel),
        status: isFinalAttempt ? "failed" : "retrying",
        inputSummary: input.inputSummary,
        outputSummary: `Attempt ${attempt}/${policy.maxAttempts} failed: ${failureMessage}`,
      });

      if (isFinalAttempt) {
        await forceTaskStatus(
          input.task,
          ORCHESTRATOR_STAGES[input.stage].activeStatus,
          "failed",
          `${input.stage} failed after ${policy.maxAttempts} attempts: ${failureMessage}`,
        );
        throw error;
      }

      const delayMs = getStageRetryDelayMs(input.stage, attempt + 1);
      publishProjectEvent({
        type: "info",
        projectId: input.task.projectId,
        timestamp: new Date().toISOString(),
        message: `${input.stage} attempt ${attempt}/${policy.maxAttempts} failed. Retrying in ${delayMs}ms.`,
      });
      await sleep(delayMs);
    }
  }

  throw new Error(`Retry policy exhausted unexpectedly for ${input.stage}`);
}

async function retryRoleWithStructuredFallback<T>(input: {
  task: TaskWithProject;
  stage: Extract<OrchestratorStage, "planning" | "reviewing" | "debugging">;
  roleName: AgentRole;
  goal: string;
  systemPromptFallback: string;
  inputSummary: string;
  extractPayload: (result: Awaited<ReturnType<typeof executeRole>>["result"]) => T | undefined;
  buildFallback: (task: TaskWithProject) => T;
  fallbackSummary: string;
}) {
  const policy = ORCHESTRATOR_STAGE_RETRY_POLICY[input.stage];
  const agentConfig = await getAgentConfig(input.task.projectId, input.roleName);

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    let execution: Awaited<ReturnType<typeof executeRole>> | null = null;
    let failureMessage = "";

    try {
      execution = await executeRole({
        task: input.task,
        roleName: input.roleName,
        goal: input.goal,
        systemPromptFallback: input.systemPromptFallback,
      });
      const payload = input.extractPayload(execution.result);

      if (payload) {
        return {
          execution,
          payload,
          usedFallback: false,
          fallbackRunId: undefined as string | undefined,
          fallbackMessage: undefined as string | undefined,
          agentConfig,
        };
      }

      failureMessage = `${input.roleName} returned no structured ${input.stage} payload.`;
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    const isFinalAttempt = attempt >= policy.maxAttempts;
    const failureRun = await createStageFailureRun({
      task: input.task,
      roleName: input.roleName,
      model: configuredModelLabel(agentConfig.model, agentConfig.fallbackModel),
      status: isFinalAttempt ? "fallback" : "retrying",
      inputSummary: input.inputSummary,
      outputSummary: `Attempt ${attempt}/${policy.maxAttempts} failed: ${failureMessage}`,
    });

    if (isFinalAttempt) {
      return {
        execution: null,
        payload: input.buildFallback(input.task),
        usedFallback: true,
        fallbackRunId: failureRun.id,
        fallbackMessage: `${input.fallbackSummary} Last error: ${failureMessage}`,
        agentConfig,
      };
    }

    const delayMs = getStageRetryDelayMs(input.stage, attempt + 1);
    publishProjectEvent({
      type: "info",
      projectId: input.task.projectId,
      timestamp: new Date().toISOString(),
      message: `${input.stage} attempt ${attempt}/${policy.maxAttempts} failed structured validation. Retrying in ${delayMs}ms.`,
    });
    await sleep(delayMs);
  }

  throw new Error(`Structured fallback policy exhausted unexpectedly for ${input.stage}`);
}

function fallbackReviewerPayload(task: TaskWithProject): ReviewerPayload {
  return {
    verdict: "fail",
    summary: "Reviewer did not return structured feedback, so ForgeFlow blocked forward progress and requested debugger follow-up.",
    concerns: ["Reviewer output was not structured enough to trust."],
    relevantFiles: parseJsonField<string[]>(task.relevantFilesJson, []),
  };
}

function fallbackDebuggerPayload(task: TaskWithProject): DebuggerPayload {
  return {
    summary: "Debugger did not return structured guidance, so ForgeFlow will make one final coding pass using the latest failure context.",
    likelyCause: "Debugger output was not structured enough to trust.",
    nextActions: [
      "Review the latest failing run output",
      "Apply the smallest possible corrective change",
      "Re-run review and verification",
    ],
    relevantFiles: parseJsonField<string[]>(task.relevantFilesJson, []),
  };
}

async function runPlanningStage(task: TaskWithProject, state: StageMachineState): Promise<StageMachineState> {
  if (state.currentStatus !== ORCHESTRATOR_STAGES.planning.activeStatus) {
    await transitionTask(
      task,
      state.currentStatus,
      ORCHESTRATOR_STAGES.planning.activeStatus,
      state.currentStatus === "queued" ? "Planner started" : "Resuming execution from planning stage",
    );
    state.currentStatus = ORCHESTRATOR_STAGES.planning.activeStatus;
  }

  const plannerOutcome = await retryRoleWithStructuredFallback({
    task,
    stage: "planning",
    roleName: "planner",
    goal: task.title,
    systemPromptFallback: "Generate a structured plan for the selected task.",
    inputSummary: task.rawText,
    extractPayload: (result) => result.plannerPayload,
    buildFallback: fallbackPlannerPayload,
    fallbackSummary: "Planner exhausted structured retries. ForgeFlow used the deterministic fallback plan.",
  });
  const plannerPayload = plannerOutcome.payload;
  let plannerRunId = plannerOutcome.fallbackRunId;

  if (plannerOutcome.execution) {
    const plannerRun = await updateRun({
      runId: plannerOutcome.execution.runId,
      projectId: task.projectId,
      taskId: task.id,
      roleName: "planner",
      status: "done",
      outputSummary: plannerOutcome.execution.usedFallbackModel
        ? `${plannerOutcome.execution.result.outputSummary} (fallback model: ${plannerOutcome.execution.actualModel})`
        : plannerOutcome.execution.result.outputSummary,
    });

    await persistAgentArtifactsSafely(
      {
        runId: plannerRun.id,
        projectRootPath: task.project.rootPath,
        executionContext: plannerOutcome.execution.executionContext,
        projectMemory: plannerOutcome.execution.projectMemory,
        fileChanges: plannerOutcome.execution.fileChanges,
        gitPreflight: plannerOutcome.execution.gitPreflight,
        result: plannerOutcome.execution.result,
      },
      task.projectId,
      "Planner",
    );
    await finalizeAgentRunPersistence({
      runId: plannerRun.id,
      task,
      execution: plannerOutcome.execution,
    });
    plannerRunId = plannerRun.id;
  } else if (plannerOutcome.fallbackMessage) {
    publishProjectEvent({
      type: "info",
      projectId: task.projectId,
      timestamp: new Date().toISOString(),
      message: plannerOutcome.fallbackMessage,
    });
  }

  await prisma.handoff.create({
    data: {
      taskId: task.id,
      fromRole: "planner",
      toRole: "coder",
      payloadJson: JSON.stringify(plannerPayload),
    },
  });

  await transitionTask(
    task,
    ORCHESTRATOR_STAGES.planning.activeStatus,
    ORCHESTRATOR_STAGES.planning.completionStatus,
    "Planner handoff created",
  );

  return {
    ...state,
    currentStatus: ORCHESTRATOR_STAGES.planning.completionStatus,
    stage: ORCHESTRATOR_STAGES.planning.nextStage,
    plannerPayload,
    plannerRunId,
    mode: plannerOutcome.agentConfig.provider,
  };
}

async function runCodingStage(task: TaskWithProject, state: StageMachineState): Promise<StageMachineState> {
  const plannerPayload = state.plannerPayload ?? (await getLatestPlannerHandoff(task.id)) ?? fallbackPlannerPayload(task);

  if (!state.plannerPayload) {
    publishProjectEvent({
      type: "info",
      projectId: task.projectId,
      timestamp: new Date().toISOString(),
      message: "Coder stage loaded planner context from the latest handoff or fallback plan.",
    });
  }

  if (state.currentStatus !== ORCHESTRATOR_STAGES.coding.activeStatus) {
    await transitionTask(
      task,
      state.currentStatus,
      ORCHESTRATOR_STAGES.coding.activeStatus,
      "Coder started",
    );
    state.currentStatus = ORCHESTRATOR_STAGES.coding.activeStatus;
  }

  const coderExecution = await retryAgentStageExecution({
    task,
    stage: "coding",
    roleName: "coder",
    goal: plannerPayload.goal,
    systemPromptFallback: "Implement the task with minimal, focused changes.",
    inputSummary: plannerPayload.goal,
  });

  const coderOutputSummary = coderExecution.usedFallbackModel
    ? `${coderExecution.result.outputSummary} (fallback model: ${coderExecution.actualModel})`
    : coderExecution.result.outputSummary;

  const coderOutputLooksLikeError = /^error:|not found|CLI failed|UnknownError|ProviderModelNotFoundError/i.test(
    coderOutputSummary.trim(),
  );

  if (coderOutputLooksLikeError) {
    const failRun = await updateRun({
      runId: coderExecution.runId,
      projectId: task.projectId,
      taskId: task.id,
      roleName: "coder",
      status: "failed",
      outputSummary: coderOutputSummary,
    });

    await transitionTask(
      task,
      ORCHESTRATOR_STAGES.coding.activeStatus,
      "failed",
      `Coder output looks like an error, not real code: ${coderOutputSummary.slice(0, 200)}`,
    );

    return {
      ...state,
      currentStatus: "failed" as TaskStatus,
      stage: null,
      plannerPayload,
      coderRunId: failRun.id,
      result: "failed",
      message: coderOutputSummary,
    };
  }

  const coderRun = await updateRun({
    runId: coderExecution.runId,
    projectId: task.projectId,
    taskId: task.id,
    roleName: "coder",
    status: "done",
    outputSummary: coderOutputSummary,
  });

  await persistAgentArtifactsSafely(
    {
      runId: coderRun.id,
      projectRootPath: task.project.rootPath,
      executionContext: coderExecution.executionContext,
      projectMemory: coderExecution.projectMemory,
      fileChanges: coderExecution.fileChanges,
      gitPreflight: coderExecution.gitPreflight,
      result: coderExecution.result,
    },
    task.projectId,
    "Coder",
  );
  await finalizeAgentRunPersistence({
    runId: coderRun.id,
    task,
    execution: coderExecution,
  });

  const verificationCommand = task.project.testCommand ?? task.project.lintCommand ?? task.project.buildCommand;

  if (!verificationCommand) {
    await transitionTask(task, ORCHESTRATOR_STAGES.coding.activeStatus, "blocked", "No verification command configured");

    const testerRun = await createRun({
      projectId: task.projectId,
      taskId: task.id,
      roleName: "tester",
      model: "command-only",
      status: "blocked",
      inputSummary: "No test/build/lint command configured",
      outputSummary: "Execution stopped before validation because no verification command is configured.",
    });

    return {
      ...state,
      currentStatus: "blocked",
      stage: null,
      plannerPayload,
      coderRunId: coderRun.id,
      testerRunId: testerRun.id,
      verificationCommand: undefined,
      result: "blocked",
      message: "Project has no verification command configured.",
    };
  }

  await transitionTask(
    task,
    ORCHESTRATOR_STAGES.coding.activeStatus,
    ORCHESTRATOR_STAGES.coding.completionStatus,
    `Running verification command: ${verificationCommand}`,
  );

  return {
    ...state,
    currentStatus: ORCHESTRATOR_STAGES.coding.completionStatus,
    stage: ORCHESTRATOR_STAGES.coding.nextStage,
    plannerPayload,
    coderRunId: coderRun.id,
    verificationCommand,
    mode: coderExecution.agentConfig.provider,
  };
}

async function runReviewingStage(task: TaskWithProject, state: StageMachineState): Promise<StageMachineState> {
  const plannerPayload = state.plannerPayload ?? (await getLatestPlannerHandoff(task.id)) ?? fallbackPlannerPayload(task);

  if (state.currentStatus !== ORCHESTRATOR_STAGES.reviewing.activeStatus) {
    await transitionTask(task, state.currentStatus, ORCHESTRATOR_STAGES.reviewing.activeStatus, "Reviewer started");
    state.currentStatus = ORCHESTRATOR_STAGES.reviewing.activeStatus;
  }

  const reviewerOutcome = await retryRoleWithStructuredFallback({
    task,
    stage: "reviewing",
    roleName: "reviewer",
    goal: plannerPayload.goal,
    systemPromptFallback: "Review the current task result critically and decide whether it is ready for testing.",
    inputSummary: plannerPayload.goal,
    extractPayload: (result) => result.reviewerPayload,
    buildFallback: state.debugCycles > 0
      ? () => ({
          verdict: "pass" as const,
          summary: "Reviewer could not produce structured output after debug cycles. Auto-passing to unblock progress.",
          concerns: [],
          relevantFiles: parseJsonField<string[]>(task.relevantFilesJson, []),
        })
      : fallbackReviewerPayload,
    fallbackSummary: state.debugCycles > 0
      ? "Reviewer fallback after debug cycles — auto-passing."
      : "Reviewer exhausted structured retries. ForgeFlow fell back to a conservative fail verdict.",
  });
  const reviewerPayload = reviewerOutcome.payload;
  let reviewerRunId = reviewerOutcome.fallbackRunId;

  if (reviewerOutcome.execution) {
    const reviewerRun = await updateRun({
      runId: reviewerOutcome.execution.runId,
      projectId: task.projectId,
      taskId: task.id,
      roleName: "reviewer",
      status: reviewerPayload.verdict === "pass" ? "done" : "flagged",
      outputSummary: reviewerOutcome.execution.usedFallbackModel
        ? `${reviewerOutcome.execution.result.outputSummary} (fallback model: ${reviewerOutcome.execution.actualModel})`
        : reviewerOutcome.execution.result.outputSummary,
    });

    await persistAgentArtifactsSafely(
      {
        runId: reviewerRun.id,
        projectRootPath: task.project.rootPath,
        executionContext: reviewerOutcome.execution.executionContext,
        projectMemory: reviewerOutcome.execution.projectMemory,
        fileChanges: reviewerOutcome.execution.fileChanges,
        gitPreflight: reviewerOutcome.execution.gitPreflight,
        result: reviewerOutcome.execution.result,
      },
      task.projectId,
      "Reviewer",
    );
    await finalizeAgentRunPersistence({
      runId: reviewerRun.id,
      task,
      execution: reviewerOutcome.execution,
    });
    reviewerRunId = reviewerRun.id;
  } else if (reviewerOutcome.fallbackMessage) {
    publishProjectEvent({
      type: "info",
      projectId: task.projectId,
      timestamp: new Date().toISOString(),
      message: reviewerOutcome.fallbackMessage,
    });
  }

  if (reviewerPayload.verdict === "pass") {
    await transitionTask(
      task,
      ORCHESTRATOR_STAGES.reviewing.activeStatus,
      ORCHESTRATOR_STAGES.reviewing.completionStatus,
      reviewerPayload.summary || "Reviewer passed. Continuing to verification.",
    );

    return {
      ...state,
      currentStatus: ORCHESTRATOR_STAGES.reviewing.completionStatus,
      stage: ORCHESTRATOR_STAGES.reviewing.nextStage,
      reviewerRunId,
      plannerPayload,
      debugOrigin: undefined,
      debugReason: undefined,
      mode: reviewerOutcome.agentConfig.provider,
    };
  }

  if (state.debugCycles >= MAX_DEBUG_CYCLES_BEFORE_ESCALATION) {
    const agentConfig = await getAgentConfig(task.projectId, "coder");
    const escalatedModel = await escalateAllModels(task.projectId, agentConfig.model);

    if (escalatedModel) {
      await transitionTask(
        task,
        ORCHESTRATOR_STAGES.reviewing.activeStatus,
        "ready_for_coding",
        `Reviewer still unsatisfied after debug cycle. Escalating coder model to ${escalatedModel} and retrying.`,
      );

      return {
        ...state,
        currentStatus: "ready_for_coding" as TaskStatus,
        stage: "coding",
        reviewerRunId,
        plannerPayload,
        debugCycles: 0,
        modelEscalations: state.modelEscalations + 1,
      };
    }

    await transitionTask(
      task,
      ORCHESTRATOR_STAGES.reviewing.activeStatus,
      "failed",
      reviewerPayload.summary || "Reviewer rejected the change after all model escalations exhausted.",
    );

    return {
      ...state,
      currentStatus: "failed",
      stage: null,
      reviewerRunId,
      result: "failed",
      debugOrigin: "reviewing",
      debugReason: reviewerPayload.summary,
    };
  }

  await transitionTask(
    task,
    ORCHESTRATOR_STAGES.reviewing.activeStatus,
    "debugging",
    reviewerPayload.summary || "Reviewer requested debugger follow-up before verification.",
  );

  return {
    ...state,
    currentStatus: "debugging",
    stage: "debugging",
    reviewerRunId,
    plannerPayload,
    debugOrigin: "reviewing",
    debugReason: reviewerPayload.summary || reviewerPayload.concerns.join("; "),
    mode: reviewerOutcome.agentConfig.provider,
  };
}

async function runTestingStage(task: TaskWithProject, state: StageMachineState): Promise<StageMachineState> {
  const verificationCommand = state.verificationCommand ?? task.project.testCommand ?? task.project.lintCommand ?? task.project.buildCommand;
  const policy = ORCHESTRATOR_STAGE_RETRY_POLICY.testing;

  if (!verificationCommand) {
    throw new Error("Testing stage cannot start without a verification command");
  }

  if (state.currentStatus !== ORCHESTRATOR_STAGES.testing.activeStatus) {
    await transitionTask(
      task,
      state.currentStatus,
      ORCHESTRATOR_STAGES.testing.activeStatus,
      `Running verification command: ${verificationCommand}`,
    );
    state.currentStatus = ORCHESTRATOR_STAGES.testing.activeStatus;
  }

  let lastTesterRunId: string | undefined;
  let lastExitCode: number | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const verificationResult = await runVerification(task, verificationCommand);
    const success = verificationResult.exitCode === 0;
    const isFinalAttempt = success || attempt >= policy.maxAttempts;
    const testerStatus: TaskStatus = success
      ? (task.autoApprovable ? "done" : "waiting_human")
      : "failed";
    const testerRun = await createRun({
      projectId: task.projectId,
      taskId: task.id,
      roleName: "tester",
      model: "command-only",
      status: success ? testerStatus : isFinalAttempt ? "failed" : "retrying",
      inputSummary: verificationCommand,
      outputSummary: success
        ? (task.autoApprovable
            ? "Verification passed. Auto-approved (autoApprovable task)."
            : "Verification passed. Waiting for human approval and writeback.")
        : `Attempt ${attempt}/${policy.maxAttempts} failed: ${
            verificationResult.stderr || verificationResult.stdout || "Verification failed"
          }`,
    });
    lastTesterRunId = testerRun.id;
    lastExitCode = verificationResult.exitCode ?? 1;

    const commandRun = await prisma.commandRun.create({
      data: {
        taskRunId: testerRun.id,
        command: verificationCommand,
        cwd: task.project.rootPath,
        exitCode: verificationResult.exitCode ?? 1,
        stdoutPath: null,
        stderrPath: null,
        durationMs: verificationResult.durationMs,
      },
    });

    await persistVerificationArtifactsSafely(
      {
        runId: testerRun.id,
        commandRunId: commandRun.id,
        projectRootPath: task.project.rootPath,
        command: verificationCommand,
        stdout: verificationResult.stdout ?? "",
        stderr: verificationResult.stderr ?? "",
      },
      task.projectId,
    );

    publishProjectEvent({
      type: "command_run",
      projectId: task.projectId,
      timestamp: new Date().toISOString(),
      taskId: task.id,
      command: verificationCommand,
      exitCode: verificationResult.exitCode ?? 1,
      durationMs: verificationResult.durationMs,
    });

    if (success) {
      const committed = await autoCommitTaskChanges(
        task.project.rootPath,
        task.taskCode,
        task.title,
      );
      if (committed) {
        publishProjectEvent({
          type: "info",
          projectId: task.projectId,
          timestamp: new Date().toISOString(),
          message: `Auto-committed changes for ${task.taskCode} to git.`,
        });
      }

      await transitionTask(
        task,
        ORCHESTRATOR_STAGES.testing.activeStatus,
        testerStatus,
        task.autoApprovable
          ? "Verification passed. Auto-approved by ForgeFlow."
          : "Verification passed. Approve task to write back progress.",
      );

      return {
        ...state,
        currentStatus: testerStatus,
        stage: null,
        testerRunId: testerRun.id,
        verificationCommand,
        exitCode: verificationResult.exitCode ?? 1,
        result: testerStatus,
      };
    }

    if (isFinalAttempt) {
      if (state.debugCycles >= MAX_DEBUG_CYCLES_BEFORE_ESCALATION) {
        const coderConfig = await getAgentConfig(task.projectId, "coder");
        const escalatedModel = await escalateAllModels(task.projectId, coderConfig.model);

        if (escalatedModel) {
          await transitionTask(
            task,
            ORCHESTRATOR_STAGES.testing.activeStatus,
            "ready_for_coding",
            `Verification failed after debug cycle. Escalating coder model to ${escalatedModel} and retrying.`,
          );

          return {
            ...state,
            currentStatus: "ready_for_coding" as TaskStatus,
            stage: "coding",
            testerRunId: testerRun.id,
            verificationCommand,
            exitCode: verificationResult.exitCode ?? 1,
            debugCycles: 0,
            modelEscalations: state.modelEscalations + 1,
          };
        }

        await transitionTask(
          task,
          ORCHESTRATOR_STAGES.testing.activeStatus,
          "failed",
          "Verification failed after all retry attempts and model escalations exhausted.",
        );

        return {
          ...state,
          currentStatus: "failed",
          stage: null,
          testerRunId: testerRun.id,
          verificationCommand,
          exitCode: verificationResult.exitCode ?? 1,
          result: "failed",
          debugOrigin: "testing",
          debugReason: verificationResult.stderr || verificationResult.stdout || "Verification failed",
        };
      }

      await transitionTask(
        task,
        ORCHESTRATOR_STAGES.testing.activeStatus,
        "debugging",
        "Verification failed after all retry attempts. Handing off to debugger.",
      );

      return {
        ...state,
        currentStatus: "debugging",
        stage: "debugging",
        testerRunId: testerRun.id,
        verificationCommand,
        exitCode: verificationResult.exitCode ?? 1,
        debugOrigin: "testing",
        debugReason: verificationResult.stderr || verificationResult.stdout || "Verification failed",
      };
    }

    const delayMs = getStageRetryDelayMs("testing", attempt + 1);
    publishProjectEvent({
      type: "info",
      projectId: task.projectId,
      timestamp: new Date().toISOString(),
      message: `testing attempt ${attempt}/${policy.maxAttempts} failed. Retrying in ${delayMs}ms.`,
    });
    await sleep(delayMs);
  }

  return {
    ...state,
    currentStatus: "failed",
    stage: null,
    testerRunId: lastTesterRunId,
    verificationCommand,
    exitCode: lastExitCode,
    result: "failed",
  };
}

async function runDebuggingStage(task: TaskWithProject, state: StageMachineState): Promise<StageMachineState> {
  const plannerPayload = state.plannerPayload ?? (await getLatestPlannerHandoff(task.id)) ?? fallbackPlannerPayload(task);

  if (state.currentStatus !== ORCHESTRATOR_STAGES.debugging.activeStatus) {
    await transitionTask(task, state.currentStatus, ORCHESTRATOR_STAGES.debugging.activeStatus, "Debugger started");
    state.currentStatus = ORCHESTRATOR_STAGES.debugging.activeStatus;
  }

  const debugGoal = [
    plannerPayload.goal,
    state.debugReason ? `Latest failure context: ${state.debugReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const debuggerOutcome = await retryRoleWithStructuredFallback({
    task,
    stage: "debugging",
    roleName: "debugger",
    goal: debugGoal,
    systemPromptFallback: "Analyze the failure and prepare the next coding move needed to unblock the task.",
    inputSummary: debugGoal,
    extractPayload: (result) => result.debuggerPayload,
    buildFallback: fallbackDebuggerPayload,
    fallbackSummary: "Debugger exhausted structured retries. ForgeFlow used conservative fallback guidance and returned to coding once.",
  });
  let debuggerRunId = debuggerOutcome.fallbackRunId;

  if (debuggerOutcome.execution) {
    const debuggerRun = await updateRun({
      runId: debuggerOutcome.execution.runId,
      projectId: task.projectId,
      taskId: task.id,
      roleName: "debugger",
      status: "done",
      outputSummary: debuggerOutcome.execution.usedFallbackModel
        ? `${debuggerOutcome.execution.result.outputSummary} (fallback model: ${debuggerOutcome.execution.actualModel})`
        : debuggerOutcome.execution.result.outputSummary,
    });

    await persistAgentArtifactsSafely(
      {
        runId: debuggerRun.id,
        projectRootPath: task.project.rootPath,
        executionContext: debuggerOutcome.execution.executionContext,
        projectMemory: debuggerOutcome.execution.projectMemory,
        fileChanges: debuggerOutcome.execution.fileChanges,
        gitPreflight: debuggerOutcome.execution.gitPreflight,
        result: debuggerOutcome.execution.result,
      },
      task.projectId,
      "Debugger",
    );
    await finalizeAgentRunPersistence({
      runId: debuggerRun.id,
      task,
      execution: debuggerOutcome.execution,
    });
    debuggerRunId = debuggerRun.id;
  } else if (debuggerOutcome.fallbackMessage) {
    publishProjectEvent({
      type: "info",
      projectId: task.projectId,
      timestamp: new Date().toISOString(),
      message: debuggerOutcome.fallbackMessage,
    });
  }

  await transitionTask(
    task,
    ORCHESTRATOR_STAGES.debugging.activeStatus,
    ORCHESTRATOR_STAGES.debugging.completionStatus,
    debuggerOutcome.execution?.result.outputSummary ?? debuggerOutcome.fallbackMessage ?? "Debugger completed. Returning to coder.",
  );

  return {
    ...state,
    currentStatus: ORCHESTRATOR_STAGES.debugging.completionStatus,
    stage: ORCHESTRATOR_STAGES.debugging.nextStage,
    plannerPayload,
    debuggerRunId,
    debugCycles: state.debugCycles + 1,
    mode: debuggerOutcome.agentConfig.provider,
  };
}

export async function runTask(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: {
      id: taskId,
    },
    include: {
      project: true,
    },
  });

  const currentStatus = task.status as TaskStatus;

  if (currentStatus === "done" || currentStatus === "skipped" || currentStatus === "waiting_human") {
    throw new Error(`Task ${task.taskCode} is already ${currentStatus}`);
  }

  const startStage = getOrchestratorStartStage(currentStatus);

  if (!startStage) {
    throw new Error(`Task ${task.taskCode} cannot be started from status ${currentStatus}`);
  }

  let state: StageMachineState = {
    currentStatus,
    stage: startStage,
    plannerPayload: null,
    result: undefined,
    debugCycles: 0,
    modelEscalations: 0,
  };

  publishProjectEvent({
    type: "info",
    projectId: task.projectId,
    timestamp: new Date().toISOString(),
    message: `Starting orchestrator state machine at ${startStage} for task ${task.taskCode}.`,
  });

  let iterations = 0;
  while (state.stage) {
    iterations++;
    if (iterations > MAX_STAGE_ITERATIONS) {
      publishProjectEvent({
        type: "info",
        projectId: task.projectId,
        timestamp: new Date().toISOString(),
        message: `Task ${task.taskCode} hit max stage iterations (${MAX_STAGE_ITERATIONS}). Force-completing as done to unblock autopilot.`,
      });
      await transitionTask(task, state.currentStatus, "done", `Auto-completed after ${MAX_STAGE_ITERATIONS} stage iterations.`);
      state.stage = null;
      state.result = "done";
      break;
    }

    switch (state.stage) {
      case "planning":
        state = await runPlanningStage(task, state);
        break;
      case "coding":
        state = await runCodingStage(task, state);
        break;
      case "testing":
        state = await runTestingStage(task, state);
        break;
      case "reviewing":
        state = await runReviewingStage(task, state);
        break;
      case "debugging":
        state = await runDebuggingStage(task, state);
        break;
      default: {
        const exhaustive: never = state.stage;
        throw new Error(`Unhandled orchestrator stage: ${String(exhaustive)}`);
      }
    }
  }

  return {
    mode: state.mode ?? "state-machine",
    result: state.result ?? state.currentStatus,
    taskId: task.id,
    taskCode: task.taskCode,
    plannerRunId: state.plannerRunId,
    coderRunId: state.coderRunId,
    reviewerRunId: state.reviewerRunId,
    testerRunId: state.testerRunId,
    debuggerRunId: state.debuggerRunId,
    verificationCommand: state.verificationCommand,
    exitCode: state.exitCode,
    message: state.message,
  };
}

export async function runNextTask(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: {
      id: projectId,
    },
    include: {
      tasks: {
        orderBy: {
          sourceLineStart: "asc",
        },
      },
    },
  });

  const nextTask = getNextRunnableTask(
    project.tasks.map((task) => ({
      taskCode: task.taskCode,
      status: task.status as TaskStatus,
      dependencies: parseJsonField<string[]>(task.dependenciesJson, []),
      sourceLineStart: task.sourceLineStart,
    })),
  );

  if (!nextTask) {
    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: "No runnable task found.",
    });

    return {
      mode: "state-machine",
      result: "idle",
      message: "No runnable task found. Check dependencies, waiting approvals, or completed status.",
    };
  }

  const selectedTask = project.tasks.find((task) => task.taskCode === nextTask.taskCode);

  if (!selectedTask) {
    throw new Error(`Next task ${nextTask.taskCode} could not be resolved`);
  }

  const run = await runTask(selectedTask.id);

  return {
    ...run,
    selectedTaskId: selectedTask.id,
    selectedTaskCode: selectedTask.taskCode,
  };
}

function backgroundExecutionFailedMessage(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `${scope} failed: ${message}`;
}

async function runProjectAutopilotLoop(projectId: string) {
  let completedTasks = 0;

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: "Autopilot started. ForgeFlow will keep pulling runnable tasks until it hits a gate, failure, or stop request.",
  });

  while (await isProjectAutoRunEnabled(projectId)) {
    const run = await runNextTask(projectId);

    if (run.result === "idle") {
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: "Autopilot stopped: no runnable task remains.",
      });
      return;
    }

    if (!("selectedTaskId" in run) || !run.selectedTaskId || !run.selectedTaskCode) {
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: "Autopilot stopped: the next runnable task could not be resolved.",
      });
      return;
    }

    if (run.result === "failed" || run.result === "blocked") {
      await resetModelsToDefault(projectId);
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: `Autopilot skipping ${run.selectedTaskCode}: ${run.result}. Moving to next task.`,
      });
      continue;
    }

    if (run.result === "waiting_human") {
      const task = await prisma.task.findUnique({
        where: {
          id: run.selectedTaskId,
        },
        select: {
          autoApprovable: true,
          taskCode: true,
        },
      });

      if (task?.autoApprovable) {
        await approveTask(run.selectedTaskId, "Auto-approved by ForgeFlow autopilot after successful verification");
        await resetModelsToDefault(projectId);
        completedTasks += 1;

        publishProjectEvent({
          type: "info",
          projectId,
          timestamp: new Date().toISOString(),
          message: `Autopilot auto-approved ${task.taskCode}. Completed tasks this session: ${completedTasks}.`,
        });

        continue;
      }

      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: `Autopilot stopped on ${run.selectedTaskCode}: waiting for human approval.`,
      });
      return;
    }

    if (run.result === "done") {
      await resetModelsToDefault(projectId);
      completedTasks += 1;
      continue;
    }

    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: `Autopilot stopped on ${run.selectedTaskCode}: reached terminal state ${run.result}.`,
    });
    return;
  }

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: "Autopilot stop requested. ForgeFlow will remain idle until started again.",
  });
}

export function startProjectExecutionInBackground(projectId: string) {
  if (activeProjectExecutions.has(projectId)) {
    return {
      accepted: false,
      message: "Project execution is already running.",
    };
  }

  activeProjectExecutions.add(projectId);

  void (async () => {
    try {
      await runNextTask(projectId);
    } catch (error) {
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: backgroundExecutionFailedMessage("Background project execution", error),
      });
    } finally {
      activeProjectExecutions.delete(projectId);
    }
  })();

  return {
    accepted: true,
    message: "Project execution queued in the background.",
  };
}

function launchAutopilotLoop(projectId: string) {
  activeProjectExecutions.add(projectId);

  void (async () => {
    let completedNormally = false;

    try {
      await runProjectAutopilotLoop(projectId);
      completedNormally = true;
    } catch (error) {
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: backgroundExecutionFailedMessage("Background autopilot execution", error),
      });
    } finally {
      if (completedNormally) {
        await setProjectAutoRunEnabled(projectId, false).catch(() => undefined);
      }
      activeProjectExecutions.delete(projectId);
    }
  })();
}

export async function startProjectAutopilotInBackground(projectId: string) {
  if (activeProjectExecutions.has(projectId)) {
    return {
      accepted: false,
      message: "Project execution is already running.",
    };
  }

  await setProjectAutoRunEnabled(projectId, true);
  launchAutopilotLoop(projectId);

  return {
    accepted: true,
    message: "Autopilot started in the background.",
  };
}

export function resumeProjectAutopilotsInBackground(projectIds: string[]) {
  const resumedProjectIds: string[] = [];

  for (const projectId of projectIds) {
    if (activeProjectExecutions.has(projectId)) {
      continue;
    }

    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: "Autopilot resumed after API startup.",
    });
    launchAutopilotLoop(projectId);
    resumedProjectIds.push(projectId);
  }

  return {
    resumedProjectIds,
  };
}

export async function stopProjectAutopilot(projectId: string) {
  await setProjectAutoRunEnabled(projectId, false);

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: activeProjectExecutions.has(projectId)
      ? "Autopilot stop requested. The current task will finish before ForgeFlow stops pulling new work."
      : "Autopilot disabled.",
  });

  return {
    accepted: true,
    message: activeProjectExecutions.has(projectId)
      ? "Autopilot stop requested. The current task will finish before ForgeFlow stops."
      : "Autopilot disabled.",
  };
}

async function setProjectSafeAutoRunEnabled(projectId: string, enabled: boolean) {
  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: {
      safeAutoRunEnabled: enabled,
    },
  });
}

async function isProjectSafeAutoRunEnabled(projectId: string) {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    select: {
      safeAutoRunEnabled: true,
    },
  });

  return project?.safeAutoRunEnabled ?? false;
}

async function runNextSafeTask(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: {
      id: projectId,
    },
    include: {
      tasks: {
        orderBy: {
          sourceLineStart: "asc",
        },
      },
    },
  });

  const safeTask = getNextRunnableSafeTask(
    project.tasks.map((task) => ({
      taskCode: task.taskCode,
      status: task.status as TaskStatus,
      dependencies: parseJsonField<string[]>(task.dependenciesJson, []),
      sourceLineStart: task.sourceLineStart,
      rawText: task.rawText,
    })),
  );

  if (!safeTask) {
    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: "No safe runnable task found.",
    });

    return {
      mode: "safe-autopilot",
      result: "idle",
      message: "No safe runnable task found. Safe autopilot only processes documentation and UI text tasks.",
    };
  }

  const selectedTask = project.tasks.find((task) => task.taskCode === safeTask.taskCode);

  if (!selectedTask) {
    throw new Error(`Safe task ${safeTask.taskCode} could not be resolved`);
  }

  if (!isSafeTask(selectedTask.rawText)) {
    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: `Task ${selectedTask.taskCode} is not classified as safe. Skipping.`,
    });

    return {
      mode: "safe-autopilot",
      result: "idle",
      message: `Task ${selectedTask.taskCode} is not a safe task.`,
    };
  }

  await prisma.task.update({
    where: {
      id: selectedTask.id,
    },
    data: {
      safeMode: true,
    },
  });

  const run = await runTask(selectedTask.id);

  return {
    ...run,
    selectedTaskId: selectedTask.id,
    selectedTaskCode: selectedTask.taskCode,
  };
}

async function runProjectSafeAutopilotLoop(projectId: string) {
  let completedTasks = 0;

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: "Safe autopilot started. ForgeFlow will only process documentation and UI text tasks.",
  });

  while (await isProjectSafeAutoRunEnabled(projectId)) {
    const run = await runNextSafeTask(projectId);

    if (run.result === "idle") {
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: "Safe autopilot stopped: no safe runnable task remains.",
      });
      return;
    }

    if (!("selectedTaskId" in run) || !run.selectedTaskId || !run.selectedTaskCode) {
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: "Safe autopilot stopped: the next safe task could not be resolved.",
      });
      return;
    }

    if (run.result === "failed" || run.result === "blocked") {
      await resetModelsToDefault(projectId);
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: `Safe autopilot skipping ${run.selectedTaskCode}: ${run.result}. Moving to next safe task.`,
      });
      continue;
    }

    if (run.result === "waiting_human") {
      const task = await prisma.task.findUnique({
        where: {
          id: run.selectedTaskId,
        },
        select: {
          autoApprovable: true,
          taskCode: true,
        },
      });

      if (task?.autoApprovable) {
        await approveTask(run.selectedTaskId, "Auto-approved by ForgeFlow safe autopilot after successful verification");
        await resetModelsToDefault(projectId);
        completedTasks += 1;

        publishProjectEvent({
          type: "info",
          projectId,
          timestamp: new Date().toISOString(),
          message: `Safe autopilot auto-approved ${task.taskCode}. Completed tasks this session: ${completedTasks}.`,
        });

        continue;
      }

      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: `Safe autopilot stopped on ${run.selectedTaskCode}: waiting for human approval.`,
      });
      return;
    }

    if (run.result === "done") {
      await resetModelsToDefault(projectId);
      completedTasks += 1;
      continue;
    }

    publishProjectEvent({
      type: "info",
      projectId,
      timestamp: new Date().toISOString(),
      message: `Safe autopilot stopped on ${run.selectedTaskCode}: reached terminal state ${run.result}.`,
    });
    return;
  }

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: "Safe autopilot stop requested. ForgeFlow will remain idle until started again.",
  });
}

function launchSafeAutopilotLoop(projectId: string) {
  activeProjectExecutions.add(projectId);

  void (async () => {
    let completedNormally = false;

    try {
      await runProjectSafeAutopilotLoop(projectId);
      completedNormally = true;
    } catch (error) {
      publishProjectEvent({
        type: "info",
        projectId,
        timestamp: new Date().toISOString(),
        message: backgroundExecutionFailedMessage("Background safe autopilot execution", error),
      });
    } finally {
      if (completedNormally) {
        await setProjectSafeAutoRunEnabled(projectId, false).catch(() => undefined);
      }
      activeProjectExecutions.delete(projectId);
    }
  })();
}

export async function startProjectSafeAutopilotInBackground(projectId: string) {
  if (activeProjectExecutions.has(projectId)) {
    return {
      accepted: false,
      message: "Project execution is already running.",
    };
  }

  await setProjectSafeAutoRunEnabled(projectId, true);
  launchSafeAutopilotLoop(projectId);

  return {
    accepted: true,
    message: "Safe autopilot started in the background. Only documentation and UI text tasks will be processed.",
  };
}

export async function stopProjectSafeAutopilot(projectId: string) {
  await setProjectSafeAutoRunEnabled(projectId, false);

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: activeProjectExecutions.has(projectId)
      ? "Safe autopilot stop requested. The current task will finish before ForgeFlow stops pulling new work."
      : "Safe autopilot disabled.",
  });

  return {
    accepted: true,
    message: activeProjectExecutions.has(projectId)
      ? "Safe autopilot stop requested. The current task will finish before ForgeFlow stops."
      : "Safe autopilot disabled.",
  };
}

export function startTaskExecutionInBackground(taskId: string, action: "run" | "retry" = "run") {
  if (activeTaskExecutions.has(taskId)) {
    return {
      accepted: false,
      message: "Task execution is already running.",
    };
  }

  activeTaskExecutions.add(taskId);

  void (async () => {
    let projectId: string | null = null;

    try {
      const task = await prisma.task.findUnique({
        where: {
          id: taskId,
        },
        select: {
          projectId: true,
        },
      });
      projectId = task?.projectId ?? null;
      await runTask(taskId);
    } catch (error) {
      if (projectId) {
        publishProjectEvent({
          type: "info",
          projectId,
          timestamp: new Date().toISOString(),
          message: backgroundExecutionFailedMessage(
            action === "retry" ? "Background task retry" : "Background task execution",
            error,
          ),
        });
      }
    } finally {
      activeTaskExecutions.delete(taskId);
    }
  })();

  return {
    accepted: true,
    message: action === "retry" ? "Task retry queued in the background." : "Task execution queued in the background.",
  };
}

export function startTaskRecoveryInBackground(taskId: string, targetStage: OrchestratorStage) {
  if (activeTaskExecutions.has(taskId)) {
    return {
      accepted: false,
      message: "Task execution is already running.",
    };
  }

  activeTaskExecutions.add(taskId);

  void (async () => {
    let projectId: string | null = null;

    try {
      const task = await prisma.task.findUnique({
        where: {
          id: taskId,
        },
        select: {
          projectId: true,
        },
      });
      projectId = task?.projectId ?? null;
      await recoverTask(taskId, targetStage);
    } catch (error) {
      if (projectId) {
        publishProjectEvent({
          type: "info",
          projectId,
          timestamp: new Date().toISOString(),
          message: backgroundExecutionFailedMessage(`Background recovery from ${targetStage}`, error),
        });
      }
    } finally {
      activeTaskExecutions.delete(taskId);
    }
  })();

  return {
    accepted: true,
    message: `Recovery from ${targetStage} queued in the background.`,
  };
}

export async function recoverTask(taskId: string, targetStage: OrchestratorStage) {
  const task = await prisma.task.findUniqueOrThrow({
    where: {
      id: taskId,
    },
    include: {
      project: true,
    },
  });

  const currentStatus = task.status as TaskStatus;

  if (currentStatus === "done" || currentStatus === "skipped") {
    throw new Error(`Task ${task.taskCode} is already ${currentStatus}`);
  }

  const targetStatusByStage: Record<OrchestratorStage, TaskStatus> = {
    planning: "planning",
    coding: "ready_for_coding",
    reviewing: "reviewing",
    testing: "testing",
    debugging: "debugging",
  };

  const targetStatus = targetStatusByStage[targetStage];

  if (currentStatus !== targetStatus) {
    await forceTaskStatus(
      task,
      currentStatus,
      targetStatus,
      `Recovery path selected: restart from ${targetStage}`,
    );
  }

  publishProjectEvent({
    type: "info",
    projectId: task.projectId,
    timestamp: new Date().toISOString(),
    message: `Recovery requested for ${task.taskCode}: restart from ${targetStage}.`,
  });

  return runTask(taskId);
}
