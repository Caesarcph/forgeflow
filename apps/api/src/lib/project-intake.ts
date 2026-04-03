import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  ForgeFlowExecutionError,
  createAgentExecutor,
  resolveCliCommandInvocation,
  resolveCliPath,
} from "@forgeflow/opencode-adapter";
import { z } from "zod";

import { env } from "./env.js";
import { runPtyCommandProbe, runPtyProcessCapture } from "./pty-sessions.js";
import { resolveTaskSourceFile } from "./task-source.js";

interface IntakeExecutionOptions {
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

type HealthCheckStatus = "healthy" | "degraded" | "unhealthy";

interface IntakeHealthStage {
  id: "cli" | "provider" | "model";
  label: string;
  ok: boolean;
  status: HealthCheckStatus;
  latencyMs: number;
  summary: string;
  errorCode?: string;
}

function assertNotAborted(options: IntakeExecutionOptions) {
  if (options.signal?.aborted) {
    throw new ForgeFlowExecutionError({
      code: "INTAKE_CANCELLED",
      message: "Intake job was cancelled",
    });
  }
}

async function ensureNeutralIntakeDirectory() {
  const intakeDir = path.join(os.tmpdir(), "forgeflow-intake");
  await fs.mkdir(intakeDir, { recursive: true });
  return intakeDir;
}

function extractTextFromJsonEventStream(rawOutput: string) {
  const textParts: string[] = [];

  for (const line of rawOutput.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        part?: {
          type?: string;
          text?: string;
        };
      };

      if (event.type === "text" && typeof event.part?.text === "string") {
        textParts.push(event.part.text);
      }
    } catch {
      return null;
    }
  }

  return textParts.join("").trim();
}

function stripAnsi(text: string) {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

async function runCliProbe(input: {
  cliPath?: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const cliPath = await resolveCliPath(input.cliPath);
  const invocation = await resolveCliCommandInvocation(cliPath, input.args);

  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    commandLabel: string;
  }>((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      cwd: input.cwd,
      env: process.env,
      windowsHide: true,
      shell: invocation.shell,
    });
    child.stdin?.end();

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    const commandLabel = [invocation.file, ...invocation.args.slice(0, 8)].join(" ");

    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }

      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    const abortListener = () => {
      if (finished) {
        return;
      }

      child.kill("SIGTERM");
    };

    input.signal?.addEventListener("abort", abortListener, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortListener);
      reject(
        new ForgeFlowExecutionError({
          code: "CLI_SPAWN_FAILED",
          message: `Failed to spawn OpenCode CLI probe: ${error.message}`,
          details: {
            command: commandLabel,
          },
        }),
      );
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortListener);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        timedOut,
        commandLabel,
      });
    });
  });
}

const intakeMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const intakeStrategySchema = z.enum(["auto", "heuristic"]).default("auto");

const brainstormSchema = z.object({
  rootPath: z.string().min(1),
  projectName: z.string().optional(),
  idea: z.string().min(1),
  notes: z.string().optional(),
  strategy: intakeStrategySchema,
  provider: z.string().optional().default("mock"),
  model: z.string().optional().default("forgeflow-intake-mock"),
  conversation: z.array(intakeMessageSchema).default([]),
});

const detectExistingSchema = z.object({
  rootPath: z.string().min(1),
  notes: z.string().optional(),
  strategy: intakeStrategySchema,
  provider: z.string().optional().default("mock"),
  model: z.string().optional().default("forgeflow-intake-mock"),
  conversation: z.array(intakeMessageSchema).default([]),
});

const intakeHealthCheckSchema = z.object({
  provider: z.string().optional().default("mock"),
  model: z.string().optional().default("forgeflow-intake-mock"),
  rootPath: z.string().optional(),
});

const brainstormResultSchema = z.object({
  summary: z.string(),
  assistantMessage: z.string(),
  suggestedProject: z.object({
    name: z.string(),
    projectType: z.literal("greenfield"),
    rootPath: z.string(),
    introFilePath: z.string(),
    implementationPlanFilePath: z.string(),
    todoProgressFilePath: z.string(),
    buildCommand: z.string().optional().default(""),
    testCommand: z.string().optional().default(""),
    lintCommand: z.string().optional().default(""),
    startCommand: z.string().optional().default(""),
    allowedPaths: z.array(z.string()).default([]),
    blockedPaths: z.array(z.string()).default([]),
    defaultBranch: z.string().default("main"),
  }),
  assumptions: z.array(z.string()).default([]),
  milestones: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  bootstrapFiles: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      content: z.string(),
    }),
  ),
});

const detectExistingResultSchema = z.object({
  summary: z.string().optional().default(""),
  assistantMessage: z.string().optional().default(""),
  suggestedProject: z
    .object({
      name: z.string().optional(),
      projectType: z.literal("existing").optional(),
      rootPath: z.string().optional(),
      introFilePath: z.string().optional(),
      doneProgressFilePath: z.string().optional(),
      futureFilePath: z.string().optional(),
      implementationPlanFilePath: z.string().optional(),
      referenceDocs: z.array(z.string()).optional(),
      todoProgressFilePath: z.string().optional(),
      buildCommand: z.string().optional(),
      testCommand: z.string().optional(),
      lintCommand: z.string().optional(),
      startCommand: z.string().optional(),
      allowedPaths: z.array(z.string()).optional(),
      blockedPaths: z.array(z.string()).optional(),
      defaultBranch: z.string().optional(),
    })
    .optional()
    .default({}),
  memorySummary: z.array(z.string()).optional().default([]),
});

type IntakeMessage = z.infer<typeof intakeMessageSchema>;

interface StarterFileDraft {
  path: string;
  title: string;
  content: string;
}

interface HeuristicBrainstormDraft {
  summary: string;
  assistantMessage: string;
  suggestedProject: {
    name: string;
    projectType: "greenfield";
    rootPath: string;
    introFilePath: string;
    implementationPlanFilePath: string;
    todoProgressFilePath: string;
    buildCommand: string;
    testCommand: string;
    lintCommand: string;
    startCommand: string;
    allowedPaths: string[];
    blockedPaths: string[];
    defaultBranch: string;
  };
  assumptions: string[];
  milestones: string[];
  openQuestions: string[];
  bootstrapFiles: StarterFileDraft[];
}

interface HeuristicExistingAnalysis {
  summary: string;
  assistantMessage: string;
  suggestedProject: {
    name: string;
    projectType: "existing";
    rootPath: string;
    introFilePath: string;
    doneProgressFilePath: string;
    futureFilePath: string;
    implementationPlanFilePath: string;
    referenceDocs: string[];
    todoProgressFilePath: string;
    buildCommand: string;
    testCommand: string;
    lintCommand: string;
    startCommand: string;
    allowedPaths: string[];
    blockedPaths: string[];
    defaultBranch: string;
  };
  scripts: Array<{ name: string; command: string }>;
  keyDirectories: string[];
  workspace: {
    workspaceRoot: string;
    docsRoot: string | null;
    frontendRoot: string | null;
    backendRoot: string | null;
    packageRoots: Array<{
      path: string;
      packageName: string | null;
      role: "frontend" | "backend" | "fullstack" | "tooling" | "unknown";
      scripts: string[];
    }>;
  };
  docMemory: Array<{ path: string; snippet: string }>;
  memorySummary: string[];
}

function preferNonEmptyString(primary: string, fallback: string) {
  return primary.trim() ? primary : fallback;
}

function preferNonEmptyArray<T>(primary: T[] | undefined, fallback: T[]) {
  return primary && primary.length > 0 ? primary : fallback;
}

function inferProjectName(projectName: string | undefined, idea: string): string {
  if (projectName?.trim()) {
    return projectName.trim();
  }

  const firstLine = idea.split(/\r?\n/)[0]?.trim() ?? "";
  const compact = firstLine.replace(/[.!?].*$/, "").trim();
  return compact.length > 1 ? compact.slice(0, 40) : "New Project";
}

function inferStackNotes(text: string) {
  const source = text.toLowerCase();

  if (/(next\.?js|nextjs)/.test(source)) {
    return {
      label: "Next.js",
      commands: {
        startCommand: "npm run dev",
        buildCommand: "npm run build",
        lintCommand: "npm run lint",
        testCommand: "npm test",
      },
      allowedPaths: ["app", "src", "components", "lib", "public"],
    };
  }

  if (/(vite|react|frontend|front-end|web)/.test(source)) {
    return {
      label: "React/Vite",
      commands: {
        startCommand: "npm run dev",
        buildCommand: "npm run build",
        lintCommand: "npm run lint",
        testCommand: "npm test",
      },
      allowedPaths: ["src", "public", "scripts", "docs"],
    };
  }

  if (/(fastapi|python|backend|api)/.test(source)) {
    return {
      label: "Python service",
      commands: {
        startCommand: "uvicorn app.main:app --reload",
        buildCommand: "",
        lintCommand: "ruff check .",
        testCommand: "pytest",
      },
      allowedPaths: ["app", "tests", "scripts", "docs"],
    };
  }

  return {
    label: "General app",
    commands: {
      startCommand: "npm run dev",
      buildCommand: "npm run build",
      lintCommand: "npm run lint",
      testCommand: "npm test",
    },
    allowedPaths: ["src", "docs", "scripts"],
  };
}

function inferMilestones(idea: string): string[] {
  const lines = idea
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length >= 3) {
    return lines.slice(0, 4);
  }

  return [
    "Define MVP scope and core user flow",
    "Set up repo structure and development commands",
    "Implement the core screens or APIs",
    "Add tests, docs, and release checks",
  ];
}

function buildPrdContent(name: string, idea: string, notes: string, stackLabel: string, milestones: string[]) {
  return `# ${name} Project Brief

## Idea
${idea.trim()}

## Additional Constraints
${notes.trim() || "None yet."}

## Suggested Technical Direction
- Recommended starting stack: ${stackLabel}
- Start with the smallest working version, then tighten quality and docs

## Suggested Milestones
${milestones.map((item, index) => `${index + 1}. ${item}`).join("\n")}
`;
}

function buildPlanContent(name: string, milestones: string[], stackLabel: string) {
  return `# ${name} Implementation Plan

## Strategy
- Start with the smallest viable skeleton
- Confirm the core data flow and UI flow early
- Use runnable commands as quality gates
- Write progress back to TODO after each phase

## Suggested Stack
- ${stackLabel}

## Phases
${milestones
  .map(
    (item, index) => `### Phase ${index + 1}
- Goal: ${item}
- Deliverables: code, docs, verification commands
- Exit criteria: the phase is demonstrable and testable`,
  )
  .join("\n\n")}
`;
}

function buildTodoContent(name: string, milestones: string[]) {
  const tasks = milestones.flatMap((item, index) => {
    const code = `P${index + 1}`;

    return [
      `## ${code} ${item}`,
      `- [ ] ${code}-01 Define scope and acceptance criteria`,
      `- [ ] ${code}-02 Implement the smallest viable version`,
      `- [ ] ${code}-03 Add verification commands and notes`,
      "",
    ];
  });

  return `# ${name} TODO

Mark each item with \`- [x]\` when done.

${tasks.join("\n")}`.trim();
}

function buildReadmeContent(name: string, stackLabel: string) {
  return `# ${name}

## Overview
- Stack: ${stackLabel}
- Managed by ForgeFlow

## Local Development
- Add startup, test, build, and deploy notes here
`;
}

function shouldSkipDirectory(name: string) {
  return [".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"].includes(name);
}

async function collectMarkdownFiles(rootPath: string, maxDepth: number, depth = 0): Promise<string[]> {
  let entries;

  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      if (depth >= maxDepth || shouldSkipDirectory(entry.name)) {
        continue;
      }

      files.push(...(await collectMarkdownFiles(fullPath, maxDepth, depth + 1)));
      continue;
    }

    if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readSnippet(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" ");
  } catch {
    return "";
  }
}

function scoreFile(filePath: string, keywords: string[]) {
  const basename = path.basename(filePath).toLowerCase();
  return keywords.reduce((score, keyword) => score + (basename.includes(keyword) ? 3 : 0), 0);
}

function pickBestFile(files: string[], keywords: string[]) {
  return [...files]
    .map((filePath) => ({
      filePath,
      score: scoreFile(filePath, keywords),
    }))
    .sort((left, right) => right.score - left.score)[0]?.filePath;
}

function scoreIntroFile(filePath: string, projectHints: string[]) {
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  let score = 0;
  const strongSignals = [
    "full-development-reference",
    "development-reference",
    "project-reference",
    "technical-reference",
    "implementation-reference",
  ];
  const mediumSignals = ["reference", "overview", "architecture", "spec", "prd", "gdd", "design"];
  const weakSignals = ["readme", "guide", "manual"];
  const negativeSignals = ["autopilot", "agent", "agents", "system", "master", "changelog", "privacy", "terms"];

  for (const signal of strongSignals) {
    if (basename.includes(signal)) {
      score += 12;
    }
  }

  for (const signal of mediumSignals) {
    if (basename.includes(signal)) {
      score += 5;
    }
  }

  for (const signal of weakSignals) {
    if (basename.includes(signal)) {
      score += 1;
    }
  }

  for (const signal of negativeSignals) {
    if (basename.includes(signal)) {
      score -= 6;
    }
  }

  if (normalizedPath.includes("/docs/")) {
    score += 3;
  }

  for (const hint of projectHints) {
    if (hint && (basename.includes(hint) || normalizedPath.includes(hint))) {
      score += 4;
    }
  }

  return score;
}

function pickIntroFile(files: string[], projectHints: string[]) {
  return [...files]
    .map((filePath) => ({
      filePath,
      score: scoreIntroFile(filePath, projectHints),
    }))
    .sort((left, right) => right.score - left.score)[0]?.filePath;
}

function rankReferenceDocs(files: string[], projectHints: string[]) {
  return [...files]
    .map((filePath) => {
      const basename = path.basename(filePath).toLowerCase();
      const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
      let score = scoreIntroFile(filePath, projectHints);

      if (/(formula|event|llm|gdd|design|architecture|reference|overview)/.test(basename)) {
        score += 4;
      }

      if (normalizedPath.includes("/docs/")) {
        score += 2;
      }

      if (/(completed|future|todo|implementation|plan)/.test(basename)) {
        score -= 3;
      }

      return {
        filePath,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.filePath);
}

function buildSnippetShortlist(input: {
  introFilePath: string;
  doneProgressFilePath: string;
  futureFilePath: string;
  implementationPlanFilePath: string;
  todoProgressFilePath: string;
  referenceDocs: string[];
}) {
  return Array.from(
    new Set(
      [
        input.introFilePath,
        input.doneProgressFilePath,
        input.futureFilePath,
        input.implementationPlanFilePath,
        input.todoProgressFilePath,
        ...input.referenceDocs.slice(0, 2),
      ].filter(Boolean),
    ),
  );
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function resolveWorkingProjectPath(rootPath: string) {
  const rootPackage = await readJsonFile<{ name?: string; scripts?: Record<string, string> }>(
    path.join(rootPath, "package.json"),
  );

  if (rootPackage) {
    return rootPath;
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !shouldSkipDirectory(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(rootPath, entry.name);
        const packageJson = await readJsonFile<{ name?: string; scripts?: Record<string, string> }>(
          path.join(fullPath, "package.json"),
        );

        if (!packageJson) {
          return null;
        }

        return {
          fullPath,
          score: (/(web|frontend|front|app|client)/i.test(entry.name) ? 5 : 0) + Object.keys(packageJson.scripts ?? {}).length,
        };
      }),
  );

  return candidates
    .filter((candidate): candidate is { fullPath: string; score: number } => Boolean(candidate))
    .sort((left, right) => right.score - left.score)[0]?.fullPath ?? rootPath;
}

type PackageJsonSummary = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function classifyPackageRole(dirName: string, packageJson: PackageJsonSummary | null) {
  const name = dirName.toLowerCase();
  const dependencyNames = Object.keys({
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  }).join(" ").toLowerCase();
  const scriptNames = Object.keys(packageJson?.scripts ?? {}).join(" ").toLowerCase();
  const source = `${name} ${dependencyNames} ${scriptNames}`;

  const frontendSignals = /(next|react|vite|frontend|front|client|web|astro|nuxt)/;
  const backendSignals = /(backend|server|api|express|fastify|nest|fastapi|django|flask|spring)/;
  const toolingSignals = /(tool|script|cli|infra|config|shared|package|lib)/;

  if (frontendSignals.test(source) && backendSignals.test(source)) {
    return "fullstack" as const;
  }

  if (frontendSignals.test(source)) {
    return "frontend" as const;
  }

  if (backendSignals.test(source)) {
    return "backend" as const;
  }

  if (toolingSignals.test(source)) {
    return "tooling" as const;
  }

  return "unknown" as const;
}

async function detectWorkspaceLayout(rootPath: string, resolvedWorkPath: string, rootPackage: PackageJsonSummary | null) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const packageRoots = await Promise.all(
    [
      {
        fullPath: rootPath,
        name: path.basename(rootPath),
      },
      ...entries
        .filter((entry) => entry.isDirectory() && !shouldSkipDirectory(entry.name))
        .map((entry) => ({
          fullPath: path.join(rootPath, entry.name),
          name: entry.name,
        })),
    ].map(async (entry) => {
      const packageJson =
        entry.fullPath === rootPath
          ? rootPackage
          : await readJsonFile<PackageJsonSummary>(path.join(entry.fullPath, "package.json"));

      if (!packageJson) {
        return null;
      }

      return {
        path: entry.fullPath,
        packageName: packageJson.name ?? null,
        role: classifyPackageRole(entry.name, packageJson),
        scripts: Object.keys(packageJson.scripts ?? {}),
      };
    }),
  );

  const normalizedPackages = packageRoots.filter(
    (entry): entry is NonNullable<(typeof packageRoots)[number]> => Boolean(entry),
  );

  const frontendRoot =
    normalizedPackages.find((entry) => entry.path === resolvedWorkPath && entry.role === "frontend")?.path ??
    normalizedPackages.find((entry) => entry.role === "frontend")?.path ??
    null;
  const backendRoot =
    normalizedPackages.find((entry) => entry.role === "backend")?.path ??
    normalizedPackages.find((entry) => entry.role === "fullstack" && entry.path !== frontendRoot)?.path ??
    null;
  const docsRootCandidates = [
    path.join(rootPath, "docs"),
    path.join(resolvedWorkPath, "docs"),
    path.join(rootPath, ".interface-design"),
  ];
  const docsRoot =
    (
      await Promise.all(
        docsRootCandidates.map(async (candidate) => {
          try {
            const stats = await fs.stat(candidate);
            return stats.isDirectory() ? candidate : null;
          } catch {
            return null;
          }
        }),
      )
    ).find(Boolean) ?? null;

  return {
    workspaceRoot: rootPath,
    docsRoot,
    frontendRoot,
    backendRoot,
    packageRoots: normalizedPackages,
  };
}

function buildConversationText(conversation: IntakeMessage[]) {
  if (conversation.length === 0) {
    return "No prior conversation.";
  }

  return conversation.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function extractJsonObject(text: string) {
  const eventStreamText = extractTextFromJsonEventStream(text);
  const normalizedText = eventStreamText?.trim() || text.trim();
  const fencedMatch = normalizedText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? normalizedText;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new ForgeFlowExecutionError({
      code: "MODEL_JSON_NOT_FOUND",
      message: "Model response did not contain a JSON object",
      details: {
        output: candidate.slice(Math.max(0, candidate.length - 1200)),
      },
    });
  }

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch (error) {
    throw new ForgeFlowExecutionError({
      code: "MODEL_JSON_INVALID",
      message: "Model response contained invalid JSON",
      details: {
        cause: error instanceof Error ? error.message : String(error),
        output: candidate.slice(Math.max(0, candidate.length - 1200)),
      },
    });
  }
}

async function executeIntakeModel<T>(input: {
  provider: string;
  model: string;
  rootPath: string;
  executionRootPath?: string;
  useIsolatedCwd?: boolean;
  systemPrompt: string;
  goal: string;
  rawTaskText: string;
  parser: (value: unknown) => T;
}, options: IntakeExecutionOptions = {}) {
  assertNotAborted(options);
  if (input.provider === "mock") {
    options.onLog?.("Skipping model execution because provider=mock.");
    return null;
  }

  options.onLog?.(`Preparing model execution for provider=${input.provider} model=${input.model}`);
  const executionCwd =
    input.useIsolatedCwd === false
      ? path.resolve(input.executionRootPath ?? input.rootPath)
      : await ensureNeutralIntakeDirectory();
  options.onLog?.(
    input.useIsolatedCwd === false
      ? `Using project-aware intake cwd: ${executionCwd}`
      : `Using isolated intake cwd: ${executionCwd}`,
  );

  if (!env.OPENCODE_BASE_URL) {
    const cliPath = await resolveCliPath(env.OPENCODE_CLI_PATH);
    const normalizedModel = input.model.includes("/") ? input.model : `${input.provider}/${input.model}`;
    const prompt = [
      input.systemPrompt.trim(),
      "",
      `Goal: ${input.goal}`,
      "",
      "Return JSON only.",
      input.rawTaskText.trim(),
    ].join("\n");
    const invocation = await resolveCliCommandInvocation(cliPath, [
      "run",
      prompt,
      "--model",
      normalizedModel,
      "--dir",
      executionCwd,
      "--format",
      "json",
      "--agent",
      "summary",
    ]);
    const commandLabel = [invocation.file, ...invocation.args.filter((arg) => !arg.includes("\n")).slice(0, 8)].join(" ");

    options.onLog?.("Starting PTY-backed OpenCode intake execution.");
    options.onLog?.(`model=${normalizedModel}`);
    options.onLog?.(`cwd=${executionCwd}`);
    options.onLog?.(`command=${commandLabel}`);

    const result = await runPtyProcessCapture({
      file: invocation.file,
      args: invocation.args,
      cwd: executionCwd,
      timeoutMs: env.OPENCODE_INTAKE_TIMEOUT_MS,
    });

    if (result.timedOut) {
      options.onLog?.(`PTY intake execution timed out after ${env.OPENCODE_INTAKE_TIMEOUT_MS}ms.`);
      if (result.output.trim()) {
        options.onLog?.(`PTY output tail: ${result.output.slice(-400)}`);
      }
      throw new ForgeFlowExecutionError({
        code: "CLI_TIMEOUT",
        message: `OpenCode CLI timed out after ${env.OPENCODE_INTAKE_TIMEOUT_MS}ms for model ${normalizedModel}. cwd=${executionCwd}. command=${commandLabel}`,
        details: {
          output: result.output.slice(-1200),
          probe: "pty-process",
        },
      });
    }

    if (!result.ok && result.exitCode !== 0) {
      options.onLog?.(`PTY intake execution exited with code ${result.exitCode ?? "unknown"}.`);
      if (result.output.trim()) {
        options.onLog?.(`PTY output tail: ${result.output.slice(-400)}`);
      }
      throw new ForgeFlowExecutionError({
        code: "CLI_EXIT_NON_ZERO",
        message: `OpenCode CLI exited with code ${result.exitCode ?? "unknown"} for model ${normalizedModel}. cwd=${executionCwd}. command=${commandLabel}`,
        details: {
          output: result.output.slice(-1200),
          probe: "pty-process",
        },
      });
    }

    options.onLog?.("Model returned output from PTY execution. Parsing JSON payload.");
    const parsedJson = extractJsonObject(result.output);

    try {
      return input.parser(parsedJson);
    } catch (error) {
      throw new ForgeFlowExecutionError({
        code: "MODEL_OUTPUT_SCHEMA_INVALID",
        message: "Model output failed schema validation",
        details: {
          cause: error instanceof Error ? error.message : String(error),
          output: result.output.slice(-1200),
        },
      });
    }
  }

  const executor = createAgentExecutor(input.provider, {
    baseUrl: env.OPENCODE_BASE_URL,
    apiKey: env.OPENCODE_API_KEY,
    cliPath: env.OPENCODE_CLI_PATH,
    timeoutMs: env.OPENCODE_INTAKE_TIMEOUT_MS,
    onLog: options.onLog,
    signal: options.signal,
  });

  const result = await executor.execute({
    taskId: `intake-${Date.now()}`,
    taskCode: "intake",
    projectId: "intake",
    projectRootPath: executionCwd,
    roleName: "planner",
    provider: input.provider,
    model: input.model,
    systemPrompt: input.systemPrompt,
    goal: input.goal,
    rawTaskText: input.rawTaskText,
    relevantFiles: [],
  });

  options.onLog?.("Model returned output. Parsing JSON payload.");
  const parsedJson = extractJsonObject(result.rawOutput);

  try {
    return input.parser(parsedJson);
  } catch (error) {
    throw new ForgeFlowExecutionError({
      code: "MODEL_OUTPUT_SCHEMA_INVALID",
      message: "Model output failed schema validation",
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function heuristicBrainstormDraft(input: z.infer<typeof brainstormSchema>): HeuristicBrainstormDraft {
  const notes = input.notes?.trim() ?? "";
  const projectName = inferProjectName(input.projectName, input.idea);
  const stack = inferStackNotes(`${input.idea}\n${notes}\n${buildConversationText(input.conversation)}`);
  const milestones = inferMilestones(`${input.idea}\n${notes}`);
  const docsDir = path.join(input.rootPath, "docs");
  const todoPath = path.join(input.rootPath, "TODO.md");
  const introPath = path.join(docsDir, "project-brief.md");
  const implementationPlanFilePath = path.join(docsDir, "implementation-plan.md");
  const readmePath = path.join(input.rootPath, "README.md");

  const bootstrapFiles: StarterFileDraft[] = [
    {
      path: readmePath,
      title: "README",
      content: buildReadmeContent(projectName, stack.label),
    },
    {
      path: introPath,
      title: "Project Brief",
      content: buildPrdContent(projectName, input.idea, notes, stack.label, milestones),
    },
    {
      path: implementationPlanFilePath,
      title: "Implementation Plan",
      content: buildPlanContent(projectName, milestones, stack.label),
    },
    {
      path: todoPath,
      title: "TODO",
      content: buildTodoContent(projectName, milestones),
    },
  ];

  return {
    summary: `Created a heuristic starter draft for ${projectName}.`,
    assistantMessage: "I drafted a first pass of the project brief, plan, TODO, and README. Adjust the idea or add constraints and I will refine it.",
    suggestedProject: {
      name: projectName,
      projectType: "greenfield",
      rootPath: input.rootPath,
      introFilePath: introPath,
      implementationPlanFilePath,
      todoProgressFilePath: todoPath,
      buildCommand: stack.commands.buildCommand,
      testCommand: stack.commands.testCommand,
      lintCommand: stack.commands.lintCommand,
      startCommand: stack.commands.startCommand,
      allowedPaths: stack.allowedPaths,
      blockedPaths: ["node_modules", ".env"],
      defaultBranch: "main",
    },
    assumptions: [
      "Start with a single repo and a minimal structure",
      "Use TODO.md as the primary execution list",
      "Keep planning docs under docs/",
    ],
    milestones,
    openQuestions: [
      "What must the first demo include",
      "Are there fixed stack or deployment constraints",
      "Should the repo be split into multiple apps from day one",
    ],
    bootstrapFiles,
  };
}

function buildBrainstormPrompt() {
  return `You are an expert software project intake planner.

Your task is to turn a user's project idea and conversation history into a concrete starter plan.
Return only one JSON object. Do not wrap it in markdown.

The JSON object must have exactly these fields:
- summary: string
- assistantMessage: string
- suggestedProject: {
    name: string,
    projectType: "greenfield",
    rootPath: string,
    introFilePath: string,
    implementationPlanFilePath: string,
    todoProgressFilePath: string,
    buildCommand: string,
    testCommand: string,
    lintCommand: string,
    startCommand: string,
    allowedPaths: string[],
    blockedPaths: string[],
    defaultBranch: string
  }
- assumptions: string[]
- milestones: string[]
- openQuestions: string[]
- bootstrapFiles: Array<{ path: string, title: string, content: string }>

Use the requested root path exactly. Generate practical file contents.`;
}

async function llmBrainstormDraft(input: z.infer<typeof brainstormSchema>, options: IntakeExecutionOptions = {}) {
  assertNotAborted(options);
  options.onLog?.(`Generating heuristic draft for ${input.rootPath}`);
  const heuristic = heuristicBrainstormDraft(input);

  if (input.strategy === "heuristic") {
    options.onLog?.("Skipping model refinement because strategy=heuristic.");
    return {
      ...heuristic,
      assistantMessage: `${heuristic.assistantMessage} This draft is currently locked to heuristic-only intake mode.`,
      engine: "heuristic-forced" as const,
      provider: input.provider,
      model: input.model,
    };
  }

  let llmResult: z.infer<typeof brainstormResultSchema> | null = null;

  try {
    llmResult = await executeIntakeModel({
      provider: input.provider,
      model: input.model,
      rootPath: input.rootPath,
      systemPrompt: buildBrainstormPrompt(),
      goal: "Create or refine a new project starter draft",
      rawTaskText: JSON.stringify(
        {
          projectName: input.projectName,
          rootPath: input.rootPath,
          idea: input.idea,
          latestUserInstruction: input.notes ?? "",
          conversation: input.conversation,
          heuristic: {
            summary: heuristic.summary,
            suggestedProject: heuristic.suggestedProject,
            milestones: heuristic.milestones,
            openQuestions: heuristic.openQuestions,
          },
        },
        null,
        2,
      ),
      parser: (value) => brainstormResultSchema.parse(value),
    }, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model refinement failed";
    options.onLog?.(`Model refinement failed. Falling back to heuristic draft.`);
    options.onLog?.(message);
    if (error instanceof ForgeFlowExecutionError && typeof error.details?.output === "string" && error.details.output.trim()) {
      options.onLog?.(`Model output tail: ${error.details.output.slice(-400)}`);
    }

    return {
      ...heuristic,
      assistantMessage: `${heuristic.assistantMessage} Model refinement timed out, so this draft is currently based on the local heuristic pass.`,
      engine: "heuristic-fallback" as const,
      provider: input.provider,
      model: input.model,
    };
  }

  return llmResult
    ? {
        ...llmResult,
        engine: "opencode" as const,
        provider: input.provider,
        model: input.model,
      }
    : {
        ...heuristic,
        engine: "heuristic" as const,
        provider: "mock",
        model: input.model,
      };
}

function buildDetectPrompt() {
  return `You are an expert engineering intake analyst.

You are given a scanned project structure, scripts, markdown document candidates, and prior conversation.
Choose the best primary project reference document, summarize the project clearly, and refine the suggested import config.
Return only one JSON object. Do not wrap it in markdown.

The JSON object may include only the fields you are confident about. Omit fields you are unsure about.
Prefer returning a smaller valid JSON object over guessing.

Allowed top-level fields:
- summary: string
- assistantMessage: string
- suggestedProject: {
    name?: string,
    projectType?: "existing",
    rootPath?: string,
    introFilePath?: string,
    doneProgressFilePath?: string,
    futureFilePath?: string,
    implementationPlanFilePath?: string,
    referenceDocs?: string[],
    todoProgressFilePath?: string,
    buildCommand?: string,
    testCommand?: string,
    lintCommand?: string,
    startCommand?: string,
    allowedPaths?: string[],
    blockedPaths?: string[],
    defaultBranch?: string
  }
- memorySummary: string[]

Prefer true project overview or development-reference documents over script readmes and operational files.`;
}

async function heuristicDetectExistingProject(
  input: z.infer<typeof detectExistingSchema>,
  options: IntakeExecutionOptions = {},
): Promise<HeuristicExistingAnalysis> {
  assertNotAborted(options);
  const resolvedRootPath = path.resolve(input.rootPath);
  options.onLog?.(`Validating root path: ${resolvedRootPath}`);
  await fs.access(resolvedRootPath);
  const rootPackage = await readJsonFile<PackageJsonSummary>(path.join(resolvedRootPath, "package.json"));

  options.onLog?.("Resolving working project directory.");
  const resolvedWorkPath = await resolveWorkingProjectPath(resolvedRootPath);
  const workspace = await detectWorkspaceLayout(resolvedRootPath, resolvedWorkPath, rootPackage ?? null);
  const parentPath = path.dirname(resolvedWorkPath);
  const searchRoots = Array.from(
    new Set([
      workspace.workspaceRoot,
      resolvedRootPath,
      resolvedWorkPath,
      ...(workspace.docsRoot ? [workspace.docsRoot] : []),
      ...(workspace.frontendRoot ? [workspace.frontendRoot] : []),
      ...(workspace.backendRoot ? [workspace.backendRoot] : []),
      path.join(resolvedRootPath, "docs"),
      path.join(resolvedWorkPath, "docs"),
      parentPath,
      path.join(parentPath, "docs"),
    ]),
  );

  options.onLog?.(`Scanning markdown files from ${searchRoots.length} search roots.`);
  const markdownFiles = (await Promise.all(searchRoots.map((searchRoot) => collectMarkdownFiles(searchRoot, 2)))).flat();
  assertNotAborted(options);
  const uniqueMarkdownFiles = Array.from(new Set(markdownFiles));
  options.onLog?.(`Collected ${uniqueMarkdownFiles.length} markdown files.`);

  const packageJson = await readJsonFile<PackageJsonSummary>(
    path.join(resolvedWorkPath, "package.json"),
  );
  options.onLog?.(`Resolved work path: ${resolvedWorkPath}`);
  options.onLog?.(
    `Workspace layout: frontend=${workspace.frontendRoot ?? "n/a"} backend=${workspace.backendRoot ?? "n/a"} docs=${workspace.docsRoot ?? "n/a"}`,
  );
  const projectHints = Array.from(
    new Set(
      [path.basename(resolvedWorkPath), packageJson?.name]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase()),
    ),
  );

  const requestedTodoProgressFilePath = pickBestFile(uniqueMarkdownFiles, ["todo"]) ?? "";
  const resolvedTaskSource = requestedTodoProgressFilePath
    ? await resolveTaskSourceFile(requestedTodoProgressFilePath)
    : null;
  const todoProgressFilePath = resolvedTaskSource?.resolvedFilePath ?? requestedTodoProgressFilePath;
  const doneProgressFilePath = pickBestFile(uniqueMarkdownFiles, ["completed", "done", "finished"]) ?? "";
  const futureFilePath = pickBestFile(uniqueMarkdownFiles, ["future", "roadmap", "backlog"]) ?? "";
  const implementationPlanFilePath = pickBestFile(uniqueMarkdownFiles, ["implementation", "plan"]) ?? "";
  const introFilePath = pickIntroFile(uniqueMarkdownFiles, projectHints) ?? "";

  if (resolvedTaskSource?.viaLinkedDoc) {
    options.onLog?.(
      `Resolved task source from index TODO ${requestedTodoProgressFilePath} to linked task file ${todoProgressFilePath}.`,
    );
  }

  const selectedFiles = new Set(
    [todoProgressFilePath, doneProgressFilePath, futureFilePath, implementationPlanFilePath, introFilePath].filter(Boolean),
  );
  const referenceDocs = rankReferenceDocs(
    uniqueMarkdownFiles.filter((filePath) => !selectedFiles.has(filePath)),
    projectHints,
  ).slice(0, 8);
  if (
    resolvedTaskSource?.viaLinkedDoc &&
    requestedTodoProgressFilePath &&
    !referenceDocs.includes(requestedTodoProgressFilePath)
  ) {
    referenceDocs.unshift(requestedTodoProgressFilePath);
  }
  const snippetShortlist = buildSnippetShortlist({
    introFilePath,
    doneProgressFilePath,
    futureFilePath,
    implementationPlanFilePath,
    todoProgressFilePath,
    referenceDocs,
  });
  options.onLog?.(`Phase 1 complete: shortlisted ${snippetShortlist.length} docs from filename and path signals.`);

  const scripts = packageJson?.scripts ?? {};
  const startCommand = scripts.dev ? "npm run dev" : scripts.start ? "npm run start" : "";
  const buildCommand = scripts.build ? "npm run build" : "";
  const lintCommand = scripts.lint ? "npm run lint" : "";
  const testCommand = scripts["smoke:web"] ? "npm run smoke:web" : scripts.test ? "npm run test" : "";

  const discoveredDirs = await fs.readdir(resolvedWorkPath, { withFileTypes: true }).catch(() => []);
  const keyDirectories = discoveredDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !shouldSkipDirectory(name))
    .slice(0, 8);

  options.onLog?.(`Phase 2: reading ${snippetShortlist.length} shortlisted docs for lightweight snippets.`);
  const snippetEntries = await Promise.all(
    snippetShortlist.map(async (filePath) => ({
      path: filePath,
      snippet: await readSnippet(filePath),
    })),
  );
  assertNotAborted(options);
  const snippetMap = new Map(snippetEntries.filter((entry) => entry.snippet).map((entry) => [entry.path, entry.snippet]));
  const docMemory = snippetShortlist
    .map((filePath) => ({
      path: filePath,
      snippet: snippetMap.get(filePath) ?? "",
    }))
    .filter((entry) => entry.snippet);
  options.onLog?.(`Prepared ${docMemory.length} shortlisted document snippets and ${Object.keys(scripts).length} package scripts.`);

  return {
    summary: "Scanned the workspace, identified the working app, and grouped the main markdown sources and scripts.",
    assistantMessage:
      "I identified the likely working app, TODO source, planning docs, primary reference doc, and the broader workspace layout. Review the import scope before confirming, especially if the repo contains both frontend and backend apps.",
    suggestedProject: {
      name: packageJson?.name ?? path.basename(resolvedWorkPath),
      projectType: "existing",
      rootPath: resolvedWorkPath,
      introFilePath,
      doneProgressFilePath,
      futureFilePath,
      implementationPlanFilePath,
      referenceDocs,
      todoProgressFilePath,
      buildCommand,
      testCommand,
      lintCommand,
      startCommand,
      allowedPaths: ["src", "public", "scripts", "docs"].filter((dir) => keyDirectories.includes(dir)),
      blockedPaths: ["node_modules", ".env"],
      defaultBranch: "main",
    },
    scripts: Object.entries(scripts).map(([name, command]) => ({
      name,
      command,
    })),
    keyDirectories,
    workspace,
    docMemory,
    memorySummary: [
      workspace.frontendRoot ? `Resolved frontend code directory: ${workspace.frontendRoot}` : "Frontend code directory not found",
      workspace.backendRoot ? `Resolved backend code directory: ${workspace.backendRoot}` : "Backend code directory not found",
      workspace.docsRoot ? `Resolved docs directory: ${workspace.docsRoot}` : "Docs directory not found",
      resolvedWorkPath !== resolvedRootPath
        ? `Resolved working code directory: ${resolvedWorkPath}`
        : "Input path is already the working code directory",
      todoProgressFilePath
        ? resolvedTaskSource?.viaLinkedDoc
          ? `Resolved task source from linked TODO doc: ${todoProgressFilePath}`
          : "Located TODO source"
        : "TODO source not found",
      introFilePath ? "Located primary reference doc" : "Primary reference doc not found",
      implementationPlanFilePath ? "Located implementation plan doc" : "Implementation plan doc not found",
    ],
  };
}

async function llmDetectExistingProject(input: z.infer<typeof detectExistingSchema>, options: IntakeExecutionOptions = {}) {
  assertNotAborted(options);
  const heuristic = await heuristicDetectExistingProject(input, options);
  const executionRootPath = heuristic.suggestedProject.rootPath || input.rootPath;

  options.onLog?.(`Using model execution root: ${executionRootPath}`);

  if (input.strategy === "heuristic") {
    options.onLog?.("Skipping model refinement because strategy=heuristic.");
    return {
      ...heuristic,
      assistantMessage:
        `${heuristic.assistantMessage} This import result is currently locked to heuristic-only intake mode.`,
      engine: "heuristic-forced" as const,
      provider: input.provider,
      model: input.model,
    };
  }

  let llmResult: z.infer<typeof detectExistingResultSchema> | null = null;

  try {
    llmResult = await executeIntakeModel({
      provider: input.provider,
      model: input.model,
      rootPath: executionRootPath,
      executionRootPath,
      useIsolatedCwd: false,
      systemPrompt: buildDetectPrompt(),
      goal: "Refine an existing-project intake analysis",
      rawTaskText: JSON.stringify(
        {
          rootPath: input.rootPath,
          latestUserInstruction: input.notes ?? "",
          conversation: input.conversation,
          heuristic: {
            summary: heuristic.summary,
            suggestedProject: heuristic.suggestedProject,
            scripts: heuristic.scripts,
            keyDirectories: heuristic.keyDirectories,
            workspace: heuristic.workspace,
            docMemory: heuristic.docMemory.slice(0, 3),
            memorySummary: heuristic.memorySummary,
          },
        },
        null,
        2,
      ),
      parser: (value) => detectExistingResultSchema.parse(value),
    }, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model refinement failed";
    options.onLog?.(`Model refinement failed. Falling back to heuristic existing-project analysis.`);
    options.onLog?.(message);
    if (error instanceof ForgeFlowExecutionError && typeof error.details?.output === "string" && error.details.output.trim()) {
      options.onLog?.(`Model output tail: ${error.details.output.slice(-400)}`);
    }

    return {
      ...heuristic,
      assistantMessage:
        `${heuristic.assistantMessage} Model refinement did not produce usable structured output, so this import result is currently based on file discovery and document heuristics.`,
      engine: "heuristic-fallback" as const,
      provider: input.provider,
      model: input.model,
    };
  }

  const mergedResult = llmResult
    ? {
        ...heuristic,
        summary: preferNonEmptyString(llmResult.summary, heuristic.summary),
        assistantMessage: preferNonEmptyString(llmResult.assistantMessage, heuristic.assistantMessage),
        suggestedProject: {
          ...heuristic.suggestedProject,
          ...(llmResult.suggestedProject.name?.trim() ? { name: llmResult.suggestedProject.name } : {}),
          ...(llmResult.suggestedProject.rootPath?.trim() ? { rootPath: llmResult.suggestedProject.rootPath } : {}),
          ...(llmResult.suggestedProject.projectType ? { projectType: llmResult.suggestedProject.projectType } : {}),
          ...(llmResult.suggestedProject.introFilePath?.trim()
            ? { introFilePath: llmResult.suggestedProject.introFilePath }
            : {}),
          ...(llmResult.suggestedProject.doneProgressFilePath?.trim()
            ? { doneProgressFilePath: llmResult.suggestedProject.doneProgressFilePath }
            : {}),
          ...(llmResult.suggestedProject.futureFilePath?.trim()
            ? { futureFilePath: llmResult.suggestedProject.futureFilePath }
            : {}),
          ...(llmResult.suggestedProject.implementationPlanFilePath?.trim()
            ? { implementationPlanFilePath: llmResult.suggestedProject.implementationPlanFilePath }
            : {}),
          ...(llmResult.suggestedProject.todoProgressFilePath?.trim()
            ? { todoProgressFilePath: llmResult.suggestedProject.todoProgressFilePath }
            : {}),
          ...(llmResult.suggestedProject.buildCommand?.trim()
            ? { buildCommand: llmResult.suggestedProject.buildCommand }
            : {}),
          ...(llmResult.suggestedProject.testCommand?.trim()
            ? { testCommand: llmResult.suggestedProject.testCommand }
            : {}),
          ...(llmResult.suggestedProject.lintCommand?.trim()
            ? { lintCommand: llmResult.suggestedProject.lintCommand }
            : {}),
          ...(llmResult.suggestedProject.startCommand?.trim()
            ? { startCommand: llmResult.suggestedProject.startCommand }
            : {}),
          ...(llmResult.suggestedProject.defaultBranch?.trim()
            ? { defaultBranch: llmResult.suggestedProject.defaultBranch }
            : {}),
          referenceDocs: preferNonEmptyArray(
            llmResult.suggestedProject.referenceDocs,
            heuristic.suggestedProject.referenceDocs,
          ),
          allowedPaths: preferNonEmptyArray(
            llmResult.suggestedProject.allowedPaths,
            heuristic.suggestedProject.allowedPaths,
          ),
          blockedPaths: preferNonEmptyArray(
            llmResult.suggestedProject.blockedPaths,
            heuristic.suggestedProject.blockedPaths,
          ),
        },
        memorySummary: llmResult.memorySummary.length > 0 ? llmResult.memorySummary : heuristic.memorySummary,
        engine: "opencode" as const,
        provider: input.provider,
        model: input.model,
      }
    : {
        ...heuristic,
        engine: "heuristic" as const,
        provider: "mock",
        model: input.model,
      };

  if (mergedResult.suggestedProject.todoProgressFilePath) {
    const resolvedTaskSource = await resolveTaskSourceFile(mergedResult.suggestedProject.todoProgressFilePath);

    if (resolvedTaskSource.resolvedFilePath !== mergedResult.suggestedProject.todoProgressFilePath) {
      mergedResult.suggestedProject = {
        ...mergedResult.suggestedProject,
        referenceDocs: Array.from(
          new Set([
            ...mergedResult.suggestedProject.referenceDocs,
            mergedResult.suggestedProject.todoProgressFilePath,
          ]),
        ),
        todoProgressFilePath: resolvedTaskSource.resolvedFilePath,
      };
      mergedResult.memorySummary = [
        `Resolved task source from linked TODO doc: ${resolvedTaskSource.resolvedFilePath}`,
        ...mergedResult.memorySummary.filter((entry) => !entry.includes("TODO source")),
      ];
    }
  }

  return mergedResult;
}

export async function brainstormProjectDraft(rawInput: unknown, options: IntakeExecutionOptions = {}) {
  const input = brainstormSchema.parse(rawInput);
  return llmBrainstormDraft(input, options);
}

export async function detectExistingProject(rawInput: unknown, options: IntakeExecutionOptions = {}) {
  const input = detectExistingSchema.parse(rawInput);
  return llmDetectExistingProject(input, options);
}

export async function checkIntakeModelHealth(rawInput: unknown, options: IntakeExecutionOptions = {}) {
  const input = intakeHealthCheckSchema.parse(rawInput);
  const startedAt = Date.now();
  const provider = input.provider;
  const model = input.model;
  const neutralIntakeDirectory = await ensureNeutralIntakeDirectory();
  const requestedRootPath = input.rootPath?.trim();
  let rootPath = neutralIntakeDirectory;

  if (requestedRootPath) {
    const resolvedRootPath = path.resolve(requestedRootPath);

    try {
      const stats = await fs.stat(resolvedRootPath);

      if (stats.isDirectory() && path.parse(resolvedRootPath).root !== resolvedRootPath) {
        rootPath = resolvedRootPath;
      }
    } catch {
      rootPath = neutralIntakeDirectory;
    }
  }

  if (provider === "mock") {
    options.onLog?.("Skipping health check because provider=mock.");
    return {
      ok: true,
      status: "healthy" as const,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      summary: "Mock provider is always available for deterministic intake.",
    };
  }

  const checks: IntakeHealthStage[] = [];
  const cliProbeTimeoutMs = Math.min(env.OPENCODE_HEALTHCHECK_TIMEOUT_MS, 8000);
  const providerProbeTimeoutMs = Math.min(env.OPENCODE_HEALTHCHECK_TIMEOUT_MS, 12000);

  options.onLog?.(`Running intake model health check for ${provider}/${model}`);
  options.onLog?.(`healthcheckRoot=${rootPath}`);
  options.onLog?.(`healthcheckTimeoutMs=${env.OPENCODE_HEALTHCHECK_TIMEOUT_MS}`);

  try {
    const startedCliProbeAt = Date.now();
    const cliProbe = await runCliProbe({
      cliPath: env.OPENCODE_CLI_PATH,
      args: ["run", "--help"],
      cwd: neutralIntakeDirectory,
      timeoutMs: cliProbeTimeoutMs,
      signal: options.signal,
    });

    if (cliProbe.timedOut || cliProbe.exitCode !== 0) {
      const summary = cliProbe.timedOut
        ? `OpenCode CLI did not respond to run --help within ${cliProbeTimeoutMs}ms.`
        : `OpenCode CLI exited with code ${cliProbe.exitCode ?? "unknown"} during CLI probe.`;

      checks.push({
        id: "cli",
        label: "CLI availability",
        ok: false,
        status: "unhealthy",
        latencyMs: Date.now() - startedCliProbeAt,
        summary,
        errorCode: cliProbe.timedOut ? "CLI_TIMEOUT" : "CLI_EXIT_NON_ZERO",
      });

      return {
        ok: false,
        status: "unhealthy" as const,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        summary,
        errorCode: cliProbe.timedOut ? "CLI_TIMEOUT" : "CLI_EXIT_NON_ZERO",
        checks,
      };
    }

    checks.push({
      id: "cli",
      label: "CLI availability",
      ok: true,
      status: "healthy",
      latencyMs: Date.now() - startedCliProbeAt,
      summary: "OpenCode CLI responded to a local help probe.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CLI probe failed";
    checks.push({
      id: "cli",
      label: "CLI availability",
      ok: false,
      status: "unhealthy",
      latencyMs: Date.now() - startedAt,
      summary: message,
      errorCode: error instanceof ForgeFlowExecutionError ? error.code : "CLI_PROBE_FAILED",
    });

    return {
      ok: false,
      status: "unhealthy" as const,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      summary: message,
      errorCode: error instanceof ForgeFlowExecutionError ? error.code : "CLI_PROBE_FAILED",
      checks,
    };
  }

  try {
    const startedProviderProbeAt = Date.now();
    const providerProbe = await runCliProbe({
      cliPath: env.OPENCODE_CLI_PATH,
      args: ["models", provider],
      cwd: neutralIntakeDirectory,
      timeoutMs: providerProbeTimeoutMs,
      signal: options.signal,
    });

    const modelList = providerProbe.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const normalizedModel = model.includes("/") ? model : `${provider}/${model}`;
    const modelVisible = modelList.includes(normalizedModel);

    if (providerProbe.timedOut) {
      checks.push({
        id: "provider",
        label: "Provider registry",
        ok: false,
        status: "degraded",
        latencyMs: Date.now() - startedProviderProbeAt,
        summary: `Listing models for ${provider} timed out after ${providerProbeTimeoutMs}ms.`,
        errorCode: "CLI_TIMEOUT",
      });
    } else if (providerProbe.exitCode !== 0) {
      checks.push({
        id: "provider",
        label: "Provider registry",
        ok: false,
        status: "unhealthy",
        latencyMs: Date.now() - startedProviderProbeAt,
        summary: `Listing models for ${provider} exited with code ${providerProbe.exitCode ?? "unknown"}.`,
        errorCode: "CLI_EXIT_NON_ZERO",
      });
    } else if (!modelVisible) {
      checks.push({
        id: "provider",
        label: "Provider registry",
        ok: false,
        status: "unhealthy",
        latencyMs: Date.now() - startedProviderProbeAt,
        summary: `Provider ${provider} responded, but ${normalizedModel} was not listed.`,
        errorCode: "MODEL_NOT_LISTED",
      });
    } else {
      checks.push({
        id: "provider",
        label: "Provider registry",
        ok: true,
        status: "healthy",
        latencyMs: Date.now() - startedProviderProbeAt,
        summary: `Provider ${provider} is reachable and lists ${normalizedModel}.`,
      });
    }
  } catch (error) {
    checks.push({
      id: "provider",
      label: "Provider registry",
      ok: false,
      status: "degraded",
      latencyMs: Date.now() - startedAt,
      summary: error instanceof Error ? error.message : "Provider registry probe failed",
      errorCode: error instanceof ForgeFlowExecutionError ? error.code : "PROVIDER_PROBE_FAILED",
    });
  }

  try {
    const startedModelProbeAt = Date.now();
    const modelProbeCwd = rootPath || neutralIntakeDirectory;
    const normalizedModel = model.includes("/") ? model : `${provider}/${model}`;
    const modelCommand = `opencode run "Reply with exactly OK" --model ${normalizedModel} --dir "${modelProbeCwd}"`;
    options.onLog?.(`healthcheckProbe=pty`);
    options.onLog?.(`healthcheckCommand=${modelCommand}`);
    const modelProbe = await runPtyCommandProbe({
      cwd: modelProbeCwd,
      command: modelCommand,
      timeoutMs: env.OPENCODE_HEALTHCHECK_TIMEOUT_MS,
      successPattern: /\bok\b/i,
    });

    if (modelProbe.timedOut) {
      throw new ForgeFlowExecutionError({
        code: "CLI_TIMEOUT",
        message: `OpenCode CLI timed out after ${env.OPENCODE_HEALTHCHECK_TIMEOUT_MS}ms for model ${provider}/${model}. cwd=${modelProbeCwd}. command=${modelCommand}`,
        details: {
          output: modelProbe.output.slice(-1200),
          probe: "pty",
        },
      });
    }

    if (!modelProbe.ok) {
      const outputSummary = stripAnsi(modelProbe.output).trim();
      throw new ForgeFlowExecutionError({
        code: "INTAKE_HEALTHCHECK_UNEXPECTED_OUTPUT",
        message: `Health check returned unexpected PTY output: ${outputSummary || "<empty>"}`,
        details: {
          output: outputSummary.slice(-1200),
          probe: "pty",
        },
      });
    }

    return {
      ok: true,
      status: "healthy" as const,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      summary: "Model responded to a lightweight health check.",
      checks: [
        ...checks,
        {
          id: "model",
          label: "Model roundtrip (PTY)",
          ok: true,
          status: "healthy",
          latencyMs: Date.now() - startedModelProbeAt,
          summary: "The selected model returned OK through a PTY-backed terminal probe.",
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed";
    const code =
      error instanceof ForgeFlowExecutionError
        ? error.code
        : error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
          ? String((error as { code: string }).code)
          : "INTAKE_HEALTHCHECK_FAILED";

    options.onLog?.(`Health check failed: ${message}`);

    const modelCheck: IntakeHealthStage = {
      id: "model",
      label: "Model roundtrip (PTY)",
      ok: false,
      status: code === "CLI_TIMEOUT" ? ("degraded" as const) : ("unhealthy" as const),
      latencyMs: Date.now() - startedAt,
      summary: message,
      errorCode: code,
    };

    return {
      ok: false,
      status: code === "CLI_TIMEOUT" ? ("degraded" as const) : ("unhealthy" as const),
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      summary: message,
      errorCode: code,
      checks: [...checks, modelCheck],
    };
  }
}
