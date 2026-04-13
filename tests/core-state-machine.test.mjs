import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTaskStatusTransition,
  getNextRunnableTask,
  getOrchestratorStartStage,
  getStageRetryDelayMs,
  isSafeTask,
  getNextRunnableSafeTask,
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

test("isSafeTask identifies documentation tasks as safe", () => {
  assert.equal(isSafeTask("Update README.md with installation instructions"), true);
  assert.equal(isSafeTask("Add documentation for API endpoints"), true);
  assert.equal(isSafeTask("Fix typo in changelog"), true);
  assert.equal(isSafeTask("Update contributing guide"), true);
  assert.equal(isSafeTask("Add license file"), true);
});

test("isSafeTask identifies UI text tasks as safe", () => {
  assert.equal(isSafeTask("Update button text for submit button"), true);
  assert.equal(isSafeTask("Fix error message formatting"), true);
  assert.equal(isSafeTask("Add placeholder text for input field"), true);
  assert.equal(isSafeTask("Update tooltip for help icon"), true);
  assert.equal(isSafeTask("Fix i18n translation key"), true);
});

test("isSafeTask identifies high-risk tasks as unsafe", () => {
  assert.equal(isSafeTask("Fix database migration issue"), false);
  assert.equal(isSafeTask("Update API key configuration"), false);
  assert.equal(isSafeTask("Implement authentication flow"), false);
  assert.equal(isSafeTask("Fix security vulnerability"), false);
  assert.equal(isSafeTask("Delete unused files"), false);
  assert.equal(isSafeTask("Update environment variables"), false);
  assert.equal(isSafeTask("Configure deployment pipeline"), false);
});

test("isSafeTask returns false for tasks that don't match safe patterns", () => {
  assert.equal(isSafeTask("Implement user profile feature"), false);
  assert.equal(isSafeTask("Fix bug in payment processing"), false);
  assert.equal(isSafeTask("Refactor code structure"), false);
});

test("getNextRunnableSafeTask filters to only safe tasks", () => {
  const tasks = [
    { taskCode: "P1-01", status: "queued", dependencies: [], sourceLineStart: 1, rawText: "Update README.md" },
    { taskCode: "P1-02", status: "queued", dependencies: [], sourceLineStart: 2, rawText: "Fix database schema" },
    { taskCode: "P1-03", status: "queued", dependencies: [], sourceLineStart: 3, rawText: "Add button text" },
    { taskCode: "P1-04", status: "queued", dependencies: [], sourceLineStart: 4, rawText: "Implement auth" },
  ];

  const next = getNextRunnableSafeTask(tasks);
  assert.equal(next?.taskCode, "P1-01");
});

test("getNextRunnableSafeTask returns null when no safe tasks available", () => {
  const tasks = [
    { taskCode: "P1-01", status: "queued", dependencies: [], sourceLineStart: 1, rawText: "Fix database schema" },
    { taskCode: "P1-02", status: "queued", dependencies: [], sourceLineStart: 2, rawText: "Implement authentication" },
  ];

  const next = getNextRunnableSafeTask(tasks);
  assert.equal(next, null);
});

test("getNextRunnableSafeTask respects dependencies for safe tasks", () => {
  const tasks = [
    { taskCode: "P1-01", status: "done", dependencies: [], sourceLineStart: 1, rawText: "Update README.md" },
    { taskCode: "P1-02", status: "queued", dependencies: ["P1-01"], sourceLineStart: 2, rawText: "Add changelog entry" },
    { taskCode: "P1-03", status: "queued", dependencies: ["P1-99"], sourceLineStart: 3, rawText: "Fix button text" },
  ];

  const next = getNextRunnableSafeTask(tasks);
  assert.equal(next?.taskCode, "P1-02");
});
