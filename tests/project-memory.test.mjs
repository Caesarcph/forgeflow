import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProjectMemorySnapshot,
  normalizeProjectMemorySnapshot,
  serializeProjectMemorySnapshot,
} from "../apps/api/dist/apps/api/src/lib/project-memory.js";

async function createTempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("project memory snapshot loads snippets from primary docs and TODO", async () => {
  const root = await createTempDir("forgeflow-memory-");
  const docs = path.join(root, "docs");
  await mkdir(docs, { recursive: true });

  const intro = path.join(docs, "reference.md");
  const todo = path.join(root, "TODO.md");
  const completed = path.join(docs, "completed.md");

  await writeFile(intro, "# Reference\n\nPrimary project context.\nArchitecture summary.\n", "utf8");
  await writeFile(todo, "# TODO\n\n- [ ] P1 Something important\n", "utf8");
  await writeFile(completed, "# Completed\n\nAlready shipped.\n", "utf8");

  const snapshot = await buildProjectMemorySnapshot({
    introFilePath: intro,
    doneProgressFilePath: completed,
    futureFilePath: null,
    implementationPlanFilePath: null,
    todoProgressFilePath: todo,
    referenceDocs: [],
  });

  assert.ok(snapshot.summary.includes("Primary project reference is loaded"));
  assert.ok(snapshot.summary.includes("TODO progress file is loaded into memory"));
  assert.ok(snapshot.sources.some((source) => source.path === intro));
  assert.ok(snapshot.sources.some((source) => source.path === todo));
  assert.ok(snapshot.promptBlock.includes("Project memory:"));
  assert.ok(snapshot.relevantFiles.includes(intro));
});

test("persisted project memory payload normalizes and round-trips cleanly", async () => {
  const snapshot = normalizeProjectMemorySnapshot({
    summary: ["  Important reference is pinned  ", "", "TODO is curated"],
    sources: [
      {
        kind: "primary",
        label: " Primary reference ",
        path: " D:/Song/docs/ref.md ",
        snippet: " Main architecture summary ",
      },
      {
        kind: "reference",
        label: "Ignored",
        path: "",
        snippet: "",
      },
    ],
  });

  assert.deepEqual(snapshot.summary, ["Important reference is pinned", "TODO is curated"]);
  assert.equal(snapshot.sources.length, 1);
  assert.equal(snapshot.sources[0].label, "Primary reference");
  assert.equal(snapshot.sources[0].path, "D:/Song/docs/ref.md");
  assert.ok(snapshot.promptBlock.includes("Main architecture summary"));

  const serialized = serializeProjectMemorySnapshot(snapshot);
  assert.ok(serialized.memorySummaryJson);
  assert.ok(serialized.memorySourcesJson);
  assert.ok(serialized.memoryPromptBlock?.includes("Project memory:"));
  assert.ok(serialized.memoryRelevantFilesJson?.includes("D:/Song/docs/ref.md"));
});
