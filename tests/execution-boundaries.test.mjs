import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const { assertPathWithinRoot } = await import("../apps/api/dist/apps/api/src/lib/execution-boundaries.js");

test("path guard allows files inside the project root", () => {
  const root = path.resolve("D:/tmp/project-root");
  const resolved = assertPathWithinRoot(root, "src/app.ts");

  assert.equal(resolved, path.resolve(root, "src/app.ts"));
});

test("path guard blocks attempts to escape the project root", () => {
  const root = path.resolve("D:/tmp/project-root");

  assert.throws(() => assertPathWithinRoot(root, "../outside.txt"), {
    message: /escapes project root/i,
  });
});
