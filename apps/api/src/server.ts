import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";

import { env } from "./lib/env.js";
import { subscribeToProjectEvents } from "./lib/events.js";
import {
  cancelIntakeJob,
  getIntakeJob,
  initializeIntakeJobs,
  startIntakeJob,
  subscribeToIntakeJob,
} from "./lib/intake-jobs.js";
import { brainstormProjectDraft, checkIntakeModelHealth, detectExistingProject } from "./lib/project-intake.js";
import {
  approveTask,
  createProject,
  getProjectDetail,
  getProjectRuns,
  getRunDetail,
  listAgentConfigs,
  listProjects,
  reparseProject,
  rebuildProjectMemory,
  rejectTask,
  rollbackRun,
  updateProjectMemory,
  updateAgentConfig,
  writebackTask,
} from "./lib/project-service.js";
import { recoverTask, runNextTask, runTask } from "./lib/orchestrator.js";
import {
  closePtySession,
  createPtySession,
  getPtySession,
  resizePtySession,
  runCommandInPtySession,
  subscribeToPtySession,
  writeToPtySession,
} from "./lib/pty-sessions.js";
import { runStartupDiagnostics } from "./lib/startup-diagnostics.js";

const app = Fastify({
  logger: true,
});

function sendApiError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, input: {
  statusCode: number;
  error: string;
  code?: string;
  details?: unknown;
}) {
  return reply.code(input.statusCode).send({
    error: input.error,
    message: input.error,
    statusCode: input.statusCode,
    ...(input.code ? { code: input.code } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
  });
}

await initializeIntakeJobs();

await app.register(cors, {
  origin: true,
});

app.setNotFoundHandler((request, reply) => {
  if (!request.url.startsWith("/api/")) {
    return sendApiError(reply, {
      statusCode: 404,
      error: `Route ${request.method}:${request.url} not found`,
      code: "ROUTE_NOT_FOUND",
    });
  }

  return sendApiError(reply, {
    statusCode: 404,
    error: `Route ${request.method}:${request.url} not found`,
    code: "API_ROUTE_NOT_FOUND",
  });
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  if (error instanceof z.ZodError) {
    return sendApiError(reply, {
      statusCode: 400,
      error: "Request validation failed",
      code: "VALIDATION_ERROR",
      details: error.flatten(),
    });
  }

  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    (error as { statusCode: number }).statusCode >= 400
      ? (error as { statusCode: number }).statusCode
      : 500;

  const message = error instanceof Error && error.message.trim() ? error.message : "Internal server error";
  const details =
    typeof (error as { details?: unknown }).details === "object" && (error as { details?: unknown }).details !== null
      ? (error as { details: unknown }).details
      : undefined;

  return sendApiError(reply, {
    statusCode,
    error: message,
    code: typeof (error as { code?: unknown }).code === "string" ? String((error as { code?: unknown }).code) : undefined,
    details,
  });
});

app.get("/api/health", async () => ({
  ok: true,
  service: "forgeflow-api",
}));

app.get("/api/diagnostics/startup", async () => ({
  diagnostics: await runStartupDiagnostics(),
}));

app.get("/api/projects", async () => ({
  projects: await listProjects(),
}));

app.post("/api/intake/brainstorm", async (request, reply) => {
  try {
    return {
      draft: await brainstormProjectDraft(request.body),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to brainstorm project",
    });
  }
});

app.post("/api/intake/health-check", async (request, reply) => {
  try {
    return {
      health: await checkIntakeModelHealth(request.body),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to run intake model health check",
    });
  }
});

app.post("/api/terminal/sessions", async (request, reply) => {
  const body = z
    .object({
      cwd: z.string().optional(),
    })
    .parse(request.body ?? {});

  return reply.code(201).send({
    session: await createPtySession(body),
  });
});

app.get("/api/terminal/sessions/:sessionId", async (request, reply) => {
  const params = z.object({
    sessionId: z.string(),
  }).parse(request.params);
  const session = getPtySession(params.sessionId);

  if (!session) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Terminal session not found",
      code: "TERMINAL_SESSION_NOT_FOUND",
    });
  }

  return {
    session,
  };
});

app.get("/api/terminal/sessions/:sessionId/events", { logLevel: "warn" }, async (request, reply) => {
  const params = z.object({
    sessionId: z.string(),
  }).parse(request.params);
  const session = getPtySession(params.sessionId);

  if (!session) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Terminal session not found",
      code: "TERMINAL_SESSION_NOT_FOUND",
    });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": request.headers.origin ?? "*",
  });

  reply.raw.write(`data: ${JSON.stringify({ type: "snapshot", session })}\n\n`);

  const unsubscribe = subscribeToPtySession(params.sessionId, (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  if (!unsubscribe) {
    reply.raw.write(
      `data: ${JSON.stringify({
        type: "error",
        message: "Terminal session not found",
      })}\n\n`,
    );
    reply.raw.end();
    return;
  }

  const heartbeat = setInterval(() => {
    reply.raw.write(": keepalive\n\n");
  }, 15000);

  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    reply.raw.end();
  });
});

app.post("/api/terminal/sessions/:sessionId/input", async (request, reply) => {
  const params = z.object({
    sessionId: z.string(),
  }).parse(request.params);
  const body = z
    .object({
      input: z.string().min(1),
    })
    .parse(request.body ?? {});
  const session = writeToPtySession(params.sessionId, body.input);

  if (!session) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Terminal session not found",
      code: "TERMINAL_SESSION_NOT_FOUND",
    });
  }

  return {
    session,
  };
});

app.post("/api/terminal/sessions/:sessionId/run-command", async (request, reply) => {
  const params = z.object({
    sessionId: z.string(),
  }).parse(request.params);
  const body = z
    .object({
      command: z.string().min(1),
    })
    .parse(request.body ?? {});
  const session = runCommandInPtySession(params.sessionId, body.command);

  if (!session) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Terminal session not found",
      code: "TERMINAL_SESSION_NOT_FOUND",
    });
  }

  return {
    session,
  };
});

app.post("/api/terminal/sessions/:sessionId/resize", async (request, reply) => {
  const params = z.object({
    sessionId: z.string(),
  }).parse(request.params);
  const body = z
    .object({
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    })
    .parse(request.body ?? {});
  const session = resizePtySession(params.sessionId, body.cols, body.rows);

  if (!session) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Terminal session not found",
      code: "TERMINAL_SESSION_NOT_FOUND",
    });
  }

  return {
    session,
  };
});

app.post("/api/terminal/sessions/:sessionId/close", async (request, reply) => {
  const params = z.object({
    sessionId: z.string(),
  }).parse(request.params);
  const session = closePtySession(params.sessionId);

  if (!session) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Terminal session not found",
      code: "TERMINAL_SESSION_NOT_FOUND",
    });
  }

  return {
    session,
  };
});

app.post("/api/intake/brainstorm/start", async (request, reply) => {
  try {
    const job = await startIntakeJob("brainstorm", request.body);
    return reply.code(202).send({
      job,
    });
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to start brainstorm job",
    });
  }
});

app.post("/api/intake/detect-existing", async (request, reply) => {
  try {
    return {
      analysis: await detectExistingProject(request.body),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to inspect existing project",
    });
  }
});

app.post("/api/intake/detect-existing/start", async (request, reply) => {
  try {
    const job = await startIntakeJob("detect-existing", request.body);
    return reply.code(202).send({
      job,
    });
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to start existing-project intake job",
    });
  }
});

app.get("/api/intake/jobs/:jobId", { logLevel: "warn" }, async (request, reply) => {
  const params = z.object({
    jobId: z.string(),
  }).parse(request.params);

  const job = await getIntakeJob(params.jobId);

  if (!job) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Intake job not found",
      code: "INTAKE_JOB_NOT_FOUND",
    });
  }

  return {
    job,
  };
});

app.get("/api/intake/jobs/:jobId/events", { logLevel: "warn" }, async (request, reply) => {
  const params = z.object({
    jobId: z.string(),
  }).parse(request.params);
  const job = await getIntakeJob(params.jobId);

  if (!job) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Intake job not found",
      code: "INTAKE_JOB_NOT_FOUND",
    });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": request.headers.origin ?? "*",
  });

  const writeSnapshot = (snapshot: unknown) => {
    reply.raw.write(`data: ${JSON.stringify({ job: snapshot })}\n\n`);
  };

  writeSnapshot(job);

  const unsubscribe = subscribeToIntakeJob(params.jobId, (snapshot) => {
    writeSnapshot(snapshot);
  });

  const heartbeat = setInterval(() => {
    reply.raw.write(": keepalive\n\n");
  }, 15000);

  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    reply.raw.end();
  });
});

app.post("/api/intake/jobs/:jobId/cancel", { logLevel: "warn" }, async (request, reply) => {
  const params = z.object({
    jobId: z.string(),
  }).parse(request.params);

  const job = await cancelIntakeJob(params.jobId);

  if (!job) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Intake job not found",
      code: "INTAKE_JOB_NOT_FOUND",
    });
  }

  return {
    job,
  };
});

app.post("/api/projects", async (request, reply) => {
  try {
    const project = await createProject(request.body);
    return reply.code(201).send({
      detail: project,
    });
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to create project",
    });
  }
});

app.get("/api/projects/:id", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    return {
      detail: await getProjectDetail(params.id),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Project not found",
      code: "PROJECT_NOT_FOUND",
    });
  }
});

app.patch("/api/projects/:id/memory", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    return await updateProjectMemory(params.id, request.body);
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to update project memory",
    });
  }
});

app.post("/api/projects/:id/memory/rebuild", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    return await rebuildProjectMemory(params.id);
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to rebuild project memory",
    });
  }
});

app.get("/api/projects/:id/events", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": request.headers.origin ?? "*",
  });

  reply.raw.write(
    `data: ${JSON.stringify({
      type: "connected",
      projectId: params.id,
      timestamp: new Date().toISOString(),
      message: "Connected to ForgeFlow live events.",
    })}\n\n`,
  );

  const unsubscribe = subscribeToProjectEvents(params.id, (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    reply.raw.write(": keepalive\n\n");
  }, 15000);

  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    reply.raw.end();
  });
});

app.post("/api/projects/:id/reparse", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    return {
      detail: await reparseProject(params.id),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to reparse project",
    });
  }
});

app.post("/api/projects/:id/start", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    return {
      run: await runNextTask(params.id),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to start next task",
    });
  }
});

app.get("/api/projects/:id/tasks", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    const detail = await getProjectDetail(params.id);
    return {
      tasks: detail.tasks,
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Project not found",
      code: "PROJECT_NOT_FOUND",
    });
  }
});

app.get("/api/projects/:id/runs", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    return {
      runs: await getProjectRuns(params.id),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Project not found",
      code: "PROJECT_NOT_FOUND",
    });
  }
});

app.get("/api/projects/:id/agents", async (request, reply) => {
  const params = z.object({
    id: z.string(),
  }).parse(request.params);

  try {
    return {
      agents: await listAgentConfigs(params.id),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Project not found",
      code: "PROJECT_NOT_FOUND",
    });
  }
});

app.patch("/api/projects/:id/agents/:role", async (request, reply) => {
  const params = z.object({
    id: z.string(),
    role: z.string(),
  }).parse(request.params);

  try {
    return {
      agent: await updateAgentConfig(params.id, params.role, request.body),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to update agent config",
    });
  }
});

app.get("/api/runs/:runId", async (request, reply) => {
  const params = z.object({
    runId: z.string(),
  }).parse(request.params);

  try {
    return {
      run: await getRunDetail(params.runId),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 404,
      error: "Run not found",
      code: "RUN_NOT_FOUND",
    });
  }
});

app.post("/api/runs/:runId/rollback", async (request, reply) => {
  const params = z.object({
    runId: z.string(),
  }).parse(request.params);

  try {
    return {
      run: await rollbackRun(params.runId),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to roll back run",
    });
  }
});

app.post("/api/tasks/:taskId/run", async (request, reply) => {
  const params = z.object({
    taskId: z.string(),
  }).parse(request.params);

  try {
    return {
      run: await runTask(params.taskId),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to run task",
    });
  }
});

app.post("/api/tasks/:taskId/retry", async (request, reply) => {
  const params = z.object({
    taskId: z.string(),
  }).parse(request.params);

  try {
    return {
      run: await runTask(params.taskId),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to retry task",
    });
  }
});

app.post("/api/tasks/:taskId/recover", async (request, reply) => {
  const params = z.object({
    taskId: z.string(),
  }).parse(request.params);
  const body = z
    .object({
      targetStage: z.enum(["planning", "coding", "testing"]),
    })
    .parse(request.body ?? {});

  try {
    return {
      run: await recoverTask(params.taskId, body.targetStage),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to recover task",
    });
  }
});

app.post("/api/tasks/:taskId/writeback", async (request, reply) => {
  const params = z.object({
    taskId: z.string(),
  }).parse(request.params);
  const body = z
    .object({
      summary: z.string().optional(),
    })
    .parse(request.body ?? {});

  try {
    return {
      detail: await writebackTask(params.taskId, body.summary),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to write back task",
    });
  }
});

app.post("/api/tasks/:taskId/approve", async (request, reply) => {
  const params = z.object({
    taskId: z.string(),
  }).parse(request.params);
  const body = z
    .object({
      summary: z.string().optional(),
    })
    .parse(request.body ?? {});

  try {
    return {
      detail: await approveTask(params.taskId, body.summary),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to approve task",
    });
  }
});

app.post("/api/tasks/:taskId/reject", async (request, reply) => {
  const params = z.object({
    taskId: z.string(),
  }).parse(request.params);
  const body = z
    .object({
      reason: z.string().optional(),
    })
    .parse(request.body ?? {});

  try {
    return {
      detail: await rejectTask(params.taskId, body.reason),
    };
  } catch (error) {
    return sendApiError(reply, {
      statusCode: 400,
      error: error instanceof Error ? error.message : "Failed to reject task",
    });
  }
});

app.listen({
  port: env.PORT,
  host: "0.0.0.0",
});
