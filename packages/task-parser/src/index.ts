type TaskStatus =
  | "queued"
  | "planning"
  | "ready_for_coding"
  | "coding"
  | "reviewing"
  | "testing"
  | "debugging"
  | "waiting_human"
  | "blocked"
  | "done"
  | "failed"
  | "skipped";

type TaskType = "auto" | "human_gate";

export interface ParsedTask {
  taskCode: string;
  title: string;
  section: string | null;
  subsection: string | null;
  rawText: string;
  sourceFilePath: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  status: TaskStatus;
  taskType: TaskType;
  autoApprovable: boolean;
  acceptanceCriteria: string[];
  dependencies: string[];
  relevantFiles: string[];
}

const headingPattern = /^(#{1,6})\s+(.*)$/;
const checkboxPattern = /^(\s*)- \[( |x|X)\]\s+(.*)$/;
const codePrefixPattern = /^\[([A-Z0-9-]+)\]\s*(.*)$/;
const dependencyPattern = /(?:deps?|依赖)[:：]\s*([A-Z0-9,\s_-]+)/i;
const relevantFilePattern = /`([^`]+)`/g;

function toTaskCode(rawText: string, lineNumber: number): string {
  const codePrefix = rawText.match(codePrefixPattern);

  if (codePrefix) {
    return codePrefix[1];
  }

  const slug = rawText
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 24)
    .toUpperCase();

  return slug ? `TASK-${slug}` : `TASK-L${lineNumber}`;
}

function toTitle(rawText: string): string {
  const codePrefix = rawText.match(codePrefixPattern);
  return codePrefix ? codePrefix[2].trim() : rawText.trim();
}

function inferTaskType(rawText: string): TaskType {
  return /human_gate|人工确认|需审批/i.test(rawText) ? "human_gate" : "auto";
}

function extractDependencies(rawText: string): string[] {
  const match = rawText.match(dependencyPattern);

  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractRelevantFiles(rawText: string): string[] {
  return Array.from(rawText.matchAll(relevantFilePattern), (match) => match[1]);
}

export function parseTaskMarkdown(markdown: string, sourceFilePath: string): ParsedTask[] {
  const lines = markdown.split(/\r?\n/);
  const headings = new Map<number, string>();
  const tasks: ParsedTask[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = line.match(headingPattern);

    if (headingMatch) {
      const level = headingMatch[1].length;
      headings.set(level, headingMatch[2].trim());

      for (const key of Array.from(headings.keys())) {
        if (key > level) {
          headings.delete(key);
        }
      }

      continue;
    }

    const checkboxMatch = line.match(checkboxPattern);

    if (!checkboxMatch) {
      continue;
    }

    const checked = checkboxMatch[2].toLowerCase() === "x";
    const rawText = checkboxMatch[3].trim();
    const section = headings.get(1) ?? null;
    const subsection = headings.get(2) ?? headings.get(3) ?? null;
    const taskType = inferTaskType(rawText);
    const status: TaskStatus = checked ? "done" : "queued";

    tasks.push({
      taskCode: toTaskCode(rawText, index + 1),
      title: toTitle(rawText),
      section,
      subsection,
      rawText,
      sourceFilePath,
      sourceLineStart: index + 1,
      sourceLineEnd: index + 1,
      status,
      taskType,
      autoApprovable: taskType === "auto",
      acceptanceCriteria: [],
      dependencies: extractDependencies(rawText),
      relevantFiles: extractRelevantFiles(rawText),
    });
  }

  return tasks;
}
