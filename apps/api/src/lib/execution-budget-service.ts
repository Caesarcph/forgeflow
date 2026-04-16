import { z } from "zod";
import { prisma } from "@forgeflow/db";
import { publishProjectEvent } from "./events.js";

export interface ExecutionBudgetInput {
  maxTimeMinutes?: number | null;
  maxRetries?: number;
  maxCommands?: number | null;
  maxModelCalls?: number | null;
}

export interface ExecutionBudgetRecord {
  id: string;
  projectId: string;
  maxTimeMinutes: number | null;
  maxRetries: number;
  maxCommands: number | null;
  maxModelCalls: number | null;
}

export const DEFAULT_EXECUTION_BUDGET: Omit<ExecutionBudgetRecord, "id" | "projectId"> = {
  maxTimeMinutes: null,
  maxRetries: 3,
  maxCommands: null,
  maxModelCalls: null,
};

function serializeExecutionBudget(row: {
  id: string;
  projectId: string;
  maxTimeMinutes: number | null;
  maxRetries: number;
  maxCommands: number | null;
  maxModelCalls: number | null;
}): ExecutionBudgetRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    maxTimeMinutes: row.maxTimeMinutes,
    maxRetries: row.maxRetries,
    maxCommands: row.maxCommands,
    maxModelCalls: row.maxModelCalls,
  };
}

export async function getExecutionBudget(projectId: string): Promise<ExecutionBudgetRecord> {
  let budget = await prisma.executionBudget.findUnique({
    where: { projectId },
  });

  if (!budget) {
    budget = await prisma.executionBudget.create({
      data: {
        projectId,
        ...DEFAULT_EXECUTION_BUDGET,
      },
    });
  }

  return serializeExecutionBudget(budget);
}

const executionBudgetUpdateSchema = z.object({
  maxTimeMinutes: z.number().int().min(1).nullable().optional(),
  maxRetries: z.number().int().min(0).optional(),
  maxCommands: z.number().int().min(1).nullable().optional(),
  maxModelCalls: z.number().int().min(1).nullable().optional(),
});

export async function updateExecutionBudget(
  projectId: string,
  rawInput: unknown,
): Promise<ExecutionBudgetRecord> {
  const input = executionBudgetUpdateSchema.parse(rawInput);
  const existing = await prisma.executionBudget.findUnique({
    where: { projectId },
  });

  const data = {
    maxTimeMinutes: input.maxTimeMinutes ?? existing?.maxTimeMinutes ?? DEFAULT_EXECUTION_BUDGET.maxTimeMinutes,
    maxRetries: input.maxRetries ?? existing?.maxRetries ?? DEFAULT_EXECUTION_BUDGET.maxRetries,
    maxCommands: input.maxCommands ?? existing?.maxCommands ?? DEFAULT_EXECUTION_BUDGET.maxCommands,
    maxModelCalls: input.maxModelCalls ?? existing?.maxModelCalls ?? DEFAULT_EXECUTION_BUDGET.maxModelCalls,
  };

  const budget = existing
    ? await prisma.executionBudget.update({
        where: { projectId },
        data,
      })
    : await prisma.executionBudget.create({
        data: {
          projectId,
          ...data,
        },
      });

  publishProjectEvent({
    type: "info",
    projectId,
    timestamp: new Date().toISOString(),
    message: `Execution budget configuration updated.`,
  });

  return serializeExecutionBudget(budget);
}

export function checkExecutionBudgetExhausted(
  budget: ExecutionBudgetRecord,
  usage: {
    elapsedTimeMinutes: number;
    totalRetries: number;
    totalCommands: number;
    totalModelCalls: number;
  },
): { exhausted: boolean; reason?: string } {
  if (budget.maxTimeMinutes !== null && usage.elapsedTimeMinutes >= budget.maxTimeMinutes) {
    return { exhausted: true, reason: `Time budget exhausted (${budget.maxTimeMinutes} minutes)` };
  }

  if (budget.maxRetries > 0 && usage.totalRetries > budget.maxRetries) {
    return { exhausted: true, reason: `Retry budget exhausted (${budget.maxRetries} retries)` };
  }

  if (budget.maxCommands !== null && usage.totalCommands >= budget.maxCommands) {
    return { exhausted: true, reason: `Command budget exhausted (${budget.maxCommands} commands)` };
  }

  if (budget.maxModelCalls !== null && usage.totalModelCalls >= budget.maxModelCalls) {
    return { exhausted: true, reason: `Model call budget exhausted (${budget.maxModelCalls} calls)` };
  }

  return { exhausted: false };
}
