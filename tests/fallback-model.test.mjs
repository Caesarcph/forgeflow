import assert from "node:assert/strict";
import test from "node:test";

const { executeAgentWithFallback, ForgeFlowExecutionError } = await import("../packages/opencode-adapter/dist/index.js");

test("fallback model executes when the primary model fails", async () => {
  const calls = [];
  const executor = {
    async execute(context) {
      calls.push(context.model);

      if (context.model === "primary-model") {
        throw new ForgeFlowExecutionError({
          code: "CLI_TIMEOUT",
          message: "primary failed",
        });
      }

      return {
        outputSummary: `ran ${context.model}`,
        rawOutput: context.model,
      };
    },
  };

  const result = await executeAgentWithFallback({
    executor,
    context: {
      taskId: "task-1",
      taskCode: "P1-01",
      projectId: "project-1",
      projectRootPath: "D:/tmp/project",
      roleName: "coder",
      provider: "openai",
      model: "primary-model",
      systemPrompt: "Be precise.",
      goal: "Ship the feature",
      rawTaskText: "- [ ] Ship the feature",
      relevantFiles: [],
    },
    fallbackModel: "backup-model",
  });

  assert.deepEqual(calls, ["primary-model", "backup-model"]);
  assert.equal(result.usedFallback, true);
  assert.equal(result.modelUsed, "backup-model");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.attempts[1].status, "success");
});

test("fallback execution surfaces a combined error when both models fail", async () => {
  const executor = {
    async execute(context) {
      throw new ForgeFlowExecutionError({
        code: context.model === "primary-model" ? "CLI_TIMEOUT" : "CLI_EXIT_NON_ZERO",
        message: `${context.model} failed`,
      });
    },
  };

  await assert.rejects(
    executeAgentWithFallback({
      executor,
      context: {
        taskId: "task-1",
        taskCode: "P1-01",
        projectId: "project-1",
        projectRootPath: "D:/tmp/project",
        roleName: "planner",
        provider: "openai",
        model: "primary-model",
        systemPrompt: "Be precise.",
        goal: "Plan the task",
        rawTaskText: "- [ ] Plan the task",
        relevantFiles: [],
      },
      fallbackModel: "backup-model",
    }),
    {
      message: /Primary model primary-model failed and fallback model backup-model also failed/,
    },
  );
});
