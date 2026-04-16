import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { resolveTestingCommand } = await import("../apps/api/dist/apps/api/src/lib/testing-command.js");

async function createTempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("tester stage appends configured accessibility scripts", async () => {
  const root = await createTempDir("forgeflow-a11y-command-");

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        scripts: {
          test: "vitest run",
          "test:a11y": "playwright test --config=playwright.a11y.config.ts",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const command = await resolveTestingCommand({
    projectRootPath: root,
    testCommand: "pnpm test",
    lintCommand: null,
    buildCommand: null,
  });

  assert.equal(command, "pnpm test && pnpm run test:a11y");
});

test("tester stage avoids duplicating accessibility checks already present", async () => {
  const root = await createTempDir("forgeflow-a11y-dedup-");

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        scripts: {
          "test:a11y": "playwright test --config=playwright.a11y.config.ts",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const command = await resolveTestingCommand({
    projectRootPath: root,
    testCommand: "pnpm test && pnpm run test:a11y",
    lintCommand: null,
    buildCommand: null,
  });

  assert.equal(command, "pnpm test && pnpm run test:a11y");
});

test("tester stage falls back to the base verification command when no accessibility script exists", async () => {
  const root = await createTempDir("forgeflow-a11y-none-");

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        scripts: {
          test: "vitest run",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const command = await resolveTestingCommand({
    projectRootPath: root,
    testCommand: "npm test",
    lintCommand: null,
    buildCommand: null,
  });

  assert.equal(command, "npm test");
});
