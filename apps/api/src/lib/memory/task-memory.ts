// Task memory: per-task context injected into agent prompts.
// Contains: task title, raw text, relevant files, acceptance criteria, dependencies.

import type { MemorySnapshot, MemorySource } from "./types.js";

export interface TaskMemoryInput {
  taskCode: string;
  title: string;
  rawText: string;
  relevantFiles: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
  status: string;
}

export interface TaskMemorySnapshot extends MemorySnapshot {
  taskCode: string;
  title: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  status: string;
}

export function buildTaskMemorySnapshot(input: TaskMemoryInput): TaskMemorySnapshot {
  const sources: MemorySource[] = input.relevantFiles.map((file) => ({
    kind: "task_file",
    label: "Task-relevant file",
    path: file,
    snippet: "",
  }));

  const taskLabel = `Task: ${input.taskCode} - ${input.title}`;
  const summary = [
    taskLabel,
    input.acceptanceCriteria.length > 0
      ? `${input.acceptanceCriteria.length} acceptance criteria defined`
      : "No acceptance criteria defined",
    input.dependencies.length > 0
      ? `Depends on: ${input.dependencies.join(", ")}`
      : "No dependencies",
  ];

  return {
    taskCode: input.taskCode,
    title: input.title,
    summary,
    sources,
    promptBlock: sources.length > 0
      ? [
          "Task memory:",
          taskLabel,
          `Status: ${input.status}`,
          ...input.acceptanceCriteria.map((criteria) => `- Acceptance: ${criteria}`),
          ...input.dependencies.map((dependency) => `- Dependency: ${dependency}`),
          ...sources.map((source) => `- File: ${source.path}`),
        ].join("\n")
      : `Task memory: ${input.taskCode} - ${input.title}`,
    relevantFiles: input.relevantFiles,
    acceptanceCriteria: input.acceptanceCriteria,
    dependencies: input.dependencies,
    status: input.status,
  };
}
