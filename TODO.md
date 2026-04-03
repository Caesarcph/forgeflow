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
