import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseTaskMarkdown, type ParsedTask } from "@forgeflow/task-parser";
import { prisma, stringifyJsonField } from "@forgeflow/db";
import { resolveTaskSourceFile } from "./task-source.js";
import { publishProjectEvent } from "./events.js";

const roadmapImportSchema = z.object({
  projectId: z.string().min(1),
  roadmapFilePath: z.string().min(1),
  mergeStrategy: z.enum(["append_sections", "replace_sections", "append_tasks"]).optional().default("append_sections"),
});

interface RoadmapImportInput {
  projectId: string;
  roadmapFilePath: string;
  mergeStrategy?: "append_sections" | "replace_sections" | "append_tasks";
}

interface RoadmapImportResult {
  importedSections: string[];
  importedTasks: number;
  skippedTasks: number;
  updatedSections: string[];
  projectId: string;
}

function buildTodoLine(task: ParsedTask): string {
  const checkbox = task.status === "done" ? "- [x]" : "- [ ]";
  const codePrefix = task.taskCode.match(/^TASK-/) ? "" : `[${task.taskCode}] `;
  const depsSuffix = task.dependencies.length > 0 ? ` deps: ${task.dependencies.join(", ")}` : "";
  const filesSuffix = task.relevantFiles.length > 0 ? ` ${task.relevantFiles.map((f) => `\`${f}\``).join(" ")}` : "";
  return `${checkbox} ${codePrefix}${task.title}${depsSuffix}${filesSuffix}`;
}

async function readExistingTodoContent(todoProgressFilePath: string): Promise<{
  content: string;
  existingTasks: ParsedTask[];
  sections: Map<string, { startLine: number; endLine: number; tasks: ParsedTask[] }>;
}> {
  let content = "";
  try {
    content = await fs.readFile(todoProgressFilePath, "utf8");
  } catch {
    content = "";
  }

  const existingTasks = parseTaskMarkdown(content, todoProgressFilePath);
  const lines = content.split(/\r?\n/);
  const sections = new Map<string, { startLine: number; endLine: number; tasks: ParsedTask[] }>();

  let currentSection: string | null = null;
  let sectionStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,2})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) {
        const sectionData = sections.get(currentSection);
        if (sectionData) {
          sectionData.endLine = i - 1;
        }
      }
      currentSection = headingMatch[2].trim();
      sectionStart = i;
      sections.set(currentSection, { startLine: sectionStart, endLine: lines.length - 1, tasks: [] });
    }
  }

  for (const task of existingTasks) {
    if (task.section) {
      const sectionData = sections.get(task.section);
      if (sectionData) {
        sectionData.tasks.push(task);
      }
    }
  }

  return { content, existingTasks, sections };
}

function findNewSections(
  roadmapTasks: ParsedTask[],
  existingSections: Map<string, { startLine: number; endLine: number; tasks: ParsedTask[] }>
): string[] {
  const roadmapSections = new Set<string>();
  for (const task of roadmapTasks) {
    if (task.section) {
      roadmapSections.add(task.section);
    }
  }
  const newSections: string[] = [];
  for (const section of roadmapSections) {
    if (!existingSections.has(section)) {
      newSections.push(section);
    }
  }
  return newSections;
}

function groupTasksBySection(tasks: ParsedTask[]): Map<string | null, ParsedTask[]> {
  const grouped = new Map<string | null, ParsedTask[]>();
  for (const task of tasks) {
    const key = task.section;
    const existing = grouped.get(key) || [];
    existing.push(task);
    grouped.set(key, existing);
  }
  return grouped;
}

function buildMergedContent(
  existingContent: string,
  existingSections: Map<string, { startLine: number; endLine: number; tasks: ParsedTask[] }>,
  roadmapTasks: ParsedTask[],
  mergeStrategy: "append_sections" | "replace_sections" | "append_tasks"
): { content: string; importedSections: string[]; importedTasks: number; skippedTasks: number; updatedSections: string[] } {
  const lines = existingContent.split(/\r?\n/);
  const existingTaskCodes = new Set<string>();
  const importedSections: string[] = [];
  const updatedSections: string[] = [];
  let importedTasks = 0;
  let skippedTasks = 0;

  for (const [sectionName, sectionData] of existingSections) {
    for (const task of sectionData.tasks) {
      existingTaskCodes.add(task.taskCode);
    }
  }

  const roadmapBySection = groupTasksBySection(roadmapTasks);
  const newSections = findNewSections(roadmapTasks, existingSections);

  if (mergeStrategy === "append_sections") {
    const sectionBlocks: string[] = [];

    for (const newSection of newSections) {
      const sectionTasks = roadmapBySection.get(newSection) || [];
      if (sectionTasks.length === 0) continue;

      importedSections.push(newSection);
      const blockLines: string[] = [`## ${newSection}`, ""];
      for (const task of sectionTasks) {
        if (existingTaskCodes.has(task.taskCode)) {
          skippedTasks++;
          continue;
        }
        blockLines.push(buildTodoLine(task));
        importedTasks++;
      }
      if (blockLines.length > 2) {
        sectionBlocks.push(blockLines.join("\n"));
      }
    }

    if (sectionBlocks.length > 0) {
      const trimmedContent = existingContent.trimEnd();
      const newContent = trimmedContent + "\n\n" + sectionBlocks.join("\n\n") + "\n";
      return { content: newContent, importedSections, importedTasks, skippedTasks, updatedSections };
    }
    return { content: existingContent, importedSections, importedTasks, skippedTasks, updatedSections };
  }

  if (mergeStrategy === "replace_sections") {
    for (const [sectionName, sectionData] of existingSections) {
      const roadmapSectionTasks = roadmapBySection.get(sectionName) || [];
      if (roadmapSectionTasks.length === 0) continue;

      updatedSections.push(sectionName);
      const newTaskLines: string[] = [];
      const existingInSection = new Set(sectionData.tasks.map((t) => t.taskCode));

      for (const task of roadmapSectionTasks) {
        if (existingInSection.has(task.taskCode)) {
          const existingTask = sectionData.tasks.find((t) => t.taskCode === task.taskCode);
          if (existingTask && existingTask.status === "done") {
            newTaskLines.push(buildTodoLine({ ...task, status: "done" }));
          } else {
            newTaskLines.push(buildTodoLine(task));
          }
          importedTasks++;
        } else {
          newTaskLines.push(buildTodoLine(task));
          importedTasks++;
        }
      }

      const startIdx = sectionData.startLine;
      const endIdx = sectionData.endLine;
      const before = lines.slice(0, startIdx);
      const after = lines.slice(endIdx + 1);
      const sectionHeader = lines[startIdx];
      const newSectionContent = [sectionHeader, "", ...newTaskLines];
      lines.length = 0;
      lines.push(...before, ...newSectionContent, ...after);
    }

    for (const newSection of newSections) {
      const sectionTasks = roadmapBySection.get(newSection) || [];
      if (sectionTasks.length === 0) continue;

      importedSections.push(newSection);
      const blockLines: string[] = [`## ${newSection}`, ""];
      for (const task of sectionTasks) {
        blockLines.push(buildTodoLine(task));
        importedTasks++;
      }
      if (blockLines.length > 2) {
        lines.push("", ...blockLines);
      }
    }

    return { content: lines.join("\n"), importedSections, importedTasks, skippedTasks, updatedSections };
  }

  if (mergeStrategy === "append_tasks") {
    const allNewTasks: ParsedTask[] = [];
    for (const tasks of roadmapBySection.values()) {
      for (const task of tasks) {
        if (!existingTaskCodes.has(task.taskCode)) {
          allNewTasks.push(task);
        } else {
          skippedTasks++;
        }
      }
    }

    if (allNewTasks.length === 0) {
      return { content: existingContent, importedSections, importedTasks, skippedTasks, updatedSections };
    }

    importedSections.push("Imported Tasks");
    const blockLines: string[] = ["", "## Imported Tasks", ""];
    for (const task of allNewTasks) {
      blockLines.push(buildTodoLine(task));
      importedTasks++;
    }

    const trimmedContent = existingContent.trimEnd();
    const newContent = trimmedContent + "\n" + blockLines.join("\n") + "\n";
    return { content: newContent, importedSections, importedTasks, skippedTasks, updatedSections };
  }

  return { content: existingContent, importedSections, importedTasks, skippedTasks, updatedSections };
}

export async function importRoadmapIntoProject(input: RoadmapImportInput): Promise<RoadmapImportResult> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: input.projectId },
  });

  const roadmapFilePath = path.resolve(input.roadmapFilePath);
  await fs.access(roadmapFilePath);

  const roadmapContent = await fs.readFile(roadmapFilePath, "utf8");
  const roadmapTasks = parseTaskMarkdown(roadmapContent, roadmapFilePath);

  if (roadmapTasks.length === 0) {
    return {
      importedSections: [],
      importedTasks: 0,
      skippedTasks: 0,
      updatedSections: [],
      projectId: input.projectId,
    };
  }

  const todoProgressFilePath = project.todoProgressFilePath;
  const { content: existingContent, existingTasks, sections: existingSections } = await readExistingTodoContent(todoProgressFilePath);

  const mergeStrategy = input.mergeStrategy || "append_sections";
  const { content: mergedContent, importedSections, importedTasks, skippedTasks, updatedSections } = buildMergedContent(
    existingContent,
    existingSections,
    roadmapTasks,
    mergeStrategy
  );

  if (mergedContent !== existingContent) {
    await fs.writeFile(todoProgressFilePath, mergedContent, "utf8");
  }

  const resolvedTaskSource = await resolveTaskSourceFile(todoProgressFilePath);
  const allParsedTasks = resolvedTaskSource.parsedTasks;

  const existingByCode = new Map(existingTasks.map((t) => [t.taskCode, t]));
  const newTasks = allParsedTasks.filter((t) => !existingByCode.has(t.taskCode));

  if (newTasks.length > 0) {
    await prisma.task.createMany({
      data: newTasks.map((task) => ({
        projectId: input.projectId,
        taskCode: task.taskCode,
        title: task.title,
        section: task.section,
        subsection: task.subsection,
        rawText: task.rawText,
        sourceFilePath: task.sourceFilePath,
        sourceLineStart: task.sourceLineStart,
        sourceLineEnd: task.sourceLineEnd,
        status: task.status,
        taskType: task.taskType,
        autoApprovable: task.autoApprovable,
        acceptanceCriteriaJson: stringifyJsonField(task.acceptanceCriteria),
        dependenciesJson: stringifyJsonField(task.dependencies),
        relevantFilesJson: stringifyJsonField(task.relevantFiles),
        latestSummary: null,
      })),
    });
  }

  const allByCode = new Map(allParsedTasks.map((t) => [t.taskCode, t]));
  for (const existing of existingTasks) {
    const updated = allByCode.get(existing.taskCode);
    if (updated) {
      await prisma.task.update({
        where: { id: (await prisma.task.findFirst({ where: { projectId: input.projectId, taskCode: existing.taskCode } }))!.id },
        data: {
          title: updated.title,
          section: updated.section,
          subsection: updated.subsection,
          rawText: updated.rawText,
          sourceFilePath: updated.sourceFilePath,
          sourceLineStart: updated.sourceLineStart,
          sourceLineEnd: updated.sourceLineEnd,
        },
      });
    }
  }

  publishProjectEvent({
    type: "info",
    projectId: input.projectId,
    timestamp: new Date().toISOString(),
    message: `Roadmap imported: ${importedTasks} tasks added across ${importedSections.length} new sections, ${updatedSections.length} sections updated.`,
  });

  return {
    importedSections,
    importedTasks,
    skippedTasks,
    updatedSections,
    projectId: input.projectId,
  };
}

export { roadmapImportSchema };
