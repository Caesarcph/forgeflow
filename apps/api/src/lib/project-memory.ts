import { promises as fs } from "node:fs";

import { parseJsonField, stringifyJsonField } from "@forgeflow/db";

type ProjectMemoryProject = {
  introFilePath: string | null;
  doneProgressFilePath: string | null;
  futureFilePath: string | null;
  implementationPlanFilePath: string | null;
  designBriefFilePath: string | null;
  interactionRulesFilePath: string | null;
  visualReferencesFilePath: string | null;
  todoProgressFilePath: string;
  referenceDocs: string[];
  memorySummaryJson?: string | null;
  memorySourcesJson?: string | null;
  memoryPromptBlock?: string | null;
  memoryRelevantFilesJson?: string | null;
};

export interface ProjectMemorySource {
  kind: "primary" | "completed" | "future" | "plan" | "todo" | "reference" | "design_brief" | "interaction_rules" | "visual_references";
  label: string;
  path: string;
  snippet: string;
}

export interface ProjectMemorySnapshot {
  summary: string[];
  sources: ProjectMemorySource[];
  promptBlock: string;
  relevantFiles: string[];
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

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function buildPromptBlock(sources: ProjectMemorySource[]) {
  return sources.length
    ? [
        "Project memory:",
        ...sources.map(
          (source) => `- ${source.label}: ${source.path}\n  Snippet: ${source.snippet}`,
        ),
      ].join("\n")
    : "Project memory: no readable reference documents were loaded.";
}

export function normalizeProjectMemorySnapshot(input: PersistedProjectMemoryPayload): ProjectMemorySnapshot {
  const sources = input.sources
    .map((source) => ({
      kind: source.kind,
      label: source.label.trim(),
      path: source.path.trim(),
      snippet: source.snippet.trim(),
    }))
    .filter((source) => source.label && source.path && source.snippet);
  const summary = input.summary.map((item) => item.trim()).filter(Boolean);

  return {
    summary: summary.length > 0 ? summary : ["Project memory was manually saved without any summary bullets."],
    sources,
    promptBlock: buildPromptBlock(sources),
    relevantFiles: unique(sources.map((source) => source.path)),
  };
}

export function serializeProjectMemorySnapshot(snapshot: ProjectMemorySnapshot) {
  return {
    memorySummaryJson: stringifyJsonField(snapshot.summary),
    memorySourcesJson: stringifyJsonField(snapshot.sources),
    memoryPromptBlock: snapshot.promptBlock,
    memoryRelevantFilesJson: stringifyJsonField(snapshot.relevantFiles),
    memoryUpdatedAt: new Date(),
  };
}

function readPersistedProjectMemory(project: ProjectMemoryProject): ProjectMemorySnapshot | null {
  const summary = parseJsonField<string[]>(project.memorySummaryJson, []);
  const sources = parseJsonField<ProjectMemorySource[]>(project.memorySourcesJson, []);
  const promptBlock = project.memoryPromptBlock?.trim() ?? "";
  const relevantFiles = parseJsonField<string[]>(project.memoryRelevantFilesJson, []);

  if (summary.length === 0 && sources.length === 0 && !promptBlock && relevantFiles.length === 0) {
    return null;
  }

  return {
    summary,
    sources,
    promptBlock: promptBlock || buildPromptBlock(sources),
    relevantFiles: relevantFiles.length > 0 ? unique(relevantFiles) : unique(sources.map((source) => source.path)),
  };
}

export async function buildProjectMemorySnapshot(
  project: ProjectMemoryProject,
  options?: {
    preferPersisted?: boolean;
  },
): Promise<ProjectMemorySnapshot> {
  const persisted = options?.preferPersisted === false ? null : readPersistedProjectMemory(project);

  if (persisted) {
    return persisted;
  }

  const designCandidates: Array<Omit<ProjectMemorySource, "snippet">> = [
    project.designBriefFilePath
      ? {
          kind: "design_brief",
          label: "UI brief",
          path: project.designBriefFilePath,
        }
      : null,
    project.interactionRulesFilePath
      ? {
          kind: "interaction_rules",
          label: "Interaction rules",
          path: project.interactionRulesFilePath,
        }
      : null,
    project.visualReferencesFilePath
      ? {
          kind: "visual_references",
          label: "Visual references",
          path: project.visualReferencesFilePath,
        }
      : null,
  ].filter((entry): entry is Omit<ProjectMemorySource, "snippet"> => Boolean(entry));

  const candidates: Array<Omit<ProjectMemorySource, "snippet">> = [
    project.introFilePath
      ? {
          kind: "primary",
          label: "Primary reference doc",
          path: project.introFilePath,
        }
      : null,
    project.doneProgressFilePath
      ? {
          kind: "completed",
          label: "Completed features doc",
          path: project.doneProgressFilePath,
        }
      : null,
    project.futureFilePath
      ? {
          kind: "future",
          label: "Future roadmap doc",
          path: project.futureFilePath,
        }
      : null,
    project.implementationPlanFilePath
      ? {
          kind: "plan",
          label: "Implementation plan",
          path: project.implementationPlanFilePath,
        }
      : null,
    project.todoProgressFilePath
      ? {
          kind: "todo",
          label: "TODO progress file",
          path: project.todoProgressFilePath,
        }
      : null,
    ...project.referenceDocs.map((filePath) => ({
      kind: "reference" as const,
      label: "Extra reference doc",
      path: filePath,
    })),
    ...designCandidates,
  ].filter((entry): entry is Omit<ProjectMemorySource, "snippet"> => Boolean(entry));

  const sources = (
    await Promise.all(
      candidates.map(async (source) => ({
        ...source,
        snippet: await readSnippet(source.path),
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
    promptBlock: buildPromptBlock(sources),
    relevantFiles: unique(sources.map((source) => source.path)),
  };
}
