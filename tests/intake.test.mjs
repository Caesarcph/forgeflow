import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATABASE_URL ??= "file:./tests.sqlite";

const { brainstormProjectDraft, detectExistingProject } = await import(
  "../apps/api/dist/apps/api/src/lib/project-intake.js"
);

async function createTempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("heuristic existing-project intake picks the strongest primary reference and detects workspace layout", async () => {
  const root = await createTempDir("forgeflow-intake-existing-");
  const webRoot = path.join(root, "song-web");
  const backendRoot = path.join(root, "song-backend");
  const docsRoot = path.join(root, "docs");

  await mkdir(path.join(webRoot, "src"), { recursive: true });
  await mkdir(path.join(backendRoot, "app"), { recursive: true });
  await mkdir(docsRoot, { recursive: true });

  await writeFile(
    path.join(webRoot, "package.json"),
    JSON.stringify(
      {
        name: "song-web",
        scripts: {
          dev: "vite",
          build: "vite build",
          lint: "eslint .",
          "smoke:web": "node ./scripts/web-regression-smoke.mjs",
        },
        dependencies: {
          react: "^19.0.0",
          vite: "^6.0.0",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    path.join(backendRoot, "package.json"),
    JSON.stringify(
      {
        name: "song-backend",
        scripts: {
          dev: "uvicorn app.main:app --reload",
          test: "pytest",
        },
        dependencies: {
          fastapi: "^0.115.0",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(path.join(root, "TODO.md"), "# TODO\n\n- [ ] P1 Ship the next feature", "utf8");
  await writeFile(
    path.join(docsRoot, "song-web-full-development-reference.md"),
    "# Reference\n\nThis is the best high-level project reference.\n",
    "utf8",
  );
  await writeFile(path.join(docsRoot, "completed-features.md"), "# Completed\n\n- done", "utf8");
  await writeFile(path.join(docsRoot, "future-features.md"), "# Future\n\n- next", "utf8");
  await writeFile(path.join(docsRoot, "web-implementation-plan.md"), "# Plan\n\n- phase one", "utf8");
  await writeFile(path.join(root, "AUTOPILOT_README.md"), "# Automation\n\nCLI notes only.", "utf8");

  const analysis = await detectExistingProject({
    rootPath: root,
    strategy: "heuristic",
    provider: "mock",
    model: "forgeflow-intake-mock",
    conversation: [],
  });

  assert.equal(analysis.engine, "heuristic-forced");
  assert.equal(analysis.suggestedProject.rootPath, webRoot);
  assert.equal(
    analysis.suggestedProject.introFilePath,
    path.join(docsRoot, "song-web-full-development-reference.md"),
  );
  assert.equal(analysis.workspace.workspaceRoot, root);
  assert.equal(analysis.workspace.frontendRoot, webRoot);
  assert.equal(analysis.workspace.backendRoot, backendRoot);
  assert.equal(analysis.workspace.docsRoot, docsRoot);
  assert.ok(analysis.workspace.packageRoots.some((pkg) => pkg.path === webRoot && pkg.role === "frontend"));
  assert.ok(analysis.workspace.packageRoots.some((pkg) => pkg.path === backendRoot && pkg.role === "backend"));
});

test("heuristic brainstorm creates starter files and TODO path inside the requested root", async () => {
  const root = await createTempDir("forgeflow-intake-greenfield-");

  const draft = await brainstormProjectDraft({
    rootPath: root,
    projectName: "Court Strategy",
    idea: "Build a browser game with React and Vite focused on Song court politics.",
    notes: "Keep docs under docs and use TODO.md as the main execution list.",
    strategy: "heuristic",
    provider: "mock",
    model: "forgeflow-intake-mock",
    conversation: [],
  });

  assert.equal(draft.engine, "heuristic-forced");
  assert.equal(draft.suggestedProject.rootPath, root);
  assert.equal(draft.suggestedProject.todoProgressFilePath, path.join(root, "TODO.md"));
  assert.equal(draft.suggestedProject.introFilePath, path.join(root, "docs", "project-brief.md"));
  assert.equal(
    draft.suggestedProject.implementationPlanFilePath,
    path.join(root, "docs", "implementation-plan.md"),
  );
  assert.ok(draft.bootstrapFiles.some((file) => file.path === path.join(root, "README.md")));
  assert.ok(draft.bootstrapFiles.some((file) => file.path === path.join(root, "TODO.md")));
});

test("heuristic existing-project intake resolves linked task files when TODO.md is only an index page", async () => {
  const root = await createTempDir("forgeflow-intake-linked-todo-");
  const webRoot = path.join(root, "song-web");
  const docsRoot = path.join(root, "docs");
  const legacyRoot = path.join(docsRoot, "99-archive", "legacy-plans");

  await mkdir(path.join(webRoot, "src"), { recursive: true });
  await mkdir(legacyRoot, { recursive: true });

  await writeFile(
    path.join(webRoot, "package.json"),
    JSON.stringify(
      {
        name: "song-web-standalone",
        scripts: {
          dev: "vite",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    path.join(root, "TODO.md"),
    [
      "# Active TODO",
      "",
      `- [TODO-legacy.md](${path.join(legacyRoot, "TODO-legacy.md").replace(/\\/g, "/")})`,
      `- [roadmap](${path.join(docsRoot, "song-web-roadmap-and-status.md").replace(/\\/g, "/")})`,
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(legacyRoot, "TODO-legacy.md"),
    ["# Legacy TODO", "", "- [ ] P12-01 Ship the web page", "- [ ] P12-02 Add regression tests"].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(docsRoot, "song-web-roadmap-and-status.md"),
    [
      "# Roadmap",
      "",
      `- [future-features](${path.join(legacyRoot, "future-features.md").replace(/\\/g, "/")})`,
      `- [TODO-legacy.md](${path.join(legacyRoot, "TODO-legacy.md").replace(/\\/g, "/")})`,
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(legacyRoot, "future-features.md"),
    ["# Future", "", "- [ ] F1 Long-term idea", "- [ ] F2 Another idea", "- [ ] F3 Third idea"].join("\n"),
    "utf8",
  );

  const analysis = await detectExistingProject({
    rootPath: root,
    strategy: "heuristic",
    provider: "mock",
    model: "forgeflow-intake-mock",
    conversation: [],
  });

  assert.equal(analysis.engine, "heuristic-forced");
  assert.equal(
    analysis.suggestedProject.todoProgressFilePath,
    path.join(legacyRoot, "TODO-legacy.md"),
  );
  assert.ok(analysis.suggestedProject.referenceDocs.includes(path.join(root, "TODO.md")));
  assert.ok(analysis.memorySummary.some((entry) => entry.includes("Resolved task source from linked TODO doc")));
});
