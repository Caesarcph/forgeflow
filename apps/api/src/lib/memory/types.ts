// Shared memory types used across all memory modules.

export interface MemorySource {
  kind: string;
  label: string;
  path: string;
  snippet: string;
}

export interface MemorySnapshot {
  summary: string[];
  sources: MemorySource[];
  promptBlock: string;
  relevantFiles: string[];
}

export function buildPromptBlock(label: string, sources: MemorySource[]): string {
  return sources.length
    ? [
        `${label}:`,
        ...sources.map(
          (source) => `- ${source.label}: ${source.path}\n  Snippet: ${source.snippet}`,
        ),
      ].join("\n")
    : `${label}: no readable sources were loaded.`;
}

export function uniquePaths(sources: MemorySource[]): string[] {
  return Array.from(new Set(sources.map((s) => s.path)));
}
