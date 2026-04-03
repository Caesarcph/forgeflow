import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTaskStatusTransition,
  getNextRunnableTask,
  getOrchestratorStartStage,
  getStageRetryDelayMs,
} from "../packages/core/dist/index.js";

test("state machine resolves correct start stage for recovery statuses", () => {
  assert.equal(getOrchestratorStartStage("queued"), "planning");
  assert.equal(getOrchestratorStartStage("ready_for_coding"), "coding");
  assert.equal(getOrchestratorStartStage("reviewing"), "reviewing");
  assert.equal(getOrchestratorStartStage("testing"), "testing");
  assert.equal(getOrchestratorStartStage("debugging"), "debugging");
  assert.equal(getOrchestratorStartStage("done"), null);
});

test("state machine enforces valid and invalid status transitions", () => {
  assert.doesNotThrow(() => assertTaskStatusTransition("queued", "planning"));
  assert.doesNotThrow(() => assertTaskStatusTransition("testing", "debugging"));
  assert.throws(() => assertTaskStatusTransition("queued", "done"));
  assert.throws(() => assertTaskStatusTransition("done", "planning"));
});

test("next runnable task respects dependencies and source order", () => {
  const next = getNextRunnableTask([
    {
      taskCode: "P1-01",
      status: "done",
      dependencies: [],
      sourceLineStart: 1,
    },
    {
      taskCode: "P1-02",
      status: "queued",
      dependencies: ["P1-01"],
      sourceLineStart: 2,
    },
    {
      taskCode: "P1-03",
      status: "queued",
      dependencies: ["P9-99"],
      sourceLineStart: 3,
    },
  ]);

  assert.equal(next?.taskCode, "P1-02");
});

test("retry delay increases per attempt based on stage policy", () => {
  assert.equal(getStageRetryDelayMs("planning", 1), 1000);
  assert.equal(getStageRetryDelayMs("planning", 2), 1000);
  assert.equal(getStageRetryDelayMs("coding", 3), 3000);
  assert.equal(getStageRetryDelayMs("testing", 2), 2000);
});
