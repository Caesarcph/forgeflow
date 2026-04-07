// Design memory: design-specific documentation for UI/UX work.
// Contains: design brief, interaction rules, visual references.

import { promises as fs } from "node:fs";
import { buildPromptBlock, uniquePaths, type MemorySnapshot, type MemorySource } from "./types.js";

export type DesignMemoryKind = "design_brief" | "interaction_rules" | "visual_references";

export interface DesignMemorySource extends MemorySource {
  kind: DesignMemoryKind;
}

export interface DesignMemorySnapshot extends MemorySnapshot {
  sources: DesignMemorySource[];
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

export async function buildDesignMemorySnapshot(input: {
  designBriefFilePath: string | null;
  interactionRulesFilePath: string | null;
  visualReferencesFilePath: string | null;
}): Promise<DesignMemorySnapshot> {
  const candidates = [
    input.designBriefFilePath
      ? { kind: "design_brief", label: "UI brief", path: input.designBriefFilePath }
      : null,
    input.interactionRulesFilePath
      ? { kind: "interaction_rules", label: "Interaction rules", path: input.interactionRulesFilePath }
      : null,
    input.visualReferencesFilePath
      ? { kind: "visual_references", label: "Visual references", path: input.visualReferencesFilePath }
      : null,
  ].filter((candidate): candidate is { kind: DesignMemoryKind; label: string; path: string } => candidate !== null);

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
    sources.find((source) => source.kind === "design_brief")
      ? "Design brief is loaded"
      : "Design brief is missing",
    sources.find((source) => source.kind === "interaction_rules")
      ? "Interaction rules are loaded"
      : "Interaction rules are missing",
    sources.find((source) => source.kind === "visual_references")
      ? "Visual references are loaded"
      : "Visual references are missing",
  ];

  return {
    summary,
    sources,
    promptBlock: buildPromptBlock("Design memory", sources),
    relevantFiles: uniquePaths(sources),
  };
}
