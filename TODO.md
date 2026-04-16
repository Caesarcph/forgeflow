# ForgeFlow TODO

Track the highest-priority engineering work here. Mark items with `- [x]` when done.

## P0 Stability

- [x] Move intake to background jobs
- [x] Add live intake logs
- [x] Add intake timeout fallback to heuristic results
- [x] Persist intake jobs in SQLite
- [x] Add intake cancellation
- [x] Replace intake polling with SSE
- [x] Add pure heuristic import mode
- [x] Add two-phase intake: file names first, document reads second
- [x] Unify API error envelopes and remove HTML error leaks
- [x] Fix remaining encoding and mojibake issues

## P0 Execution Reliability

- [x] Replace the mock-oriented runner with a formal orchestrator state machine
- [x] Add retries and recovery paths per stage
- [x] Expose exact run prompt, memory, and relevant files
- [x] Add reviewer and debugger stages to the real execution flow
- [x] Strengthen structured output validation

## P0 Boundaries

- [x] Enforce allowed and blocked paths at execution time
- [x] Restrict dangerous shell commands
- [x] Add project execution isolation
- [x] Add git-aware diff tracking and rollback

## P1 Product Quality

- [x] Build project memory from docs and TODO
- [x] Show project memory in the UI
- [x] Inject project memory into task execution context
- [x] Persist editable project memory
- [x] Improve monorepo detection
- [x] Add model health checks before long intake runs
- [x] Add task filters and dependency visualization
- [x] Persist stdout, stderr, and diffs for runs
- [x] Add automated tests for intake, memory, orchestrator, and writeback

## P2 Release

- [x] Write full setup and troubleshooting docs
- [x] Add first-run diagnostics
- [x] Create a real release checklist

## P3 Self-Driving Roadmap

- [ ] Add first-class design memory for UI briefs, interaction rules, and visual references
- [ ] Add project configuration editing in the UI, including task source path updates after import
- [x] Add a dedicated roadmap importer that can merge newly added TODO sections into an existing project
  <!-- forgeflow: Auto-approved by ForgeFlow autopilot after successful verification -->
- [x] Show the final intake engine clearly in the UI: `opencode`, `heuristic`, or `heuristic-fallback`
  <!-- forgeflow: Auto-approved by ForgeFlow autopilot after successful verification -->
- [x] Show why a model refine step failed, including output tail and structured parsing reason
  <!-- forgeflow: Auto-approved by ForgeFlow autopilot after successful verification -->
- [ ] Add a dry-run mode that simulates writeback and file sync without mutating the repo
- [ ] Add explicit human approval gates for risky file writes and shell commands
- [ ] Add a “safe autopilot” mode that only runs low-risk documentation and UI text tasks continuously
- [x] Add a “full autopilot” mode with configurable stop conditions, budgets, and approval gates
- [x] Add project-level execution budgets for time, retries, commands, and model usage

## P3 Context And Memory

- [ ] Split memory into project memory, task memory, run memory, and design memory
- [ ] Add memory priority controls so some docs are always injected and some are optional
- [ ] Add memory freezing so core product constraints cannot drift during long execution chains
- [ ] Add memory diff views that show what changed after rebuild or manual edits
- [ ] Add per-task memory selection so each run only receives the most relevant slices
- [ ] Add summarization fallback when context is too large for the selected model
- [ ] Add image-backed memory entries for screenshots, UI references, and design notes
- [ ] Add versioned memory snapshots so each run records which memory revision it used
- [ ] Add an explicit “product constraints” memory block separate from implementation notes
- [ ] Add automatic extraction of acceptance criteria from plans, TODOs, and project briefs

## P3 Design And Product Alignment

- [ ] Add a UI/UX agent role focused on layout, interaction, and product consistency
- [ ] Add page-level briefs for information architecture and interaction intent
- [ ] Add do/don’t design rules that execution must preserve
- [ ] Add a wireframe-first workflow before high-fidelity implementation
- [ ] Add screenshot or Figma reference ingestion into project memory
- [ ] Add design review runs that compare implementation against reference constraints
- [ ] Add visual regression support to catch layout drift
- [ ] Add a product understanding panel that explains what the system thinks the app does
- [ ] Add a “non-negotiable UX rules” section that every agent sees
- [ ] Add a design debt backlog separate from engineering debt

## P3 Execution Reliability Plus

- [ ] Add long-running execution jobs for task runs, not just intake
- [ ] Add pause and resume for active execution runs
- [ ] Add execution checkpoints so a long task can continue from the last successful stage
- [ ] Add stage-level budget exhaustion handling with graceful degrade instead of blunt failure
- [ ] Add cross-run lineage so a task shows all attempts, retries, and recoveries as one chain
- [ ] Add smarter fallback behavior when structured output partially succeeds
- [ ] Add auto-repair of model JSON before hard fallback
- [ ] Add stronger verifier logic so completion is based on evidence, not model self-report
- [ ] Add stage-specific failure taxonomies for planner, coder, reviewer, tester, and debugger
- [ ] Add an execution replay view that reconstructs a task’s full lifecycle step by step

## P3 Git And Change Management

- [ ] Add optional branch-per-task execution
- [ ] Add optional worktree-per-task execution
- [ ] Add automatic commit creation after approved task completion
- [ ] Add generated commit messages and PR summaries from run artifacts
- [ ] Add diff risk scoring to flag unusually large or suspicious changes
- [ ] Add rollback previews before applying a rollback
- [ ] Add change clustering so related file edits are grouped in the UI
- [ ] Add a “what changed since last successful run” comparison
- [ ] Add uncommitted local change warnings before execution starts
- [ ] Add a patch export for each successful run

## P3 Verification And Quality

- [ ] Add unit test generation for newly changed modules
- [ ] Add UI smoke test generation for new screens and flows
- [ ] Add end-to-end test scaffolding for critical user paths
- [x] Add accessibility checks into the tester stage
- [ ] Add performance and Lighthouse checks into the tester stage
- [ ] Add API contract verification for backend-related tasks
- [ ] Add database migration verification when schema-affecting tasks run
- [ ] Add flaky-test detection and quarantine suggestions
- [ ] Add richer tester summaries that explain failure causes and likely fixes
- [ ] Add “definition of done” rules per project

## P3 Product Features

- [ ] Add a roadmap board view separate from the task board
- [ ] Add milestone management with progress rollups
- [ ] Add backlog, active sprint, and icebox task groupings
- [ ] Add task templates for docs, UI, backend, testing, and cleanup work
- [ ] Add dependency graph editing in the UI
- [ ] Add bulk task operations such as regroup, reprioritize, and assign
- [ ] Add agent presets that can be cloned across projects
- [ ] Add model strategy presets like cheap-first, balanced, and quality-first
- [ ] Add reusable project templates for common app shapes
- [ ] Add import profiles for monorepos, frontend-only apps, backend services, and docs-heavy repos

## P3 Observability

- [ ] Add token, latency, and model-cost tracking per run
- [ ] Add project health dashboards across tasks, failures, and retries
- [ ] Add execution heatmaps showing where time is spent in the pipeline
- [ ] Add structured analytics for fallback rates and failure categories
- [ ] Add command timeline views for tester and debugger stages
- [ ] Add artifact browsing by type: prompt, memory, stdout, stderr, diff, rollback
- [ ] Add agent performance summaries like pass rate and rework rate
- [ ] Add a “why did this run fail” explanation pane
- [ ] Add streaming event export for debugging long runs
- [ ] Add daily and weekly execution summaries

## P3 Collaboration

- [ ] Add comments and notes on tasks and runs
- [ ] Add approval history for tasks that required human gates
- [ ] Add ownership fields for task, run, and review responsibility
- [ ] Add Slack, Discord, or Feishu notifications for major state changes
- [ ] Add shareable run reports for async review
- [ ] Add team-level default agent configurations
- [ ] Add organization-level knowledge packs
- [ ] Add lightweight auth for multi-user local network setups
- [ ] Add audit log export for team review
- [ ] Add a read-only observer mode for collaborators

## P3 Developer Experience

- [ ] Add a startup wizard that validates env, CLI, ports, and database in one flow
- [ ] Add richer repair guidance when startup diagnostics fail
- [ ] Add a one-click demo project to verify the entire stack quickly
- [ ] Add a docs site for usage, architecture, and recipes
- [ ] Add copyable examples for local CLI, HTTP executor, and fallback model setups
- [ ] Add script helpers for backup, restore, and repo recovery
- [ ] Add a plugin system for custom intake rules and executor logic
- [ ] Add a project fixture suite for regression testing on real repos
- [ ] Add release channels such as dev, alpha, and stable
- [ ] Add packaging for a desktop-friendly local install
