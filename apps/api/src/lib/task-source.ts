import { promises as fs } from "node:fs";
import path from "node:path";

import { parseTaskMarkdown, type ParsedTask } from "@forgeflow/task-parser";

const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

interface TaskSourceCandidate {
  filePath: string;
  parsedTasks: ParsedTask[];
  depth: number;
}

export interface ResolvedTaskSource {
  requestedFilePath: string;
  resolvedFilePath: string;
  parsedTasks: ParsedTask[];
  viaLinkedDoc: boolean;
}

function normalizeMarkdownTarget(rawTarget: string, sourceFilePath: string) {
  const trimmed = rawTarget.trim();
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1).trim() : trimmed;
  const withoutAnchor = unwrapped.split("#")[0]?.trim() ?? "";

  if (!withoutAnchor) {
    return null;
  }

  if (/^(?:https?:|mailto:)/i.test(withoutAnchor)) {
    return null;
  }

  const normalizedPath = withoutAnchor.replace(/\//g, path.sep);
  return path.resolve(path.dirname(sourceFilePath), normalizedPath);
}

function extractMarkdownLinks(markdown: string, sourceFilePath: string) {
  const links = new Set<string>();

  for (const match of markdown.matchAll(markdownLinkPattern)) {
    const target = normalizeMarkdownTarget(match[1], sourceFilePath);

    if (!target) {
      continue;
    }

    if (!/\.md$/i.test(target)) {
      continue;
    }

    links.add(target);
  }

  return [...links];
}

function scoreTaskSourceCandidate(candidate: TaskSourceCandidate) {
  const normalizedPath = candidate.filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(candidate.filePath).toLowerCase();
  let score = candidate.parsedTasks.length * 10 - candidate.depth * 40;

  if (basename.includes("todo")) {
    score += 500;
  }

  if (basename.includes("legacy")) {
    score += 4;
  }

  if (basename.includes("roadmap") || basename.includes("status")) {
    score -= 120;
  }

  if (basename.includes("future") || basename.includes("completed") || basename.includes("reference")) {
    score -= 150;
  }

  if (normalizedPath.includes("/archive/")) {
    score -= 2;
  }

  return score;
}

async function collectTaskSourceCandidates(
  filePath: string,
  visited: Set<string>,
  depth: number,
  maxDepth: number,
): Promise<TaskSourceCandidate[]> {
  const resolvedFilePath = path.resolve(filePath);

  if (visited.has(resolvedFilePath)) {
    return [];
  }

  visited.add(resolvedFilePath);

  let markdown = "";

  try {
    markdown = await fs.readFile(resolvedFilePath, "utf8");
  } catch {
    return [];
  }

  const parsedTasks = parseTaskMarkdown(markdown, resolvedFilePath);
  const candidates: TaskSourceCandidate[] = [
    {
      filePath: resolvedFilePath,
      parsedTasks,
      depth,
    },
  ];

  if (parsedTasks.length > 0 || depth >= maxDepth) {
    return candidates;
  }

  const linkedFiles = extractMarkdownLinks(markdown, resolvedFilePath);

  for (const linkedFile of linkedFiles) {
    candidates.push(...(await collectTaskSourceCandidates(linkedFile, visited, depth + 1, maxDepth)));
  }

  return candidates;
}

export async function resolveTaskSourceFile(todoProgressFilePath: string): Promise<ResolvedTaskSource> {
  const requestedFilePath = path.resolve(todoProgressFilePath);
  const candidates = await collectTaskSourceCandidates(requestedFilePath, new Set<string>(), 0, 2);
  const directCandidate = candidates.find((candidate) => candidate.filePath === requestedFilePath) ?? {
    filePath: requestedFilePath,
    parsedTasks: [] as ParsedTask[],
    depth: 0,
  };
  const parsedCandidates = candidates.filter((candidate) => candidate.parsedTasks.length > 0);
  const todoNamedCandidates = parsedCandidates.filter((candidate) =>
    path.basename(candidate.filePath).toLowerCase().includes("todo"),
  );
  const bestCandidate = [...(todoNamedCandidates.length > 0 ? todoNamedCandidates : parsedCandidates)].sort(
    (left, right) => scoreTaskSourceCandidate(right) - scoreTaskSourceCandidate(left),
  )[0];

  return {
    requestedFilePath,
    resolvedFilePath: bestCandidate?.filePath ?? directCandidate.filePath,
    parsedTasks: bestCandidate?.parsedTasks ?? directCandidate.parsedTasks,
    viaLinkedDoc: Boolean(bestCandidate && bestCandidate.filePath !== requestedFilePath),
  };
}
