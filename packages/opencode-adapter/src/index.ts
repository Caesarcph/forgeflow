import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { z } from "zod";

export class ForgeFlowExecutionError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(input: { code: string; message: string; details?: Record<string, unknown> }) {
    super(input.message);
    this.name = "ForgeFlowExecutionError";
    this.code = input.code;
    this.details = input.details;
  }
}

export interface PlannerPayload {
  taskId: string;
  goal: string;
  acceptanceCriteria: string[];
  steps: string[];
  relevantFiles: string[];
  risks: string[];
}

export interface ReviewerPayload {
  verdict: "pass" | "fail";
  summary: string;
  concerns: string[];
  relevantFiles: string[];
}

export interface DebuggerPayload {
  summary: string;
  likelyCause: string;
  nextActions: string[];
  relevantFiles: string[];
}

export interface AgentExecutionContext {
  taskId: string;
  taskCode: string;
  projectId: string;
  projectRootPath: string;
  executionRootPath?: string;
  roleName: string;
  provider: string;
  model: string;
  systemPrompt: string;
  goal: string;
  rawTaskText: string;
  relevantFiles: string[];
}

export interface AgentExecutionResult {
  outputSummary: string;
  rawOutput: string;
  plannerPayload?: PlannerPayload;
  reviewerPayload?: ReviewerPayload;
  debuggerPayload?: DebuggerPayload;
}

export interface AgentExecutionAttempt {
  provider: string;
  model: string;
  status: "success" | "failed";
  errorCode?: string;
  errorMessage?: string;
}

export interface AgentExecutionWithFallbackResult {
  result: AgentExecutionResult;
  providerUsed: string;
  modelUsed: string;
  usedFallback: boolean;
  attempts: AgentExecutionAttempt[];
}

export interface AgentExecutor {
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;
}

const plannerPayloadSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  acceptanceCriteria: z.array(z.string()),
  steps: z.array(z.string()),
  relevantFiles: z.array(z.string()),
  risks: z.array(z.string()),
});

const reviewerPayloadSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string(),
  concerns: z.array(z.string()),
  relevantFiles: z.array(z.string()),
});

const debuggerPayloadSchema = z.object({
  summary: z.string(),
  likelyCause: z.string(),
  nextActions: z.array(z.string()),
  relevantFiles: z.array(z.string()),
});

const openCodeResponseSchema = z.object({
  outputText: z.string().optional(),
  summary: z.string().optional(),
  planner: plannerPayloadSchema.optional(),
  review: reviewerPayloadSchema.optional(),
  debugger: debuggerPayloadSchema.optional(),
});

export interface OpenCodeAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  cliPath?: string;
  timeoutMs?: number;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

class MockAgentExecutor implements AgentExecutor {
  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    if (context.roleName === "planner") {
      const plannerPayload: PlannerPayload = {
        taskId: context.taskId,
        goal: context.goal,
        acceptanceCriteria: [
          "Change scope stays controlled",
          "Verification command remains runnable",
          "Task history stays traceable",
        ],
        steps: [
          "Read the task and surrounding context",
          "Plan the smallest viable implementation path",
          "Hand the implementation to the coder and wait for verification",
        ],
        relevantFiles: context.relevantFiles,
        risks: [
          "This is still the mock executor and will not change project files",
          "Replace mock with a real OpenCode-compatible or CLI executor for real work",
        ],
      };

      return {
        outputSummary: "Mock planner generated a structured handoff.",
        rawOutput: JSON.stringify(plannerPayload, null, 2),
        plannerPayload,
      };
    }

    if (context.roleName === "reviewer") {
      const reviewerPayload: ReviewerPayload = {
        verdict: "pass",
        summary: "Mock reviewer found no blocking issues and approved validation.",
        concerns: [],
        relevantFiles: context.relevantFiles,
      };

      return {
        outputSummary: reviewerPayload.summary,
        rawOutput: JSON.stringify(reviewerPayload, null, 2),
        reviewerPayload,
      };
    }

    if (context.roleName === "debugger") {
      const debuggerPayload: DebuggerPayload = {
        summary: "Mock debugger recommends another focused coding pass.",
        likelyCause: "This is still the mock executor, so no real root cause analysis was performed.",
        nextActions: [
          "Review the latest failed stage output",
          "Apply the smallest fix that addresses the concrete failure",
          "Re-run validation before declaring success",
        ],
        relevantFiles: context.relevantFiles,
      };

      return {
        outputSummary: debuggerPayload.summary,
        rawOutput: JSON.stringify(debuggerPayload, null, 2),
        debuggerPayload,
      };
    }

    return {
      outputSummary: `Mock ${context.roleName} completed without mutating project files.`,
      rawOutput: [
        `role=${context.roleName}`,
        `provider=${context.provider}`,
        `model=${context.model}`,
        `goal=${context.goal}`,
      ].join("\n"),
    };
  }
}

function stripAnsi(text: string) {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function shorten(text: string, maxLength = 220) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function summarizeProcessOutput(stdout: string, stderr: string) {
  const lines = [
    stdout ? `stdout=${shorten(stdout, 320)}` : "",
    stderr ? `stderr=${shorten(stderr, 320)}` : "",
  ].filter(Boolean);

  return lines.length > 0 ? ` (${lines.join(" | ")})` : "";
}

function extractJsonObject(rawText: string) {
  const trimmed = rawText.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function tryExtractReviewerPayload(rawOutput: string) {
  const lower = rawOutput.toLowerCase();
  const hasFail = /\b(fail|reject|block|not.?ready)\b/.test(lower);
  const hasPass = /\b(pass|approve|accept|lgtm|looks good|ready)\b/.test(lower);

  if (!hasPass && !hasFail) {
    return undefined;
  }

  const verdict = hasFail && !hasPass ? "fail" as const : "pass" as const;
  return {
    verdict,
    summary: rawOutput.slice(0, 300).trim(),
    concerns: [],
    relevantFiles: [],
  };
}

function parseStructuredOutput(rawOutput: string) {
  const candidate = extractJsonObject(rawOutput);

  if (!candidate) {
    return null;
  }

  try {
    return openCodeResponseSchema.parse(JSON.parse(candidate));
  } catch {
    // Try lenient JSON parsing — accept partial matches for reviewer
    try {
      const obj = JSON.parse(candidate);
      const review = obj.review ?? obj.result ?? obj.reviewer ?? obj;
      if (review.verdict === "pass" || review.verdict === "fail") {
        return openCodeResponseSchema.parse({
          summary: obj.summary ?? review.summary ?? "",
          review: { verdict: review.verdict, summary: review.summary ?? "", concerns: review.concerns ?? [], relevantFiles: review.relevantFiles ?? [] },
        });
      }
    } catch {
      // fall through
    }
    return null;
  }
}

function parseOpencodeJsonEvents(rawOutput: string) {
  const textParts: string[] = [];
  const errorMessages: string[] = [];

  for (const line of rawOutput.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: string;
        error?: { message?: string };
        part?: {
          type?: string;
          text?: string;
        };
      };

      if (event.type === "text" && typeof event.part?.text === "string") {
        textParts.push(event.part.text);
      }

      if (event.type === "error") {
        const message = event.error?.message ?? event.message;

        if (message) {
          errorMessages.push(message);
        }
      }
    } catch {
      return null;
    }
  }

  return {
    text: textParts.join("").trim(),
    errorMessages,
  };
}

function executionError(code: string, message: string, details?: Record<string, unknown>) {
  return new ForgeFlowExecutionError({
    code,
    message,
    details,
  });
}

function normalizeProvider(provider: string) {
  if (provider === "opencode-zen") {
    return "opencode";
  }

  return provider;
}

function normalizeModel(provider: string, model: string) {
  const normalizedProvider = normalizeProvider(provider);
  const trimmedModel = model.trim();

  if (trimmedModel.includes("/")) {
    return trimmedModel;
  }

  if (normalizedProvider === "nvidia") {
    if (trimmedModel === "glm-5" || trimmedModel === "glm5") {
      return "nvidia/z-ai/glm5";
    }

    if (trimmedModel === "glm-4.7" || trimmedModel === "glm4.7") {
      return "nvidia/z-ai/glm4.7";
    }
  }

  return `${normalizedProvider}/${trimmedModel}`;
}

async function resolveWorkingDirectory(projectRootPath: string) {
  try {
    await access(projectRootPath);
    return projectRootPath;
  } catch {
    const parentDir = path.dirname(projectRootPath);

    try {
      await access(parentDir);
      return parentDir;
    } catch {
      return process.cwd();
    }
  }
}

async function canAccess(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCliPath(cliPath?: string) {
  const explicitPath = cliPath?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  if (process.platform !== "win32") {
    return "opencode";
  }

  const appData = process.env.APPDATA;
  const candidates = [
    "opencode.cmd",
    "opencode.ps1",
    "opencode",
    ...(appData
      ? [
          path.join(appData, "npm", "opencode.cmd"),
          path.join(appData, "npm", "opencode.ps1"),
          path.join(appData, "npm", "opencode"),
        ]
      : []),
  ];

  for (const candidate of candidates) {
    if (!candidate.includes(path.sep)) {
      return candidate;
    }

    if (await canAccess(candidate)) {
      return candidate;
    }
  }

  return "opencode.cmd";
}

async function resolveNodeScriptInvocation(cliPath: string) {
  if (process.platform !== "win32") {
    return null;
  }

  const normalizedPath = cliPath.replace(/\//g, path.sep);

  if (normalizedPath.endsWith(`${path.sep}node_modules${path.sep}opencode-ai${path.sep}bin${path.sep}opencode`)) {
    return {
      file: process.execPath,
      prefixArgs: [normalizedPath],
      shell: false,
    };
  }

  if (!normalizedPath.endsWith(".cmd") && !normalizedPath.endsWith(".ps1")) {
    return null;
  }

  const npmBinDir = path.dirname(normalizedPath);
  const scriptPath = path.join(npmBinDir, "node_modules", "opencode-ai", "bin", "opencode");

  if (!(await canAccess(scriptPath))) {
    return null;
  }

  return {
    file: process.execPath,
    prefixArgs: [scriptPath],
    shell: false,
  };
}

export async function resolveCliCommandInvocation(cliPath: string, args: string[]) {
  const nodeScriptInvocation = await resolveNodeScriptInvocation(cliPath);

  if (nodeScriptInvocation) {
    return {
      file: nodeScriptInvocation.file,
      args: [...nodeScriptInvocation.prefixArgs, ...args],
      shell: nodeScriptInvocation.shell,
    };
  }

  if (process.platform === "win32" && cliPath.endsWith(".ps1")) {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", cliPath, ...args],
      shell: false,
    };
  }

  return {
    file: cliPath,
    args,
    shell: process.platform === "win32" && (cliPath.endsWith(".cmd") || cliPath.endsWith(".bat")),
  };
}

export async function resolveCliInvocation(
  cliPath: string,
  prompt: string,
  model: string,
  workingDirectory: string,
  useOmoRouting = false,
) {
  const baseArgs = useOmoRouting
    ? ["run", prompt, "--dir", workingDirectory, "--format", "json"]
    : ["run", prompt, "--model", model, "--dir", workingDirectory, "--format", "json"];
  return resolveCliCommandInvocation(cliPath, baseArgs);
}

export function buildAgentPromptText(context: AgentExecutionContext) {
  const relevantFiles = context.relevantFiles.length > 0 ? context.relevantFiles.join(", ") : "None";
  const safetyRules = [
    "Execution safety rules:",
    "- Treat the project root as the source of truth, but do not run mutating shell commands in the project root.",
    ...(context.executionRootPath
      ? [`- Run commands and make edits only inside the execution workspace: ${context.executionRootPath}`]
      : []),
    "- Never run destructive reset or cleanup commands, including prisma migrate reset, git reset --hard, git clean -f, rm -rf, format, diskpart, shutdown, or equivalent commands.",
    "- Do not reset databases, wipe generated state, delete dependency folders, or change files outside the execution workspace.",
    "- If a task seems to require a dangerous command, stop and explain the required human action instead.",
  ].join("\n");
  const responseFormat =
    context.roleName === "planner"
      ? [
          "Return JSON only using this shape:",
          '{ "summary": string, "planner": { "taskId": string, "goal": string, "acceptanceCriteria": string[], "steps": string[], "relevantFiles": string[], "risks": string[] } }',
        ].join("\n")
      : context.roleName === "reviewer"
        ? [
            "Return JSON only using this shape:",
            '{ "summary": string, "review": { "verdict": "pass" | "fail", "summary": string, "concerns": string[], "relevantFiles": string[] } }',
          ].join("\n")
        : context.roleName === "debugger"
          ? [
              "Return JSON only using this shape:",
              '{ "summary": string, "debugger": { "summary": string, "likelyCause": string, "nextActions": string[], "relevantFiles": string[] } }',
            ].join("\n")
          : "Respond directly to the task. If the prompt asks for JSON, return JSON only.";

  return [
    `You are acting as the ${context.roleName} agent inside a software delivery orchestrator.`,
    "",
    "System instructions:",
    context.systemPrompt.trim() || "No additional system prompt.",
    "",
    "Task context:",
    `- Task ID: ${context.taskId}`,
    `- Task code: ${context.taskCode}`,
    `- Goal: ${context.goal}`,
    `- Project root: ${context.projectRootPath}`,
    ...(context.executionRootPath ? [`- Execution workspace: ${context.executionRootPath}`] : []),
    `- Relevant files: ${relevantFiles}`,
    "",
    safetyRules,
    "",
    "Raw task text:",
    context.rawTaskText.trim() || "No raw task text provided.",
    "",
    responseFormat,
  ].join("\n");
}

export async function executeAgentWithFallback(input: {
  executor: AgentExecutor;
  context: AgentExecutionContext;
  fallbackModel?: string | null;
  onFallback?: (info: { provider: string; fromModel: string; toModel: string; error: Error }) => void;
}): Promise<AgentExecutionWithFallbackResult> {
  const attempts: AgentExecutionAttempt[] = [];

  try {
    const result = await input.executor.execute(input.context);
    attempts.push({
      provider: input.context.provider,
      model: input.context.model,
      status: "success",
    });

    return {
      result,
      providerUsed: input.context.provider,
      modelUsed: input.context.model,
      usedFallback: false,
      attempts,
    };
  } catch (error) {
    const primaryError = error instanceof Error ? error : new Error(String(error));
    const fallbackModel = input.fallbackModel?.trim();

    attempts.push({
      provider: input.context.provider,
      model: input.context.model,
      status: "failed",
      errorCode: primaryError instanceof ForgeFlowExecutionError ? primaryError.code : undefined,
      errorMessage: primaryError.message,
    });

    if (!fallbackModel || fallbackModel === input.context.model.trim()) {
      throw primaryError;
    }

    input.onFallback?.({
      provider: input.context.provider,
      fromModel: input.context.model,
      toModel: fallbackModel,
      error: primaryError,
    });

    const fallbackContext: AgentExecutionContext = {
      ...input.context,
      model: fallbackModel,
    };

    try {
      const result = await input.executor.execute(fallbackContext);
      attempts.push({
        provider: fallbackContext.provider,
        model: fallbackContext.model,
        status: "success",
      });

      return {
        result,
        providerUsed: fallbackContext.provider,
        modelUsed: fallbackContext.model,
        usedFallback: true,
        attempts,
      };
    } catch (error) {
      const fallbackError = error instanceof Error ? error : new Error(String(error));

      attempts.push({
        provider: fallbackContext.provider,
        model: fallbackContext.model,
        status: "failed",
        errorCode: fallbackError instanceof ForgeFlowExecutionError ? fallbackError.code : undefined,
        errorMessage: fallbackError.message,
      });

      throw executionError(
        "PRIMARY_AND_FALLBACK_MODEL_FAILED",
        `Primary model ${input.context.model} failed and fallback model ${fallbackModel} also failed: ${fallbackError.message}`,
        {
          provider: input.context.provider,
          primaryModel: input.context.model,
          fallbackModel,
          primaryError:
            primaryError instanceof ForgeFlowExecutionError
              ? { code: primaryError.code, message: primaryError.message, details: primaryError.details }
              : { message: primaryError.message },
          fallbackError:
            fallbackError instanceof ForgeFlowExecutionError
              ? { code: fallbackError.code, message: fallbackError.message, details: fallbackError.details }
              : { message: fallbackError.message },
        },
      );
    }
  }
}

class OpenCodeCliExecutor implements AgentExecutor {
  constructor(private readonly options: OpenCodeAdapterOptions) {}

  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const cliPath = await resolveCliPath(this.options.cliPath);
    const workingDirectory = await resolveWorkingDirectory(context.executionRootPath ?? context.projectRootPath);
    const useOmo = normalizeProvider(context.provider) === "omo";
    const resolvedModel = normalizeModel(context.provider, context.model);
    const prompt = buildAgentPromptText(context);
    const invocation = await resolveCliInvocation(cliPath, prompt, resolvedModel, workingDirectory, useOmo);
    const timeoutMs = this.options.timeoutMs ?? 120000;
    const commandLabel = [invocation.file, ...invocation.args.filter((arg) => !arg.includes("\n")).slice(0, 8)].join(" ");
    const emitLog = this.options.onLog;

    return await new Promise<AgentExecutionResult>((resolve, reject) => {
      const child = spawn(invocation.file, invocation.args, {
        cwd: workingDirectory,
        env: process.env,
        windowsHide: true,
        shell: invocation.shell,
      });
      child.stdin?.end();

      let stdout = "";
      let stderr = "";
      let finished = false;
      let aborted = false;
      let timedOut = false;
      let stdoutCarry = "";
      let stderrCarry = "";
      let logFailure: Error | null = null;

      const emit = (line: string) => {
        if (finished || logFailure) {
          return;
        }

        try {
          emitLog?.(line);
        } catch (error) {
          logFailure = error instanceof Error ? error : new Error(String(error));
          child.kill("SIGTERM");
        }
      };

      emit(`Starting OpenCode CLI`);
      emit(useOmo ? `model=omo (auto-routed)` : `model=${resolvedModel}`);
      emit(`cwd=${workingDirectory}`);
      emit(`command=${commandLabel}`);

      const flushLines = (source: "stdout" | "stderr", chunk: string, carryRef: "stdoutCarry" | "stderrCarry") => {
        const combined = `${carryRef === "stdoutCarry" ? stdoutCarry : stderrCarry}${chunk}`;
        const parts = combined.split(/\r?\n/);
        const nextCarry = parts.pop() ?? "";

        for (const part of parts.map((line) => stripAnsi(line).trim()).filter(Boolean)) {
          if (source === "stdout") {
            const parsed = parseOpencodeJsonEvents(part);

            if (parsed?.text) {
              emit(`stdout: ${shorten(parsed.text, 180)}`);
              continue;
            }
          }

          emit(`${source}: ${part}`);
        }

        if (carryRef === "stdoutCarry") {
          stdoutCarry = nextCarry;
        } else {
          stderrCarry = nextCarry;
        }
      };

      const timeout = setTimeout(() => {
        if (finished) {
          return;
        }

        timedOut = true;
        emit(`Timeout after ${timeoutMs}ms. Terminating OpenCode CLI.`);
        child.kill("SIGTERM");
      }, timeoutMs);

      const abortListener = () => {
        if (finished) {
          return;
        }

        aborted = true;
        emit(`Abort requested. Terminating OpenCode CLI.`);
        child.kill("SIGTERM");
      };

      this.options.signal?.addEventListener("abort", abortListener, { once: true });

      child.stdout.on("data", (chunk: Buffer | string) => {
        const text = String(chunk);
        stdout += text;
        flushLines("stdout", text, "stdoutCarry");
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const text = String(chunk);
        stderr += text;
        flushLines("stderr", text, "stderrCarry");
      });

      child.on("error", (error) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeout);
        this.options.signal?.removeEventListener("abort", abortListener);
        reject(
          executionError("CLI_SPAWN_FAILED", `OpenCode CLI failed for ${resolvedModel} in ${workingDirectory}: ${error.message}`, {
            provider: context.provider,
            model: resolvedModel,
            cwd: workingDirectory,
            command: commandLabel,
          }),
        );
      });

      child.on("close", (code, signal) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeout);
        this.options.signal?.removeEventListener("abort", abortListener);

        const finalStdout = stripAnsi(`${stdout}\n${stdoutCarry}`).trim();
        const finalStderr = stripAnsi(`${stderr}\n${stderrCarry}`).trim();
        const outputSummary = summarizeProcessOutput(finalStdout, finalStderr);

        if (logFailure) {
          reject(logFailure);
          return;
        }

        if (aborted) {
          reject(
            executionError(
              "CLI_CANCELLED",
              `OpenCode CLI was cancelled for model ${resolvedModel}. cwd=${workingDirectory}. command=${commandLabel}${outputSummary}`,
              {
                provider: context.provider,
                model: resolvedModel,
                cwd: workingDirectory,
                command: commandLabel,
              },
            ),
          );
          return;
        }

        if (timedOut || signal === "SIGTERM") {
          reject(
            executionError(
              "CLI_TIMEOUT",
              `OpenCode CLI timed out after ${timeoutMs}ms for model ${resolvedModel}. cwd=${workingDirectory}. command=${commandLabel}${outputSummary}`,
              {
                provider: context.provider,
                model: resolvedModel,
                cwd: workingDirectory,
                command: commandLabel,
                timeoutMs,
              },
            ),
          );
          return;
        }

        if (code !== 0) {
          const detail = finalStderr || finalStdout || `Exit code ${code}`;
          reject(
            executionError(
              "CLI_EXIT_NON_ZERO",
              `OpenCode CLI failed for ${resolvedModel} in ${workingDirectory}: ${detail}${outputSummary}`,
              {
                provider: context.provider,
                model: resolvedModel,
                cwd: workingDirectory,
                command: commandLabel,
                exitCode: code,
              },
            ),
          );
          return;
        }

        const parsedEvents = parseOpencodeJsonEvents(finalStdout);
        const rawOutput = parsedEvents?.text || finalStdout || finalStderr || "OpenCode CLI returned no output.";
        const structured = parseStructuredOutput(rawOutput);
        const reviewerPayload = structured?.review ?? tryExtractReviewerPayload(rawOutput);
        emit(`OpenCode CLI completed successfully.`);
        resolve({
          outputSummary: structured?.summary ?? structured?.outputText ?? shorten(rawOutput),
          rawOutput,
          plannerPayload: structured?.planner,
          reviewerPayload,
          debuggerPayload: structured?.debugger,
        });
      });
    });
  }
}

class OpenCodeCompatibleExecutor implements AgentExecutor {
  constructor(private readonly options: OpenCodeAdapterOptions) {}

  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    if (!this.options.baseUrl) {
      throw executionError("HTTP_EXECUTOR_BASE_URL_MISSING", "OPENCODE_BASE_URL is required for the HTTP executor");
    }

    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/execute`, {
      method: "POST",
      signal: this.options.signal,
      headers: {
        "Content-Type": "application/json",
        ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        role: context.roleName,
        provider: context.provider,
        model: context.model,
        systemPrompt: context.systemPrompt,
        input: {
          taskId: context.taskId,
          taskCode: context.taskCode,
          projectId: context.projectId,
          projectRootPath: context.projectRootPath,
          executionRootPath: context.executionRootPath,
          goal: context.goal,
          rawTaskText: context.rawTaskText,
          relevantFiles: context.relevantFiles,
        },
      }),
    });

    if (!response.ok) {
      throw executionError(
        "HTTP_EXECUTOR_FAILED",
        `OpenCode-compatible executor failed with status ${response.status}`,
        {
          provider: context.provider,
          model: context.model,
          statusCode: response.status,
        },
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw executionError("HTTP_EXECUTOR_NON_JSON", "OpenCode-compatible executor returned non-JSON content", {
        provider: context.provider,
        model: context.model,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    let parsed: z.infer<typeof openCodeResponseSchema>;

    try {
      parsed = openCodeResponseSchema.parse(payload);
    } catch (error) {
      throw executionError("HTTP_EXECUTOR_SCHEMA_INVALID", "OpenCode-compatible executor response failed schema validation", {
        provider: context.provider,
        model: context.model,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      outputSummary: parsed.summary ?? parsed.outputText ?? "Executor completed.",
      rawOutput: parsed.outputText ?? JSON.stringify(parsed, null, 2),
      plannerPayload: parsed.planner,
      reviewerPayload: parsed.review,
      debuggerPayload: parsed.debugger,
    };
  }
}

export function createAgentExecutor(provider: string, options: OpenCodeAdapterOptions = {}): AgentExecutor {
  if (provider === "mock") {
    return new MockAgentExecutor();
  }

  if (options.baseUrl?.trim()) {
    return new OpenCodeCompatibleExecutor(options);
  }

  return new OpenCodeCliExecutor(options);
}
