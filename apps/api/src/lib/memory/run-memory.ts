// Run memory: per-execution context captured during agent runs.
// Contains: git state before/after, file changes, command results, artifacts, execution context.

import type { MemorySource } from "./types.js";

export interface RunMemoryInput {
  runId: string;
  roleName: string;
  model: string;
  provider: string;
  exitCode?: number;
  fileChanges?: {
    all: string[];
    added: string[];
    modified: string[];
    deleted: string[];
  };
  commandOutput?: {
    command: string;
    exitCode: number;
    durationMs: number;
    stdout?: string;
    stderr?: string;
  };
  gitDiff?: string | null;
  rollbackAvailable?: boolean;
}

export interface RunMemorySnapshot {
  runId: string;
  roleName: string;
  model: string;
  provider: string;
  summary: string[];
  sources: MemorySource[];
  promptBlock: string;
  relevantFiles: string[];
  exitCode?: number;
  fileChanges?: RunMemoryInput["fileChanges"];
  commandOutput?: RunMemoryInput["commandOutput"];
  rollbackAvailable: boolean;
}

export function buildRunMemorySnapshot(input: RunMemoryInput): RunMemorySnapshot {
  const sources: MemorySource[] = [];
  const relevantFiles: string[] = [];

  if (input.fileChanges?.all.length) {
    input.fileChanges.all.forEach((file) => relevantFiles.push(file));
    sources.push({
      kind: "file_changes",
      label: `${input.fileChanges.all.length} file(s) changed`,
      path: `run:${input.runId}`,
      snippet: `+${input.fileChanges.added.length} ~${input.fileChanges.modified.length} -${input.fileChanges.deleted.length}`,
    });
  }

  if (input.commandOutput) {
    sources.push({
      kind: "command_output",
      label: `Verification: ${input.commandOutput.command}`,
      path: `run:${input.runId}`,
      snippet: `exit=${input.commandOutput.exitCode} (${input.commandOutput.durationMs}ms)`,
    });
  }

  const summary = [
    `Run ${input.runId}: ${input.roleName} using ${input.model} (${input.provider})`,
    input.exitCode !== undefined
      ? input.exitCode === 0
        ? "Verification passed"
        : `Verification failed (exit ${input.exitCode})`
      : "No verification command",
    input.fileChanges?.all.length
      ? `${input.fileChanges.all.length} file(s) modified`
      : "No file changes",
    input.rollbackAvailable ? "Rollback available" : "No rollback data",
  ];

  return {
    runId: input.runId,
    roleName: input.roleName,
    model: input.model,
    provider: input.provider,
    summary,
    sources,
    promptBlock: sources.length > 0
      ? [
          "Run memory:",
          ...sources.map((source) => `- ${source.label}: ${source.path}\n  Snippet: ${source.snippet}`),
        ].join("\n")
      : `Run memory: ${input.runId} - ${input.roleName}`,
    relevantFiles,
    exitCode: input.exitCode,
    fileChanges: input.fileChanges,
    commandOutput: input.commandOutput,
    rollbackAvailable: input.rollbackAvailable ?? false,
  };
}
