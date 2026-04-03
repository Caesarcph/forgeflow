import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "file:./tests.sqlite";

const { assertIntakeJobTransition, isIntakeJobTerminalStatus } = await import(
  "../apps/api/dist/apps/api/src/lib/intake-jobs.js"
);

test("intake job state machine allows only valid transitions", () => {
  assert.doesNotThrow(() => assertIntakeJobTransition("queued", "running"));
  assert.doesNotThrow(() => assertIntakeJobTransition("queued", "failed"));
  assert.doesNotThrow(() => assertIntakeJobTransition("running", "completed"));
  assert.doesNotThrow(() => assertIntakeJobTransition("running", "cancelled"));
  assert.doesNotThrow(() => assertIntakeJobTransition("cancelled", "cancelled"));

  assert.throws(() => assertIntakeJobTransition("completed", "running"), {
    message: /Invalid intake job transition/,
  });
  assert.throws(() => assertIntakeJobTransition("failed", "completed"), {
    message: /Invalid intake job transition/,
  });
});

test("intake job terminal-status helper is accurate", () => {
  assert.equal(isIntakeJobTerminalStatus("queued"), false);
  assert.equal(isIntakeJobTerminalStatus("running"), false);
  assert.equal(isIntakeJobTerminalStatus("completed"), true);
  assert.equal(isIntakeJobTerminalStatus("failed"), true);
  assert.equal(isIntakeJobTerminalStatus("cancelled"), true);
});
