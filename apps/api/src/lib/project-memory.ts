// Legacy project-memory.ts — backward-compatible facade.
// Composes project memory + design memory into a single snapshot for existing consumers.
// New code should import from ./memory/ directly.

import { parseJsonField, stringifyJsonField } from "@forgeflow/db";

import {
  buildProjectMemorySnapshot as buildProjectMemory,
  buildDesignMemorySnapshot as buildDesignMemory,
  type ProjectMemorySnapshot as NewProjectMemorySnapshot,
  type DesignMemorySnapshot,
} from "./memory/index.js";

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

function mergeSnapshots(
  projectMemory: NewProjectMemorySnapshot,
  designMemory: DesignMemorySnapshot,
): ProjectMemorySnapshot {
  const allSources: ProjectMemorySource[] = [
    ...projectMemory.sources,
    ...designMemory.sources,
  ];
  const allSummary = [...projectMemory.summary, ...designMemory.summary];
  const allRelevantFiles = unique([...projectMemory.relevantFiles, ...designMemory.relevantFiles]);

  return {
    summary: allSummary,
    sources: allSources,
    promptBlock: [projectMemory.promptBlock, designMemory.promptBlock].filter(Boolean).join("\n\n"),
    relevantFiles: allRelevantFiles,
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

  // Build project memory (core docs only)
  const projectMemory = await buildProjectMemory({
    introFilePath: project.introFilePath,
    doneProgressFilePath: project.doneProgressFilePath,
    futureFilePath: project.futureFilePath,
    implementationPlanFilePath: project.implementationPlanFilePath,
    todoProgressFilePath: project.todoProgressFilePath,
    referenceDocs: project.referenceDocs,
  });

  // Build design memory (design-specific docs)
  const designMemory = await buildDesignMemory({
    designBriefFilePath: project.designBriefFilePath,
    interactionRulesFilePath: project.interactionRulesFilePath,
    visualReferencesFilePath: project.visualReferencesFilePath,
  });

  // Merge for backward compatibility
  return mergeSnapshots(projectMemory, designMemory);
}
