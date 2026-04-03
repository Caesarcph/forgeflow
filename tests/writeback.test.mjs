import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { updateCheckboxInFile } from "../packages/task-writeback/dist/index.js";

async function createTempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("writeback marks a checkbox as done and injects a forgeflow summary comment", async () => {
  const root = await createTempDir("forgeflow-writeback-");
  const filePath = path.join(root, "TODO.md");

  await writeFile(
    filePath,
    ["# TODO", "", "- [ ] P1 Ship the feature", "- [ ] P2 Another task"].join("\n"),
    "utf8",
  );

  await updateCheckboxInFile({
    filePath,
    lineNumber: 3,
    checked: true,
    summary: "Implemented from automated run",
  });

  const updated = await readFile(filePath, "utf8");

  assert.ok(updated.includes("- [x] P1 Ship the feature"));
  assert.ok(updated.includes("<!-- forgeflow: Implemented from automated run -->"));
  assert.ok(updated.includes("- [ ] P2 Another task"));
});

test("writeback replaces an existing forgeflow summary instead of duplicating it", async () => {
  const root = await createTempDir("forgeflow-writeback-existing-");
  const filePath = path.join(root, "TODO.md");

  await writeFile(
    filePath,
    ["- [ ] Task one", "  <!-- forgeflow: Old summary -->", "- [ ] Task two"].join("\n"),
    "utf8",
  );

  await updateCheckboxInFile({
    filePath,
    lineNumber: 1,
    checked: true,
    summary: "New summary",
  });

  const updated = await readFile(filePath, "utf8");

  assert.equal((updated.match(/forgeflow:/g) ?? []).length, 1);
  assert.ok(updated.includes("<!-- forgeflow: New summary -->"));
});
