# ForgeFlow

ForgeFlow is a local-first multi-agent software delivery orchestrator.

It helps you do two things:

1. Import an existing repository, understand its docs and TODO sources, build a memory layer, then execute tasks through a staged agent pipeline.
2. Start a new project from an idea, brainstorm the initial plan, generate starter files, confirm the scope, then run the same execution loop.

ForgeFlow is currently an alpha-quality developer tool intended for local use and internal testing, not a public multi-tenant SaaS.

## What It Does

- Intake for existing repositories with model-assisted or heuristic-only analysis
- New-project drafting from an idea, including starter docs and TODO generation
- Persistent intake jobs with live logs and cancellation
- Editable project memory injected into later agent execution
- Multi-stage orchestration with `planner -> coder -> reviewer -> tester -> debugger`
- Retry, recovery, fallback model execution, and run-level audit trails
- Workspace isolation, path boundaries, dangerous-command blocking, git diff capture, and rollback

## Product Shape

ForgeFlow is built as a monorepo:

```text
apps/
  api/     Fastify + Prisma backend
  web/     Next.js control plane
packages/
  core/                orchestration state machine and task logic
  db/                  Prisma helpers
  opencode-adapter/    local OpenCode CLI / HTTP executor adapter
  prompts/             default agent prompts
  task-parser/         Markdown task parser
  task-writeback/      checkbox writeback
docs/
  troubleshooting.md
  known-issues.md
  release-readiness-checklist.md
  release-checklist.md
tests/
  focused unit and regression tests
```

## Current Status

What is already in place:

- persistent intake jobs
- live intake logging and cancellation
- health checks for CLI / provider / model roundtrip
- project memory persistence and editing
- run audit artifacts, prompts, raw output, git diff, and rollback data
- execution boundary enforcement and isolated workspaces

What is still alpha:

- local OpenCode CLI behavior varies by model and agent mode
- UI polish is improving but still uneven in deeper flows
- end-to-end automation coverage is not complete yet
- release packaging for non-developer users is not done yet

## Requirements

- Node.js 22+
- pnpm 10+
- SQLite through Prisma
- OpenCode CLI installed locally if you want direct CLI execution

Optional:

- an OpenCode-compatible HTTP executor if you prefer remote execution through `OPENCODE_BASE_URL`

## Quick Start

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:push
pnpm dev
```

Default local addresses:

- Web UI: `http://localhost:3000`
- API: `http://127.0.0.1:4010`

## Environment

The example file lives at [`.env.example`](D:/Opencode_Orch/.env.example).

Important variables:

- `DATABASE_URL`
  Prisma / SQLite connection string
- `PORT`
  API port, default `4010`
- `NEXT_PUBLIC_API_BASE_URL`
  browser-facing API base, default `http://127.0.0.1:4010`
- `OPENCODE_BASE_URL`
  optional HTTP executor base URL
- `OPENCODE_API_KEY`
  optional token for the HTTP executor
- `OPENCODE_CLI_PATH`
  explicit local OpenCode CLI path when Windows path discovery is not enough
- `OPENCODE_CLI_TIMEOUT_MS`
  max time for agent execution via local CLI
- `OPENCODE_INTAKE_TIMEOUT_MS`
  max time for intake refinement before timeout / fallback
- `OPENCODE_HEALTHCHECK_TIMEOUT_MS`
  timeout for the lightweight intake health check

## Using The UI

1. Run `pnpm dev`
2. Open `http://localhost:3000`
3. Check the startup diagnostics panel if this is your first run
4. Choose either:
   - `New Project`
   - `Existing Project`

### Existing Project Flow

Use this when you already have a codebase and supporting docs.

Typical flow:

1. Enter the workspace root
2. Choose intake strategy:
   - `Model Refine`
   - `Heuristic Only`
3. Optionally run model health check
4. Click `Inspect / Refine Import`
5. Review:
   - resolved work path
   - TODO source
   - primary reference doc
   - completed / future / plan docs
   - scripts
   - workspace layout
6. Confirm import

ForgeFlow can now resolve index-style TODO files and follow linked Markdown task sources automatically.

### New Project Flow

Use this when the repo does not exist yet or is only a rough idea.

Typical flow:

1. Enter target root path
2. Enter project name and idea
3. Add follow-up constraints if needed
4. Choose intake strategy
5. Click `Generate / Refine Draft`
6. Review starter files and suggested config
7. Confirm creation

Typical starter files:

- `README.md`
- `docs/project-brief.md`
- `docs/implementation-plan.md`
- `TODO.md`

## Execution Model

Imported or created projects move through a staged execution graph:

```text
planning -> coding -> reviewing -> testing
                      |             |
                      +--> debugging +
```

Current execution behavior includes:

- state-machine-driven progression
- retry with backoff per stage
- explicit recovery actions from planner / coder / tester
- reviewer and debugger in the real execution graph
- fallback model execution
- isolated execution workspaces
- path and shell safety checks
- git diff capture and rollback artifacts

## Local CLI vs HTTP Executor

ForgeFlow supports two execution modes:

### Local OpenCode CLI

If `OPENCODE_BASE_URL` is empty, ForgeFlow will use the locally installed OpenCode CLI.

This is the easiest setup for local experimentation, but model behavior can vary depending on:

- provider
- model
- whether the selected OpenCode agent tends to explore or answer directly

### HTTP Executor

If `OPENCODE_BASE_URL` is set, ForgeFlow sends execution requests to an OpenCode-compatible HTTP service.

This is useful when you want:

- a more stable execution wrapper
- centralized model credentials
- remote execution outside the local machine

## Useful Commands

```powershell
pnpm dev
pnpm build
pnpm exec turbo run typecheck
pnpm test:unit
pnpm db:push
pnpm db:generate
```

## Tests

The current repo includes focused unit and regression coverage for:

- intake heuristics
- intake job state transitions
- execution boundaries
- fallback model execution
- project memory
- task writeback
- core state machine behavior

Run them with:

```powershell
pnpm test:unit
```

## Open Source Notes

This repository is prepared as a public local-developer tool.

Recommended expectations for contributors:

- treat local safety and auditability as first-class concerns
- keep execution boundaries explicit
- prefer deterministic fallbacks over silent failure
- keep docs in sync with behavior

See:

- [CONTRIBUTING.md](D:/Opencode_Orch/CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](D:/Opencode_Orch/CODE_OF_CONDUCT.md)
- [LICENSE](D:/Opencode_Orch/LICENSE)

## Troubleshooting And Release Docs

- [docs/troubleshooting.md](D:/Opencode_Orch/docs/troubleshooting.md)
- [docs/known-issues.md](D:/Opencode_Orch/docs/known-issues.md)
- [docs/release-readiness-checklist.md](D:/Opencode_Orch/docs/release-readiness-checklist.md)
- [docs/release-checklist.md](D:/Opencode_Orch/docs/release-checklist.md)

## Roadmap

The main roadmap and readiness backlog currently live in:

- [TODO.md](D:/Opencode_Orch/TODO.md)
- [docs/release-readiness-checklist.md](D:/Opencode_Orch/docs/release-readiness-checklist.md)

## License

MIT
