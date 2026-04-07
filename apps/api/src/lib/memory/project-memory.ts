// Project memory: stable project-level documentation.
// Contains: README, intro docs, implementation plans, TODO files, reference docs, roadmaps.

import { promises as fs } from "node:fs";
import { buildPromptBlock, uniquePaths, type MemorySnapshot, type MemorySource } from "./types.js";

export type ProjectMemoryKind =
  | "primary"
  | "completed"
  | "future"
  | "plan"
  | "todo"
  | "reference";

export interface ProjectMemorySource extends MemorySource {
  kind: ProjectMemoryKind;
}

export interface ProjectMemorySnapshot extends MemorySnapshot {
  sources: ProjectMemorySource[];
}

export interface PersistedProjectMemoryPayload {
  summary: string[];
  sources: ProjectMemorySource[];
}

async function readSnippet(filePath: string, maxLines = 5) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, maxLines)
      .join(" ")
      .slice(0, 500);
  } catch {
    return "";
  }
}

export async function buildProjectMemorySnapshot(input: {
  introFilePath: string | null;
  doneProgressFilePath: string | null;
  futureFilePath: string | null;
  implementationPlanFilePath: string | null;
  todoProgressFilePath: string | null;
  referenceDocs: string[];
}): Promise<ProjectMemorySnapshot> {
  const candidates = [
    input.introFilePath
      ? { kind: "primary", label: "Primary reference doc", path: input.introFilePath }
      : null,
    input.doneProgressFilePath
      ? { kind: "completed", label: "Completed features doc", path: input.doneProgressFilePath }
      : null,
    input.futureFilePath
      ? { kind: "future", label: "Future roadmap doc", path: input.futureFilePath }
      : null,
    input.implementationPlanFilePath
      ? { kind: "plan", label: "Implementation plan", path: input.implementationPlanFilePath }
      : null,
    input.todoProgressFilePath
      ? { kind: "todo", label: "TODO progress file", path: input.todoProgressFilePath }
      : null,
    ...input.referenceDocs.map((filePath) => ({
      kind: "reference" as const,
      label: "Extra reference doc",
      path: filePath,
    })),
  ].filter((candidate): candidate is { kind: ProjectMemoryKind; label: string; path: string } => candidate !== null);

  const sources = (
    await Promise.all(
      candidates.map(async (candidate) => ({
        kind: candidate.kind,
        label: candidate.label,
        path: candidate.path,
        snippet: await readSnippet(candidate.path),
      })),
    )
  ).filter((source) => source.snippet);

  const summary = [
    sources.find((source) => source.kind === "primary")
      ? "Primary project reference is loaded"
      : "Primary project reference is missing",
    sources.find((source) => source.kind === "todo")
      ? "TODO progress file is loaded into memory"
      : "TODO progress file summary is unavailable",
    sources.find((source) => source.kind === "plan")
      ? "Implementation plan context is available"
      : "Implementation plan context is missing",
    sources.find((source) => source.kind === "completed")
      ? "Completed-features history is available"
      : "Completed-features history is missing",
    sources.find((source) => source.kind === "future")
      ? "Future roadmap context is available"
      : "Future roadmap context is missing",
  ];

  return {
    summary,
    sources,
    promptBlock: buildPromptBlock("Project memory", sources),
    relevantFiles: uniquePaths(sources),
  };
}
