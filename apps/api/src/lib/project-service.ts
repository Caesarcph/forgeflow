import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DEFAULT_AGENT_ROLES,
  assertTaskStatusTransition,
  getNextRunnableTask,
  getProjectStatus,
  getTaskCounts,
  type ParsedTask,
  type TaskStatus,
} from "@forgeflow/core";
import { prisma, parseJsonField, stringifyJsonField } from "@forgeflow/db";
import { defaultPrompts } from "@forgeflow/prompts";
import { updateCheckboxInFile } from "@forgeflow/task-writeback";
import { z } from "zod";

import { publishProjectEvent } from "./events.js";
import { readRollbackManifest, restoreRollbackManifest } from "./git-run-tracking.js";
import {
  buildProjectMemorySnapshot,
  normalizeProjectMemorySnapshot,
  serializeProjectMemorySnapshot,
} from "./project-memory.js";
import { hydrateRunArtifacts } from "./run-artifacts.js";
import { resolveTaskSourceFile } from "./task-source.js";

const projectInputSchema = z.object({
  name: z.string().min(1),
  projectType: z.enum(["greenfield", "existing"]).optional().default("greenfield"),
  rootPath: z.string().min(1),
  intakeEngine: z.enum(["opencode", "heuristic", "heuristic-fallback"]).optional(),
  introFilePath: z.string().optional().or(z.literal("")),
  doneProgressFilePath: z.string().optional().or(z.literal("")),
  futureFilePath: z.string().optional().or(z.literal("")),
  implementationPlanFilePath: z.string().optional().or(z.literal("")),
  designBriefFilePath: z.string().optional().or(z.literal("")),
  interactionRulesFilePath: z.string().optional().or(z.literal("")),
  visualReferencesFilePath: z.string().optional().or(z.literal("")),
  referenceDocs: z.array(z.string()).default([]),
  todoProgressFilePath: z.string().min(1),
  buildCommand: z.string().optional().or(z.literal("")),
  testCommand: z.string().optional().or(z.literal("")),
  lintCommand: z.string().optional().or(z.literal("")),
  startCommand: z.string().optional().or(z.literal("")),
  allowedPaths: z.array(z.string()).default([]),
  blockedPaths: z.array(z.string()).default([]),
  defaultBranch: z.string().optional().or(z.literal("")),
  autoRunEnabled: z.boolean().optional().default(false),
  bootstrapFiles: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .default([]),
});

const agentRoleSchema = z.enum(["planner", "coder", "reviewer", "tester", "debugger"]);

const agentConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  fallbackModel: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  canWriteFiles: z.boolean().optional(),
  canRunCommands: z.boolean().optional(),
  systemPromptTemplate: z.string().min(1).optional(),
});

const projectMemoryUpdateSchema = z.object({
  summary: z.array(z.string()).default([]),
  sources: z
    .array(
      z.object({
        kind: z.enum([
          "primary",
          "completed",
          "future",
          "plan",
          "todo",
          "reference",
          "design_brief",
          "interaction_rules",
          "visual_references",
        ]),
        label: z.string().min(1),
        path: z.string().min(1),
        snippet: z.string(),
      }),
    )
    .default([]),
});

async function assertPathExists(filePath: string, label: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

function normalizeOptionalString(value?: string): string | null {
  return value?.trim() ? value.trim() : null;
}

const DEFAULT_AGENT_CONFIGS: Record<string, { provider: string; model: string }> = {
  planner:  { provider: "nvidia", model: "glm-5" },
  coder:    { provider: "nvidia", model: "glm-5" },
  reviewer: { provider: "nvidia", model: "glm-5" },
  tester:   { provider: "nvidia", model: "glm-5" },
  debugger: { provider: "nvidia", model: "glm-5" },
};

function defaultAgentConfig(roleName: string) {
  const basePrompt =
    defaultPrompts[roleName as keyof typeof defaultPrompts] ?? "Role prompt is not configured yet.";
  const defaults = DEFAULT_AGENT_CONFIGS[roleName] ?? { provider: "nvidia", model: "glm-5" };

  return {
    roleName,
    enabled: true,
    provider: defaults.provider,
    model: defaults.model,
    fallbackModel: null,
    temperature: roleName === "planner" ? 0.1 : 0.2,
    maxTokens: 9999999999,
    canWriteFiles: true,
    canRunCommands: true,
    systemPromptTemplate: basePrompt,
  };
}

function serializeTask(task: {
  id: string;
  taskCode: string;
  title: string;
  section: string | null;
  subsection: string | null;
  rawText: string;
  sourceFilePath: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  status: string;
  taskType: string;
  autoApprovable: boolean;
  acceptanceCriteriaJson: string | null;
  dependenciesJson: string | null;
  relevantFilesJson: string | null;
  latestSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: task.id,
    taskCode: task.taskCode,
    title: task.title,
    section: task.section,
    subsection: task.subsection,
    rawText: task.rawText,
    sourceFilePath: task.sourceFilePath,
    sourceLineStart: task.sourceLineStart,
    sourceLineEnd: task.sourceLineEnd,
    status: task.status,
    taskType: task.taskType,
    autoApprovable: task.autoApprovable,
    acceptanceCriteria: parseJsonField<string[]>(task.acceptanceCriteriaJson, []),
    dependencies: parseJsonField<string[]>(task.dependenciesJson, []),
    relevantFiles: parseJsonField<string[]>(task.relevantFilesJson, []),
    latestSummary: task.latestSummary,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function serializeRun(run: {
  id: string;
  taskId: string | null;
  task?: {
    taskCode: string;
    title: string;
  } | null;
  roleName: string;
  model: string;
  status: string;
  inputSummary: string;
  outputSummary: string;
  startedAt: Date;
  endedAt: Date | null;
  commandRuns?: Array<{
    id: string;
    command: string;
    cwd: string;
    exitCode: number;
    durationMs: number;
    stdoutPath: string | null;
    stderrPath: string | null;
  }>;
}) {
  return {
    id: run.id,
    taskId: run.taskId,
    taskCode: run.task?.taskCode ?? null,
    taskTitle: run.task?.title ?? null,
    roleName: run.roleName,
    model: run.model,
    status: run.status,
    inputSummary: run.inputSummary,
    outputSummary: run.outputSummary,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    commandRuns:
      run.commandRuns?.map((commandRun) => ({
        id: commandRun.id,
        command: commandRun.command,
        cwd: commandRun.cwd,
        exitCode: commandRun.exitCode,
        durationMs: commandRun.durationMs,
        stdoutPath: commandRun.stdoutPath,
        stderrPath: commandRun.stderrPath,
      })) ?? [],
  };
}

function serializeProject(project: {
  id: string;
  name: string;
  projectType: string;
  rootPath: string;
  intakeEngine: string | null;
  introFilePath: string | null;
  doneProgressFilePath: string | null;
  futureFilePath: string | null;
  implementationPlanFilePath: string | null;
  designBriefFilePath: string | null;
  interactionRulesFilePath: string | null;
  visualReferencesFilePath: string | null;
  referenceDocsJson: string | null;
  todoProgressFilePath: string;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  startCommand: string | null;
  allowedPathsJson: string | null;
  blockedPathsJson: string | null;
  defaultBranch: string | null;
  autoRunEnabled: boolean;
  safeAutoRunEnabled: boolean;
  memoryUpdatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: project.id,
    name: project.name,
    projectType: project.projectType,
    rootPath: project.rootPath,
    intakeEngine: project.intakeEngine,
    introFilePath: project.introFilePath,
    doneProgressFilePath: project.doneProgressFilePath,
    futureFilePath: project.futureFilePath,
    implementationPlanFilePath: project.implementationPlanFilePath,
    designBriefFilePath: project.designBriefFilePath,
    interactionRulesFilePath: project.interactionRulesFilePath,
    visualReferencesFilePath: project.visualReferencesFilePath,
    referenceDocs: parseJsonField<string[]>(project.referenceDocsJson, []),
    todoProgressFilePath: project.todoProgressFilePath,
    buildCommand: project.buildCommand,
    testCommand: project.testCommand,
    lintCommand: project.lintCommand,
    startCommand: project.startCommand,
    allowedPaths: parseJsonField<string[]>(project.allowedPathsJson, []),
    blockedPaths: parseJsonField<string[]>(project.blockedPathsJson, []),
    defaultBranch: project.defaultBranch,
    autoRunEnabled: project.autoRunEnabled,
    safeAutoRunEnabled: project.safeAutoRunEnabled,
    memoryUpdatedAt: project.memoryUpdatedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function serializeAgent(agent: {
  id: string;
  roleName: string;
  enabled: boolean;
  provider: string;
  model: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number | bigint;
  canWriteFiles: boolean;
  canRunCommands: boolean;
  systemPromptTemplate: string;
}) {
  return {
    id: agent.id,
    roleName: agent.roleName,
    enabled: agent.enabled,
    provider: agent.provider,
    model: agent.model,
    fallbackModel: agent.fallbackModel,
    temperature: agent.temperature,
    maxTokens: Number(agent.maxTokens),
    canWriteFiles: agent.canWriteFiles,
    canRunCommands: agent.canRunCommands,
    systemPromptTemplate: agent.systemPromptTemplate,
  };
}

export async function parseTasksFromProject(todoProgressFilePath: string): Promise<ParsedTask[]> {
  const resolvedTaskSource = await resolveTaskSourceFile(todoProgressFilePath);
  return resolvedTaskSource.parsedTasks;
}

export async function createProject(rawInput: unknown) {
  const input = projectInputSchema.parse(rawInput);
  const requestedTodoProgressFilePath = input.todoProgressFilePath.trim();
  const resolvedTaskSource = await resolveTaskSourceFile(requestedTodoProgressFilePath);
  const referenceDocs = input.referenceDocs.map((entry) => entry.trim()).filter(Boolean);
  const bootstrapFiles = input.bootstrapFiles
    .map((file) => ({
      path: file.path.trim(),
      content: file.content,
    }))
    .filter((file) => file.path);

  if (bootstrapFiles.length > 0) {
    const resolvedRootPath = path.resolve(input.rootPath);
    await fs.mkdir(resolvedRootPath, { recursive: true });

    for (const file of bootstrapFiles) {
      const resolvedFilePath = path.resolve(file.path);

      if (!(resolvedFilePath === resolvedRootPath || resolvedFilePath.startsWith(`${resolvedRootPath}${path.sep}`))) {
        throw new Error(`Bootstrap file must stay inside project root: ${file.path}`);
      }

      try {
        await fs.access(resolvedFilePath);
        throw new Error(`Bootstrap target already exists: ${file.path}`);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("Bootstrap target already exists")) {
          await fs.mkdir(path.dirname(resolvedFilePath), { recursive: true });
          await fs.writeFile(resolvedFilePath, file.content, "utf8");
        } else {
          throw error;
        }
      }
    }
  }

  await assertPathExists(input.rootPath, "Project root path");
  await assertPathExists(requestedTodoProgressFilePath, "Todo progress file");

  if (input.introFilePath?.trim()) {
    await assertPathExists(input.introFilePath, "Intro file");
  }

  if (input.doneProgressFilePath?.trim()) {
    await assertPathExists(input.doneProgressFilePath, "Done progress file");
  }

  if (input.futureFilePath?.trim()) {
    await assertPathExists(input.futureFilePath, "Future features file");
  }

  if (input.implementationPlanFilePath?.trim()) {
    await assertPathExists(input.implementationPlanFilePath, "Implementation plan file");
  }

  if (input.designBriefFilePath?.trim()) {
    await assertPathExists(input.designBriefFilePath, "Design brief file");
  }

  if (input.interactionRulesFilePath?.trim()) {
    await assertPathExists(input.interactionRulesFilePath, "Interaction rules file");
  }

  if (input.visualReferencesFilePath?.trim()) {
    await assertPathExists(input.visualReferencesFilePath, "Visual references file");
  }

  for (const [index, referenceDoc] of referenceDocs.entries()) {
    await assertPathExists(referenceDoc, `Reference doc #${index + 1}`);
  }

  if (
    resolvedTaskSource.viaLinkedDoc &&
    !referenceDocs.includes(requestedTodoProgressFilePath) &&
    requestedTodoProgressFilePath !== resolvedTaskSource.resolvedFilePath
  ) {
    referenceDocs.push(requestedTodoProgressFilePath);
  }

  const project = await prisma.project.create({
    data: {
      name: input.name.trim(),
      projectType: input.projectType,
      rootPath: input.rootPath.trim(),
      intakeEngine: input.intakeEngine ?? null,
      introFilePath: normalizeOptionalString(input.introFilePath),
      doneProgressFilePath: normalizeOptionalString(input.doneProgressFilePath),
      futureFilePath: normalizeOptionalString(input.futureFilePath),
      implementationPlanFilePath: normalizeOptionalString(input.implementationPlanFilePath),
      designBriefFilePath: normalizeOptionalString(input.designBriefFilePath),
      interactionRulesFilePath: normalizeOptionalString(input.interactionRulesFilePath),
      visualReferencesFilePath: normalizeOptionalString(input.visualReferencesFilePath),
      referenceDocsJson: stringifyJsonField(referenceDocs),
      todoProgressFilePath: resolvedTaskSource.resolvedFilePath,
      buildCommand: normalizeOptionalString(input.buildCommand),
      testCommand: normalizeOptionalString(input.testCommand),
      lintCommand: normalizeOptionalString(input.lintCommand),
      startCommand: normalizeOptionalString(input.startCommand),
      allowedPathsJson: stringifyJsonField(input.allowedPaths),
      blockedPathsJson: stringifyJsonField(input.blockedPaths),
      defaultBranch: normalizeOptionalString(input.defaultBranch),
      autoRunEnabled: input.autoRunEnabled ?? false,
    },
  });

  await prisma.agentConfig.createMany({
    data: DEFAULT_AGENT_ROLES.map((roleName) => ({
      ...defaultAgentConfig(roleName),
      projectId: project.id,
    })),
  });

  const parsedTasks = resolvedTaskSource.parsedTasks;

  if (parsedTasks.length > 0) {
    await prisma.task.createMany({
      data: parsedTasks.map((task) => ({
        projectId: project.id,
        taskCode: task.taskCode,
        title: task.title,
        section: task.section,
        subsection: task.subsection,
        rawText: task.rawText,
        sourceFilePath: task.sourceFilePath,
        sourceLineStart: task.sourceLineStart,
        sourceLineEnd: task.sourceLineEnd,
        status: task.status,
        taskType: task.taskType,
        autoApprovable: task.autoApprovable,
        acceptanceCriteriaJson: stringifyJsonField(task.acceptanceCriteria),
        dependenciesJson: stringifyJsonField(task.dependencies),
        relevantFilesJson: stringifyJsonField(task.relevantFiles),
        latestSummary: null,
      })),
    });
  }

  const initialMemory = await buildProjectMemorySnapshot({
    introFilePath: project.introFilePath,
    doneProgressFilePath: project.doneProgressFilePath,
    futureFilePath: project.futureFilePath,
    implementationPlanFilePath: project.implementationPlanFilePath,
    designBriefFilePath: project.designBriefFilePath,
    interactionRulesFilePath: project.interactionRulesFilePath,
    visualReferencesFilePath: project.visualReferencesFilePath,
    todoProgressFilePath: project.todoProgressFilePath,
    referenceDocs,
  });

  await prisma.project.update({
    where: {
      id: project.id,
    },
    data: serializeProjectMemorySnapshot(initialMemory),
  });

  return getProjectDetail(project.id);
}

export async function listProjects() {
  const projects = await prisma.project.findMany({
    include: {
      tasks: {
        select: {
          status: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return projects.map((project) => {
    const taskStatuses = project.tasks.map((task) => task.status as TaskStatus);
    const counts = getTaskCounts(taskStatuses);

    return {
      id: project.id,
      name: project.name,
      projectType: project.projectType,
      rootPath: project.rootPath,
      intakeEngine: project.intakeEngine,
      status: getProjectStatus(taskStatuses),
      totalTasks: project.tasks.length,
      doneTasks: counts.done,
      failedTasks: counts.failed,
      waitingHumanTasks: counts.waiting_human,
      activeTasks:
        counts.planning + counts.ready_for_coding + counts.coding + counts.reviewing + counts.testing + counts.debugging,
      updatedAt: project.updatedAt.toISOString(),
    };
  });
}

export async function getProjectDetail(projectId: string) {
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
      agentConfigs: {
        orderBy: {
          roleName: "asc",
        },
      },
      taskRuns: {
        orderBy: {
          startedAt: "desc",
        },
        take: 10,
        include: {
          task: {
            select: {
              taskCode: true,
              title: true,
            },
          },
          commandRuns: {
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      },
    },
  });

  const serializedTasks = project.tasks.map(serializeTask);
  const taskStatuses = serializedTasks.map((task) => task.status as TaskStatus);
  const counts = getTaskCounts(taskStatuses);
  const nextTask = getNextRunnableTask(
    serializedTasks.map((task) => ({
      taskCode: task.taskCode,
      status: task.status as TaskStatus,
      dependencies: task.dependencies,
      sourceLineStart: task.sourceLineStart,
    })),
  );
  const serializedProject = serializeProject(project);
  const persistedMemoryProject = project as typeof project & {
    memorySummaryJson?: string | null;
    memorySourcesJson?: string | null;
    memoryPromptBlock?: string | null;
    memoryRelevantFilesJson?: string | null;
  };
  const memory = await buildProjectMemorySnapshot({
    introFilePath: project.introFilePath,
    doneProgressFilePath: project.doneProgressFilePath,
    futureFilePath: project.futureFilePath,
    implementationPlanFilePath: project.implementationPlanFilePath,
    designBriefFilePath: project.designBriefFilePath,
    interactionRulesFilePath: project.interactionRulesFilePath,
    visualReferencesFilePath: project.visualReferencesFilePath,
    todoProgressFilePath: project.todoProgressFilePath,
    referenceDocs: serializedProject.referenceDocs,
    memorySummaryJson: persistedMemoryProject.memorySummaryJson ?? null,
    memorySourcesJson: persistedMemoryProject.memorySourcesJson ?? null,
    memoryPromptBlock: persistedMemoryProject.memoryPromptBlock ?? null,
    memoryRelevantFilesJson: persistedMemoryProject.memoryRelevantFilesJson ?? null,
  });

  return {
    project: serializedProject,
    summary: {
      status: getProjectStatus(taskStatuses),
      counts,
      nextTaskCode: nextTask?.taskCode ?? null,
    },
    memory,
    tasks: serializedTasks,
    agents: project.agentConfigs.map(serializeAgent),
    runs: project.taskRuns.map(serializeRun),
  };
}

export async function getProjectRuns(projectId: string) {
  const runs = await prisma.taskRun.findMany({
    where: {
      projectId,
    },
    orderBy: {
      startedAt: "desc",
    },
    include: {
      task: {
        select: {
          taskCode: true,
          title: true,
        },
      },
      commandRuns: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  return runs.map(serializeRun);
}

export async function getRunDetail(runId: string) {
  const run = await prisma.taskRun.findUniqueOrThrow({
    where: {
      id: runId,
    },
    include: {
      task: {
        select: {
          taskCode: true,
          title: true,
        },
      },
      commandRuns: {
        orderBy: {
          createdAt: "desc",
        },
      },
      artifacts: {
        orderBy: {
          createdAt: "asc",
        },
      },
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const artifacts = await hydrateRunArtifacts({
    fullOutputPath: run.fullOutputPath,
    diffPath: run.diffPath,
    commandRuns: run.commandRuns.map((commandRun) => ({
      id: commandRun.id,
      stdoutPath: commandRun.stdoutPath,
      stderrPath: commandRun.stderrPath,
    })),
    artifacts: run.artifacts,
  });
  const serializedRun = serializeRun(run);
  const commandLogsById = new Map(artifacts.commandLogs.map((entry) => [entry.commandRunId, entry]));

  return {
    ...serializedRun,
    commandRuns: serializedRun.commandRuns.map((commandRun) => {
      const log = commandLogsById.get(commandRun.id);

      return {
        ...commandRun,
        stdout: log?.stdout ?? null,
        stderr: log?.stderr ?? null,
      };
    }),
    project: run.project,
    rawOutput: artifacts.rawOutput,
    gitDiff: artifacts.gitDiff,
    gitStateBefore: artifacts.gitStateBefore,
    gitStateAfter: artifacts.gitStateAfter,
    executionContext: artifacts.executionContext,
    artifacts: artifacts.artifacts,
    rollbackAvailable: artifacts.rollbackAvailable,
  };
}

export async function rollbackRun(runId: string) {
  const run = await prisma.taskRun.findUniqueOrThrow({
    where: {
      id: runId,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      task: {
        select: {
          id: true,
          taskCode: true,
        },
      },
      artifacts: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  const rollbackArtifact = run.artifacts.find((artifact) => artifact.artifactType === "rollback_manifest");

  if (!rollbackArtifact) {
    throw new Error("This run does not have rollback data.");
  }

  const manifest = await readRollbackManifest(rollbackArtifact.filePath);
  await restoreRollbackManifest(manifest);

  publishProjectEvent({
    type: "info",
    projectId: run.projectId,
    timestamp: new Date().toISOString(),
    message: `Run ${run.id} was rolled back${run.task?.taskCode ? ` for task ${run.task.taskCode}` : ""}.`,
  });

  return getRunDetail(runId);
}

export async function updateProjectMemory(projectId: string, rawInput: unknown) {
  const input = projectMemoryUpdateSchema.parse(rawInput);
  const snapshot = normalizeProjectMemorySnapshot(input);

  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: serializeProjectMemorySnapshot(snapshot),
  });

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: `Project memory was manually updated with ${snapshot.sources.length} persisted sources.`,
  });

  return {
    memory: snapshot,
  };
}

export async function rebuildProjectMemory(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: {
      id: projectId,
    },
  });

  const snapshot = await buildProjectMemorySnapshot({
    introFilePath: project.introFilePath,
    doneProgressFilePath: project.doneProgressFilePath,
    futureFilePath: project.futureFilePath,
    implementationPlanFilePath: project.implementationPlanFilePath,
    designBriefFilePath: project.designBriefFilePath,
    interactionRulesFilePath: project.interactionRulesFilePath,
    visualReferencesFilePath: project.visualReferencesFilePath,
    todoProgressFilePath: project.todoProgressFilePath,
    referenceDocs: parseJsonField<string[]>(project.referenceDocsJson, []),
  }, {
    preferPersisted: false,
  });

  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: serializeProjectMemorySnapshot(snapshot),
  });

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: `Project memory was rebuilt from source documents.`,
  });

  return {
    memory: snapshot,
  };
}

export async function listAgentConfigs(projectId: string) {
  const agents = await prisma.agentConfig.findMany({
    where: {
      projectId,
    },
    orderBy: {
      roleName: "asc",
    },
  });

  return agents.map(serializeAgent);
}

export async function updateAgentConfig(projectId: string, roleName: string, rawInput: unknown) {
  const parsedRole = agentRoleSchema.parse(roleName);
  const input = agentConfigUpdateSchema.parse(rawInput);

  const updated = await prisma.agentConfig.update({
    where: {
      id: (
        await prisma.agentConfig.findFirstOrThrow({
          where: {
            projectId,
            roleName: parsedRole,
          },
        })
      ).id,
    },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.provider !== undefined ? { provider: input.provider.trim() } : {}),
      ...(input.model !== undefined ? { model: input.model.trim() } : {}),
      ...(input.fallbackModel !== undefined
        ? { fallbackModel: input.fallbackModel?.trim() ? input.fallbackModel.trim() : null }
        : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.canWriteFiles !== undefined ? { canWriteFiles: input.canWriteFiles } : {}),
      ...(input.canRunCommands !== undefined ? { canRunCommands: input.canRunCommands } : {}),
      ...(input.systemPromptTemplate !== undefined
        ? { systemPromptTemplate: input.systemPromptTemplate.trim() }
        : {}),
    },
  });

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: `Agent config updated for ${parsedRole}: ${updated.provider} / ${updated.model}`,
  });

  return serializeAgent(updated);
}

export async function reparseProject(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: {
      id: projectId,
    },
  });

  const resolvedTaskSource = await resolveTaskSourceFile(project.todoProgressFilePath);
  const parsedTasks = resolvedTaskSource.parsedTasks;

  if (resolvedTaskSource.resolvedFilePath !== project.todoProgressFilePath) {
    await prisma.project.update({
      where: {
        id: projectId,
      },
      data: {
        todoProgressFilePath: resolvedTaskSource.resolvedFilePath,
      },
    });
  }

  await prisma.task.deleteMany({
    where: {
      projectId,
    },
  });

  if (parsedTasks.length > 0) {
    await prisma.task.createMany({
      data: parsedTasks.map((task) => ({
        projectId,
        taskCode: task.taskCode,
        title: task.title,
        section: task.section,
        subsection: task.subsection,
        rawText: task.rawText,
        sourceFilePath: task.sourceFilePath,
        sourceLineStart: task.sourceLineStart,
        sourceLineEnd: task.sourceLineEnd,
        status: task.status,
        taskType: task.taskType,
        autoApprovable: task.autoApprovable,
        acceptanceCriteriaJson: stringifyJsonField(task.acceptanceCriteria),
        dependenciesJson: stringifyJsonField(task.dependencies),
        relevantFilesJson: stringifyJsonField(task.relevantFiles),
      })),
    });
  }

  return getProjectDetail(projectId);
}

export async function writebackTask(taskId: string, summary?: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: {
      id: taskId,
    },
    include: {
      project: true,
    },
  });

  await updateCheckboxInFile({
    filePath: task.sourceFilePath,
    lineNumber: task.sourceLineStart,
    checked: true,
    summary,
  });

  await prisma.task.update({
    where: {
      id: taskId,
    },
    data: {
      status: "done",
      latestSummary: summary ?? "Marked done via manual writeback",
    },
  });

  publishProjectEvent({
    type: "info",
    projectId: task.projectId,
    timestamp: new Date().toISOString(),
    message: `Task ${task.taskCode} was manually written back.`,
  });

  return getProjectDetail(task.projectId);
}

export async function approveTask(taskId: string, summary?: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: {
      id: taskId,
    },
    include: {
      project: true,
    },
  });

  const currentStatus = task.status as TaskStatus;

  if (currentStatus === "done") {
    return getProjectDetail(task.projectId);
  }

  assertTaskStatusTransition(currentStatus, "done");

  await updateCheckboxInFile({
    filePath: task.sourceFilePath,
    lineNumber: task.sourceLineStart,
    checked: true,
    summary,
  });

  await prisma.task.update({
    where: {
      id: taskId,
    },
    data: {
      status: "done",
      latestSummary: summary ?? "Approved by user and written back to progress file",
    },
  });

  publishProjectEvent({
    type: "info",
    projectId: task.projectId,
    timestamp: new Date().toISOString(),
    message: `Task ${task.taskCode} was approved and written back.`,
  });

  return getProjectDetail(task.projectId);
}

const projectConfigUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  introFilePath: z.string().optional().nullable(),
  doneProgressFilePath: z.string().optional().nullable(),
  futureFilePath: z.string().optional().nullable(),
  implementationPlanFilePath: z.string().optional().nullable(),
  designBriefFilePath: z.string().optional().nullable(),
  interactionRulesFilePath: z.string().optional().nullable(),
  visualReferencesFilePath: z.string().optional().nullable(),
  referenceDocs: z.array(z.string()).optional(),
  todoProgressFilePath: z.string().min(1).optional(),
  buildCommand: z.string().optional().nullable(),
  testCommand: z.string().optional().nullable(),
  lintCommand: z.string().optional().nullable(),
  startCommand: z.string().optional().nullable(),
  allowedPaths: z.array(z.string()).optional(),
  blockedPaths: z.array(z.string()).optional(),
  defaultBranch: z.string().optional().nullable(),
  autoRunEnabled: z.boolean().optional(),
});

export async function updateProjectConfig(projectId: string, rawInput: unknown) {
  const input = projectConfigUpdateSchema.parse(rawInput);
  const project = await prisma.project.findUniqueOrThrow({
    where: {
      id: projectId,
    },
  });

  const updateData: Record<string, unknown> = {};
  let reparsedTasks: ParsedTask[] | null = null;

  if (input.name !== undefined) {
    updateData.name = input.name.trim();
  }

  if (input.introFilePath !== undefined) {
    const value = input.introFilePath?.trim() ?? null;
    if (value) {
      await assertPathExists(value, "Intro file");
    }
    updateData.introFilePath = value;
  }

  if (input.doneProgressFilePath !== undefined) {
    const value = input.doneProgressFilePath?.trim() ?? null;
    if (value) {
      await assertPathExists(value, "Done progress file");
    }
    updateData.doneProgressFilePath = value;
  }

  if (input.futureFilePath !== undefined) {
    const value = input.futureFilePath?.trim() ?? null;
    if (value) {
      await assertPathExists(value, "Future features file");
    }
    updateData.futureFilePath = value;
  }

  if (input.implementationPlanFilePath !== undefined) {
    const value = input.implementationPlanFilePath?.trim() ?? null;
    if (value) {
      await assertPathExists(value, "Implementation plan file");
    }
    updateData.implementationPlanFilePath = value;
  }

  if (input.designBriefFilePath !== undefined) {
    const value = input.designBriefFilePath?.trim() ?? null;
    if (value) {
      await assertPathExists(value, "Design brief file");
    }
    updateData.designBriefFilePath = value;
  }

  if (input.interactionRulesFilePath !== undefined) {
    const value = input.interactionRulesFilePath?.trim() ?? null;
    if (value) {
      await assertPathExists(value, "Interaction rules file");
    }
    updateData.interactionRulesFilePath = value;
  }

  if (input.visualReferencesFilePath !== undefined) {
    const value = input.visualReferencesFilePath?.trim() ?? null;
    if (value) {
      await assertPathExists(value, "Visual references file");
    }
    updateData.visualReferencesFilePath = value;
  }

  if (input.todoProgressFilePath !== undefined) {
    const trimmedPath = input.todoProgressFilePath.trim();
    await assertPathExists(trimmedPath, "Todo progress file");

    const resolvedTaskSource = await resolveTaskSourceFile(trimmedPath);
    reparsedTasks = resolvedTaskSource.parsedTasks;
    if (resolvedTaskSource.resolvedFilePath !== trimmedPath) {
      updateData.todoProgressFilePath = resolvedTaskSource.resolvedFilePath;
      if (input.referenceDocs === undefined) {
        const existingDocs = parseJsonField<string[]>(project.referenceDocsJson, []);
        if (!existingDocs.includes(trimmedPath)) {
          updateData.referenceDocsJson = stringifyJsonField([...existingDocs, trimmedPath]);
        }
      }
    } else {
      updateData.todoProgressFilePath = resolvedTaskSource.resolvedFilePath;
    }
  }

  if (input.referenceDocs !== undefined) {
    if (updateData.referenceDocsJson === undefined) {
      updateData.referenceDocsJson = stringifyJsonField(input.referenceDocs.map((entry) => entry.trim()).filter(Boolean));
    }
  }

  if (input.buildCommand !== undefined) {
    updateData.buildCommand = input.buildCommand?.trim() ?? null;
  }

  if (input.testCommand !== undefined) {
    updateData.testCommand = input.testCommand?.trim() ?? null;
  }

  if (input.lintCommand !== undefined) {
    updateData.lintCommand = input.lintCommand?.trim() ?? null;
  }

  if (input.startCommand !== undefined) {
    updateData.startCommand = input.startCommand?.trim() ?? null;
  }

  if (input.allowedPaths !== undefined) {
    updateData.allowedPathsJson = stringifyJsonField(input.allowedPaths);
  }

  if (input.blockedPaths !== undefined) {
    updateData.blockedPathsJson = stringifyJsonField(input.blockedPaths);
  }

  if (input.defaultBranch !== undefined) {
    updateData.defaultBranch = input.defaultBranch?.trim() ?? null;
  }

  if (input.autoRunEnabled !== undefined) {
    updateData.autoRunEnabled = input.autoRunEnabled;
  }

  if (Object.keys(updateData).length === 0) {
    return getProjectDetail(projectId);
  }

  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: updateData,
  });

  if (reparsedTasks) {
    const existingTasks = await prisma.task.findMany({
      where: { projectId },
      select: { id: true, taskCode: true, status: true },
    });
    const existingByCode = new Map(existingTasks.map((t) => [t.taskCode, t]));
    const incomingCodes = new Set(reparsedTasks.map((t) => t.taskCode));

    const removedTasks = existingTasks.filter((t) => !incomingCodes.has(t.taskCode));
    const safeToRemove = removedTasks.filter((t) => t.status === "queued" || t.status === "skipped");

    if (safeToRemove.length > 0) {
      await prisma.task.deleteMany({
        where: { id: { in: safeToRemove.map((t) => t.id) } },
      });
    }

    const newTasks = reparsedTasks.filter((t) => !existingByCode.has(t.taskCode));

    if (newTasks.length > 0) {
      await prisma.task.createMany({
        data: newTasks.map((task) => ({
          projectId,
          taskCode: task.taskCode,
          title: task.title,
          section: task.section,
          subsection: task.subsection,
          rawText: task.rawText,
          sourceFilePath: task.sourceFilePath,
          sourceLineStart: task.sourceLineStart,
          sourceLineEnd: task.sourceLineEnd,
          status: task.status,
          taskType: task.taskType,
          autoApprovable: task.autoApprovable,
          acceptanceCriteriaJson: stringifyJsonField(task.acceptanceCriteria),
          dependenciesJson: stringifyJsonField(task.dependencies),
          relevantFilesJson: stringifyJsonField(task.relevantFiles),
          latestSummary: null,
        })),
      });
    }

    for (const parsed of reparsedTasks) {
      const existing = existingByCode.get(parsed.taskCode);
      if (existing) {
        await prisma.task.update({
          where: { id: existing.id },
          data: {
            title: parsed.title,
            section: parsed.section,
            subsection: parsed.subsection,
            rawText: parsed.rawText,
            sourceFilePath: parsed.sourceFilePath,
            sourceLineStart: parsed.sourceLineStart,
            sourceLineEnd: parsed.sourceLineEnd,
          },
        });
      }
    }
  }

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: `Project configuration was updated.`,
  });

  return getProjectDetail(projectId);
}

export async function rejectTask(taskId: string, reason?: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: {
      id: taskId,
    },
  });

  const currentStatus = task.status as TaskStatus;
  assertTaskStatusTransition(currentStatus, "planning");

  await prisma.task.update({
    where: {
      id: taskId,
    },
    data: {
      status: "planning",
      latestSummary: reason ?? "Rejected by user and moved back to planning",
    },
  });

  publishProjectEvent({
    type: "info",
    projectId: task.projectId,
    timestamp: new Date().toISOString(),
    message: `Task ${task.taskCode} was rejected and moved back to planning.`,
  });

  return getProjectDetail(task.projectId);
}
