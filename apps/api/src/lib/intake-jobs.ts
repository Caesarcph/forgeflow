import { randomUUID } from "node:crypto";

import { parseJsonField, prisma, stringifyJsonField } from "@forgeflow/db";

import { brainstormProjectDraft, detectExistingProject } from "./project-intake.js";

type IntakeJobKind = "brainstorm" | "detect-existing";
type IntakeJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

const INTAKE_TERMINAL_STATUSES: IntakeJobStatus[] = ["completed", "failed", "cancelled"];
const INTAKE_STATUS_TRANSITIONS: Record<IntakeJobStatus, IntakeJobStatus[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

type PublicIntakeJob = {
  id: string;
  kind: IntakeJobKind;
  status: IntakeJobStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  logs: string[];
  result?: unknown;
  error?: string;
};

const MAX_LOGS = 200;
const activeControllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<(job: PublicIntakeJob) => void>>();

function stamp() {
  return new Date().toISOString();
}

export function isIntakeJobTerminalStatus(status: IntakeJobStatus) {
  return INTAKE_TERMINAL_STATUSES.includes(status);
}

export function assertIntakeJobTransition(from: IntakeJobStatus, to: IntakeJobStatus) {
  if (from === to) {
    return;
  }

  if (!INTAKE_STATUS_TRANSITIONS[from].includes(to)) {
    throw Object.assign(new Error(`Invalid intake job transition: ${from} -> ${to}`), {
      code: "INTAKE_JOB_INVALID_TRANSITION",
      details: {
        from,
        to,
        allowedTargets: INTAKE_STATUS_TRANSITIONS[from],
      },
    });
  }
}

function parseLogs(logsJson: string | null | undefined) {
  return parseJsonField<string[]>(logsJson, []);
}

function toPublicIntakeJob(job: {
  id: string;
  kind: string;
  status: string;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  logsJson: string | null;
  resultJson: string | null;
  error: string | null;
}): PublicIntakeJob {
  return {
    id: job.id,
    kind: job.kind as IntakeJobKind,
    status: job.status as IntakeJobStatus,
    startedAt: job.startedAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    logs: parseLogs(job.logsJson),
    result: job.resultJson ? parseJsonField(job.resultJson, undefined) : undefined,
    error: job.error ?? undefined,
  };
}

async function appendLog(jobId: string, line: string) {
  const current = await prisma.intakeJob.findUniqueOrThrow({
    where: {
      id: jobId,
    },
    select: {
      logsJson: true,
    },
  });

  const logs = [...parseLogs(current.logsJson), `[${stamp()}] ${line}`].slice(-MAX_LOGS);

  await prisma.intakeJob.update({
    where: {
      id: jobId,
    },
    data: {
      logsJson: stringifyJsonField(logs),
    },
  });

  await publishJobUpdate(jobId);
}

async function updateStatus(jobId: string, status: IntakeJobStatus, extra?: { error?: string | null; result?: unknown }) {
  const current = await prisma.intakeJob.findUniqueOrThrow({
    where: {
      id: jobId,
    },
    select: {
      status: true,
    },
  });

  assertIntakeJobTransition(current.status as IntakeJobStatus, status);

  const terminal = isIntakeJobTerminalStatus(status);
  const nextError = extra?.error !== undefined ? extra.error : undefined;
  const nextResult = extra?.result !== undefined ? extra.result : undefined;

  if (status === "completed" && nextResult === undefined) {
    throw Object.assign(new Error("Completed intake jobs must persist a result payload."), {
      code: "INTAKE_JOB_COMPLETED_WITHOUT_RESULT",
      details: {
        jobId,
        status,
      },
    });
  }

  if ((status === "failed" || status === "cancelled") && (!nextError || !String(nextError).trim())) {
    throw Object.assign(new Error("Failed or cancelled intake jobs must persist an error message."), {
      code: "INTAKE_JOB_TERMINAL_WITHOUT_ERROR",
      details: {
        jobId,
        status,
      },
    });
  }

  await prisma.intakeJob.update({
    where: {
      id: jobId,
    },
    data: {
      status,
      finishedAt: terminal ? new Date() : null,
      ...(extra?.error !== undefined ? { error: extra.error } : {}),
      ...(extra?.result !== undefined ? { resultJson: stringifyJsonField(extra.result) } : {}),
    },
  });

  await publishJobUpdate(jobId);
}

async function publishJobUpdate(jobId: string) {
  const subscribers = listeners.get(jobId);

  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const job = await getIntakeJob(jobId);

  if (!job) {
    return;
  }

  for (const listener of subscribers) {
    listener(job);
  }
}

async function runJob(jobId: string, kind: IntakeJobKind, input: unknown) {
  const controller = new AbortController();
  activeControllers.set(jobId, controller);

  try {
    await updateStatus(jobId, "running");
    await appendLog(jobId, `Starting ${kind} job.`);

    const executionOptions = {
      signal: controller.signal,
      onLog: (line: string) => void appendLog(jobId, line),
    };

    const result =
      kind === "brainstorm"
        ? await brainstormProjectDraft(input, executionOptions)
        : await detectExistingProject(input, executionOptions);

    await updateStatus(jobId, "completed", { result });
    await appendLog(jobId, `${kind} job completed.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to run ${kind} job`;
    const status: IntakeJobStatus = controller.signal.aborted ? "cancelled" : "failed";
    await updateStatus(jobId, status, { error: message });
    await appendLog(jobId, message);
  } finally {
    activeControllers.delete(jobId);
  }
}

export async function initializeIntakeJobs() {
  await prisma.intakeJob.updateMany({
    where: {
      status: {
        in: ["queued", "running"],
      },
    },
    data: {
      status: "failed",
      error: "ForgeFlow API restarted before the intake job completed.",
      finishedAt: new Date(),
    },
  });
}

export async function getIntakeJob(jobId: string) {
  const job = await prisma.intakeJob.findUnique({
    where: {
      id: jobId,
    },
  });

  return job ? toPublicIntakeJob(job) : null;
}

export function subscribeToIntakeJob(jobId: string, listener: (job: PublicIntakeJob) => void) {
  const set = listeners.get(jobId) ?? new Set<(job: PublicIntakeJob) => void>();
  set.add(listener);
  listeners.set(jobId, set);

  return () => {
    const current = listeners.get(jobId);

    if (!current) {
      return;
    }

    current.delete(listener);

    if (current.size === 0) {
      listeners.delete(jobId);
    }
  };
}

export async function cancelIntakeJob(jobId: string) {
  const job = await prisma.intakeJob.findUnique({
    where: {
      id: jobId,
    },
  });

  if (!job) {
    return null;
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return toPublicIntakeJob(job);
  }

  activeControllers.get(jobId)?.abort();
  await appendLog(jobId, "Cancellation requested by user.");
  await updateStatus(jobId, "cancelled", {
    error: "Intake job was cancelled by user.",
  });

  const refreshed = await prisma.intakeJob.findUniqueOrThrow({
    where: {
      id: jobId,
    },
  });

  return toPublicIntakeJob(refreshed);
}

export async function startIntakeJob(kind: IntakeJobKind, input: unknown) {
  const job = await prisma.intakeJob.create({
    data: {
      id: randomUUID(),
      kind,
      status: "queued",
      inputJson: stringifyJsonField(input),
      logsJson: stringifyJsonField([]),
    },
  });

  await appendLog(job.id, `Queued ${kind} job.`);
  void runJob(job.id, kind, input);

  const refreshed = await prisma.intakeJob.findUniqueOrThrow({
    where: {
      id: job.id,
    },
  });

  return toPublicIntakeJob(refreshed);
}
