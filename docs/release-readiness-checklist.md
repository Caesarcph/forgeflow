# ForgeFlow Release Readiness Checklist

This checklist tracks the work still needed before ForgeFlow should be considered production-ready.

## P0 Stability

- [x] Move intake into background jobs instead of long-lived browser requests
- [x] Add live intake logs so users can see real execution progress
- [x] Add intake timeout handling and heuristic fallback
- [x] Persist intake jobs so they survive process memory loss
- [x] Add intake cancellation support
- [x] Add a formal intake job state machine with explicit `queued/running/completed/failed/cancelled` transitions and invariants
- [x] Add SSE delivery for intake updates to replace polling
- [x] Add structured error taxonomy for CLI, provider, parsing, and validation failures
- [x] Add a pure heuristic import mode that never calls a model
- [x] Add a first-pass file-name-only intake flow before reading doc snippets
- [x] Unify API error envelopes so browser code never receives HTML for JSON routes
- [x] Clean up remaining mojibake and encoding issues in prompts and labels

## P0 Execution Reliability

- [x] Replace the current mock-oriented task runner with a formal orchestrator state machine
- [x] Define retry policy, backoff, and max retry count per stage
- [x] Add explicit recovery paths: restart from planner, restart from coder, retry tester only
- [x] Persist richer run inputs, not just summaries
- [x] Expose the exact prompt, memory, and relevant files used by each run
- [x] Strengthen planner/coder/tester output validation and fallback behavior
- [x] Add a reviewer stage with explicit pass/fail output instead of skipping directly to verification
- [x] Add debugger recovery flow for failed verification
- [ ] Distinguish model success from actual task completion using external evidence only

## P0 Security And Boundaries

- [x] Enforce `allowedPaths` and `blockedPaths` in the executor, not just in UI config
- [x] Prevent file writes outside the project root
- [x] Add command allowlist / denylist handling
- [ ] Require human confirmation for dangerous commands
- [x] Isolate project execution directories so concurrent projects cannot contaminate each other
- [ ] Add minimal auth for any future shared or remote deployment

## P0 Git And Change Management

- [x] Detect repo status, branch, and uncommitted changes before execution
- [x] Record diffs per task run
- [ ] Add optional branch or worktree isolation
- [x] Record baseline and post-run git state
- [x] Add rollback for a single task run
- [x] Show changed files in the UI

## P1 Project Memory

- [x] Build project memory from primary docs, plan docs, roadmap docs, completed docs, TODO, and references
- [x] Show project memory on the project detail page
- [x] Inject project memory into task execution context
- [x] Persist editable project memory rather than rebuilding it every time
- [ ] Let users pin or prioritize memory sources
- [ ] Let users manually edit memory summaries
- [ ] Add re-read / re-summarize actions for a single source
- [x] Show exactly which memory sources were injected into each run
- [ ] Chunk and summarize long documents instead of only reading the first few lines
- [ ] Cache document memory intelligently to reduce repeated reads

## P1 Intake And Brainstorming

- [x] Support multi-turn intake conversation state on the client
- [x] Support model-backed intake with heuristic fallback
- [ ] Add hard constraints such as fixed stack, fixed language, or fixed repo structure
- [ ] Add an explicit compare view for heuristic vs model-refined import results
- [ ] Add template choices for PRD, README, implementation plan, and TODO generation
- [x] Improve monorepo detection to distinguish workspace root, frontend, backend, and docs
- [ ] Preserve manual field edits across repeated intake runs
- [x] Add provider/model health checks before launching a long intake job
- [ ] Mark slow or unreliable models in the UI

## P1 Agent Configuration

- [x] Make agent config editable in the UI
- [ ] Add reusable config templates
- [ ] Add copy-to-other-roles support
- [x] Make fallback models actually execute when the primary model fails
- [ ] Add per-role timeout configuration
- [ ] Adapt the orchestration graph when some roles are disabled
- [ ] Show which context sources each agent is allowed to use

## P1 Tasks And Board

- [x] Parse TODO markdown into executable tasks
- [x] Support writeback to markdown progress files
- [x] Add filters by status, stage, and task code
- [x] Visualize dependencies between tasks
- [ ] Add manual task creation and task splitting
- [ ] Preserve more task history during reparse
- [x] Show acceptance criteria, dependencies, and relevant files in the UI
- [ ] Support batch operations and multi-task execution

## P1 Runs And Auditability

- [x] Add runs list and run detail pages
- [x] Show raw output, prompt, memory, and relevant files for each run
- [x] Persist stdout/stderr to files and expose them in the UI
- [x] Persist diff artifacts and show them in run detail
- [ ] Add filters by role, model, status, and task code
- [ ] Show a stitched multi-role timeline per task
- [ ] Export a run audit report

## P1 Frontend UX

- [x] Add standalone intake workspace flows for new and existing projects
- [x] Add live intake logs
- [ ] Normalize UI copy to one language and remove remaining encoding issues
- [ ] Add consistent loading, success, empty, and failure states
- [ ] Add lightweight toast notifications for important actions
- [ ] Improve mobile layout for project detail and run detail views
- [ ] Add in-page navigation for project detail sections
- [ ] Improve intake log readability with copy, collapse, and filtering controls

## P1 Testing

- [x] Add unit tests for heuristic intake scoring
- [x] Add regression tests for primary reference doc selection
- [x] Add tests for project memory building
- [ ] Add API integration tests for project creation and import
- [x] Add orchestrator state-transition tests
- [x] Add writeback file-edit regression tests
- [ ] Add end-to-end tests for the web intake and import flow
- [ ] Use `D:\Song` as a realistic regression fixture for local validation

## P2 Release Preparation

- [x] Document installation, setup, import, execution, and troubleshooting clearly
- [x] Document `.env` settings and provider/model usage
- [x] Add first-run diagnostics for database, CLI, ports, and env vars
- [x] Create a release checklist and known-issues list
- [ ] Decide the intended release shape: local-only, desktop wrapper, or shared service
- [ ] Add minimal telemetry or debug bundle export for supportability
