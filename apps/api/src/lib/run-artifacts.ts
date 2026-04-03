import { promises as fs } from "node:fs";
import path from "node:path";

import { parseJsonField, prisma, stringifyJsonField } from "@forgeflow/db";
import { buildAgentPromptText, type AgentExecutionContext, type AgentExecutionResult } from "@forgeflow/opencode-adapter";

import type { ProjectMemorySnapshot } from "./project-memory.js";
import type { GitPreflightSummary, GitRepoState } from "./git-run-tracking.js";

type ArtifactRecord = {
  id: string;
  artifactType: string;
  title: string;
  filePath: string;
  metadataJson: string | null;
  createdAt: Date;
};

export interface RunExecutionContextArtifact {
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
  memory: Pick<ProjectMemorySnapshot, "summary" | "sources" | "promptBlock" | "relevantFiles">;
  fileChanges?: {
    all: string[];
    added: string[];
    modified: string[];
    deleted: string[];
  };
  gitPreflight?: GitPreflightSummary;
}

export interface RunArtifactSummary {
  id: string;
  artifactType: string;
  title: string;
  filePath: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface HydratedRunArtifacts {
  rawOutput: string | null;
  gitDiff: string | null;
  gitStateBefore: GitRepoState | null;
  gitStateAfter: GitRepoState | null;
  executionContext: RunExecutionContextArtifact | null;
  commandLogs: Array<{
    commandRunId: string;
    stdoutPath: string | null;
    stderrPath: string | null;
    stdout: string | null;
    stderr: string | null;
  }>;
  artifacts: RunArtifactSummary[];
  rollbackAvailable: boolean;
}

function getRunDirectory(projectRootPath: string, runId: string) {
  return path.join(projectRootPath, ".forgeflow", "runs", runId);
}

async function writeArtifactFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function readOptionalFile(filePath: string | null | undefined) {
  if (!filePath) {
    return null;
  }

  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function serializeArtifactRecord(artifact: ArtifactRecord): RunArtifactSummary {
  return {
    id: artifact.id,
    artifactType: artifact.artifactType,
    title: artifact.title,
    filePath: artifact.filePath,
    metadata: parseJsonField<Record<string, unknown> | null>(artifact.metadataJson, null),
    createdAt: artifact.createdAt.toISOString(),
  };
}

export async function persistAgentRunArtifacts(input: {
  runId: string;
  projectRootPath: string;
  executionContext: AgentExecutionContext;
  projectMemory: ProjectMemorySnapshot;
  result: AgentExecutionResult;
  fileChanges?: {
    all: string[];
    added: string[];
    modified: string[];
    deleted: string[];
  };
  gitPreflight?: GitPreflightSummary;
}) {
  const runDirectory = getRunDirectory(input.projectRootPath, input.runId);
  const executionContextPayload: RunExecutionContextArtifact = {
    ...input.executionContext,
    promptText: buildAgentPromptText(input.executionContext),
    memory: {
      summary: input.projectMemory.summary,
      sources: input.projectMemory.sources,
      promptBlock: input.projectMemory.promptBlock,
      relevantFiles: input.projectMemory.relevantFiles,
    },
    ...(input.fileChanges ? { fileChanges: input.fileChanges } : {}),
    ...(input.gitPreflight ? { gitPreflight: input.gitPreflight } : {}),
  };

  const contextPath = path.join(runDirectory, "execution-context.json");
  const promptPath = path.join(runDirectory, "prompt.txt");
  const memoryPath = path.join(runDirectory, "project-memory.md");
  const outputPath = path.join(runDirectory, "raw-output.txt");
  const changedFilesPath = path.join(runDirectory, "changed-files.json");

  await Promise.all([
    writeArtifactFile(contextPath, JSON.stringify(executionContextPayload, null, 2)),
    writeArtifactFile(promptPath, executionContextPayload.promptText),
    writeArtifactFile(memoryPath, input.projectMemory.promptBlock),
    writeArtifactFile(outputPath, input.result.rawOutput),
    ...(input.fileChanges ? [writeArtifactFile(changedFilesPath, JSON.stringify(input.fileChanges, null, 2))] : []),
  ]);

  await prisma.$transaction([
    prisma.taskRun.update({
      where: {
        id: input.runId,
      },
      data: {
        fullOutputPath: outputPath,
      },
    }),
    prisma.artifact.createMany({
      data: [
        {
          taskRunId: input.runId,
          artifactType: "execution_context",
          title: "Execution context",
          filePath: contextPath,
          metadataJson: stringifyJsonField({
            format: "json",
          }),
        },
        {
          taskRunId: input.runId,
          artifactType: "prompt_text",
          title: "Exact prompt",
          filePath: promptPath,
          metadataJson: stringifyJsonField({
            format: "text",
          }),
        },
        {
          taskRunId: input.runId,
          artifactType: "project_memory",
          title: "Injected project memory",
          filePath: memoryPath,
          metadataJson: stringifyJsonField({
            format: "markdown",
          }),
        },
        {
          taskRunId: input.runId,
          artifactType: "raw_output",
          title: "Raw model output",
          filePath: outputPath,
          metadataJson: stringifyJsonField({
            format: "text",
          }),
        },
        ...(input.fileChanges
          ? [
              {
                taskRunId: input.runId,
                artifactType: "changed_files",
                title: "Changed files",
                filePath: changedFilesPath,
                metadataJson: stringifyJsonField({
                  format: "json",
                }),
              },
            ]
          : []),
      ],
    }),
  ]);
}

export async function persistVerificationRunArtifacts(input: {
  runId: string;
  commandRunId: string;
  projectRootPath: string;
  command: string;
  stdout: string;
  stderr: string;
}) {
  const runDirectory = getRunDirectory(input.projectRootPath, input.runId);
  const stdoutPath = input.stdout.trim() ? path.join(runDirectory, "stdout.log") : null;
  const stderrPath = input.stderr.trim() ? path.join(runDirectory, "stderr.log") : null;
  const outputPath = path.join(runDirectory, "raw-output.txt");
  const combinedOutput = [
    `Command: ${input.command}`,
    "",
    "[stdout]",
    input.stdout.trim() || "(empty)",
    "",
    "[stderr]",
    input.stderr.trim() || "(empty)",
  ].join("\n");

  await Promise.all([
    writeArtifactFile(outputPath, combinedOutput),
    ...(stdoutPath ? [writeArtifactFile(stdoutPath, input.stdout)] : []),
    ...(stderrPath ? [writeArtifactFile(stderrPath, input.stderr)] : []),
  ]);

  await prisma.$transaction([
    prisma.taskRun.update({
      where: {
        id: input.runId,
      },
      data: {
        fullOutputPath: outputPath,
      },
    }),
    prisma.commandRun.update({
      where: {
        id: input.commandRunId,
      },
      data: {
        stdoutPath,
        stderrPath,
      },
    }),
    prisma.artifact.createMany({
      data: [
        {
          taskRunId: input.runId,
          artifactType: "raw_output",
          title: "Verification output",
          filePath: outputPath,
          metadataJson: stringifyJsonField({
            format: "text",
          }),
        },
        ...(stdoutPath
          ? [
              {
                taskRunId: input.runId,
                artifactType: "stdout",
                title: "Verification stdout",
                filePath: stdoutPath,
                metadataJson: stringifyJsonField({
                  format: "text",
                }),
              },
            ]
          : []),
        ...(stderrPath
          ? [
              {
                taskRunId: input.runId,
                artifactType: "stderr",
                title: "Verification stderr",
                filePath: stderrPath,
                metadataJson: stringifyJsonField({
                  format: "text",
                }),
              },
            ]
          : []),
      ],
    }),
  ]);
}

export async function persistGitRunArtifacts(input: {
  runId: string;
  beforeStatePath: string;
  afterStatePath: string;
  diffPath: string;
  rollbackManifestPath: string | null;
}) {
  await prisma.$transaction([
    prisma.taskRun.update({
      where: {
        id: input.runId,
      },
      data: {
        diffPath: input.diffPath,
      },
    }),
    prisma.artifact.createMany({
      data: [
        {
          taskRunId: input.runId,
          artifactType: "git_state_before",
          title: "Git state before run",
          filePath: input.beforeStatePath,
          metadataJson: stringifyJsonField({
            format: "json",
          }),
        },
        {
          taskRunId: input.runId,
          artifactType: "git_state_after",
          title: "Git state after run",
          filePath: input.afterStatePath,
          metadataJson: stringifyJsonField({
            format: "json",
          }),
        },
        {
          taskRunId: input.runId,
          artifactType: "git_diff",
          title: "Git diff patch",
          filePath: input.diffPath,
          metadataJson: stringifyJsonField({
            format: "patch",
          }),
        },
        ...(input.rollbackManifestPath
          ? [
              {
                taskRunId: input.runId,
                artifactType: "rollback_manifest",
                title: "Rollback manifest",
                filePath: input.rollbackManifestPath,
                metadataJson: stringifyJsonField({
                  format: "json",
                }),
              },
            ]
          : []),
      ],
    }),
  ]);
}

export async function hydrateRunArtifacts(input: {
  fullOutputPath: string | null;
  diffPath?: string | null;
  commandRuns?: Array<{
    id: string;
    stdoutPath: string | null;
    stderrPath: string | null;
  }>;
  artifacts: ArtifactRecord[];
}): Promise<HydratedRunArtifacts> {
  const executionContextArtifact = input.artifacts.find((artifact) => artifact.artifactType === "execution_context");
  const executionContextText = await readOptionalFile(executionContextArtifact?.filePath);
  let executionContext: RunExecutionContextArtifact | null = null;

  if (executionContextText) {
    try {
      executionContext = JSON.parse(executionContextText) as RunExecutionContextArtifact;
    } catch {
      executionContext = null;
    }
  }

  const rawOutputPath =
    input.fullOutputPath ?? input.artifacts.find((artifact) => artifact.artifactType === "raw_output")?.filePath ?? null;
  const gitDiffPath = input.diffPath ?? input.artifacts.find((artifact) => artifact.artifactType === "git_diff")?.filePath ?? null;
  const gitStateBeforePath = input.artifacts.find((artifact) => artifact.artifactType === "git_state_before")?.filePath ?? null;
  const gitStateAfterPath = input.artifacts.find((artifact) => artifact.artifactType === "git_state_after")?.filePath ?? null;
  const commandLogs = await Promise.all(
    (input.commandRuns ?? []).map(async (commandRun) => ({
      commandRunId: commandRun.id,
      stdoutPath: commandRun.stdoutPath,
      stderrPath: commandRun.stderrPath,
      stdout: await readOptionalFile(commandRun.stdoutPath),
      stderr: await readOptionalFile(commandRun.stderrPath),
    })),
  );

  return {
    rawOutput: await readOptionalFile(rawOutputPath),
    gitDiff: await readOptionalFile(gitDiffPath),
    gitStateBefore: parseJsonField<GitRepoState | null>(await readOptionalFile(gitStateBeforePath), null),
    gitStateAfter: parseJsonField<GitRepoState | null>(await readOptionalFile(gitStateAfterPath), null),
    executionContext,
    commandLogs,
    artifacts: input.artifacts.map(serializeArtifactRecord),
    rollbackAvailable: input.artifacts.some((artifact) => artifact.artifactType === "rollback_manifest"),
  };
}
