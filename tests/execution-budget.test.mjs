import assert from "node:assert/strict";
import test from "node:test";

const { checkExecutionBudgetExhausted } = await import("../apps/api/dist/apps/api/src/lib/execution-budget-service.js");

test("retry budget allows usage up to the configured retry count", () => {
  const budget = {
    id: "budget_1",
    projectId: "project_1",
    maxTimeMinutes: null,
    maxRetries: 1,
    maxCommands: null,
    maxModelCalls: null,
  };

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 0,
      totalRetries: 1,
      totalCommands: 0,
      totalModelCalls: 0,
    }),
    { exhausted: false },
  );

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 0,
      totalRetries: 2,
      totalCommands: 0,
      totalModelCalls: 0,
    }),
    { exhausted: true, reason: "Retry budget exhausted (1 retries)" },
  );
});

test("command budget is exhausted once the configured command count has been consumed", () => {
  const budget = {
    id: "budget_2",
    projectId: "project_2",
    maxTimeMinutes: null,
    maxRetries: 0,
    maxCommands: 2,
    maxModelCalls: null,
  };

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 0,
      totalRetries: 0,
      totalCommands: 1,
      totalModelCalls: 0,
    }),
    { exhausted: false },
  );

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 0,
      totalRetries: 0,
      totalCommands: 2,
      totalModelCalls: 0,
    }),
    { exhausted: true, reason: "Command budget exhausted (2 commands)" },
  );
});

test("time budget is exhausted once the configured minutes have elapsed", () => {
  const budget = {
    id: "budget_3",
    projectId: "project_3",
    maxTimeMinutes: 5,
    maxRetries: 0,
    maxCommands: null,
    maxModelCalls: null,
  };

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 4,
      totalRetries: 0,
      totalCommands: 0,
      totalModelCalls: 0,
    }),
    { exhausted: false },
  );

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 5,
      totalRetries: 0,
      totalCommands: 0,
      totalModelCalls: 0,
    }),
    { exhausted: true, reason: "Time budget exhausted (5 minutes)" },
  );
});

test("model call budget is exhausted once the configured call count has been consumed", () => {
  const budget = {
    id: "budget_4",
    projectId: "project_4",
    maxTimeMinutes: null,
    maxRetries: 0,
    maxCommands: null,
    maxModelCalls: 3,
  };

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 0,
      totalRetries: 0,
      totalCommands: 0,
      totalModelCalls: 2,
    }),
    { exhausted: false },
  );

  assert.deepEqual(
    checkExecutionBudgetExhausted(budget, {
      elapsedTimeMinutes: 0,
      totalRetries: 0,
      totalCommands: 0,
      totalModelCalls: 3,
    }),
    { exhausted: true, reason: "Model call budget exhausted (3 calls)" },
  );
});
