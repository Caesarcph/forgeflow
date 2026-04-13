# Full Autopilot Mode Implementation

## Summary

This implementation adds a complete "full autopilot" mode to ForgeFlow with:
1. **Configurable stop conditions** - Token budgets, cost limits, task limits, time limits, failure thresholds
2. **Approval gates** - Periodic approval checkpoints, high-risk file detection, sensitive file patterns
3. **Session persistence** - Autopilot sessions are persisted in the database and can survive server restarts

## Files Changed

### 1. `prisma/schema.prisma`
Added `AutopilotSession` model for session persistence:
- Tracks session state (running/paused/completed)
- Records tasks completed, failed, consecutive failures
- Stores token usage and cost aggregation
- Supports pending approval state with stop reasons

### 2. `apps/api/src/lib/project-service.ts`
Added functions:
- `checkTouchesHighRiskFiles()` - Detects high-risk file patterns (auth, payment, database, config)
- `checkTouchesSensitiveFiles()` - Checks files against configurable review patterns
- `aggregateTokenCostFromRuns()` - Sums token/cost from TaskRun records
- `createAutopilotSession()` / `getActiveAutopilotSession()` - Session management
- `updateAutopilotSession()` / `endAutopilotSession()` / `pauseAutopilotSession()` - Session lifecycle
- `sessionStateFromRecord()` / `syncSessionTokenCost()` - State utilities
- `approveAutopilotContinuation()` - Approve paused session continuation

### 3. `apps/api/src/lib/orchestrator.ts`
Updated `runProjectAutopilotLoop()`:
- Creates/resumes persistent session instead of in-memory state
- Syncs token/cost from TaskRun records each loop iteration
- Checks high-risk and sensitive files before auto-approval
- Persists session state on stop/pause

### 4. `apps/api/src/server.ts`
Added API endpoints:
- `GET /api/projects/:id/autopilot-session` - Get active session status
- `POST /api/autopilot-sessions/:sessionId/approve-continuation` - Approve continuation

### 5. `apps/web/app/projects/[id]/components/autopilot-session-status.tsx` (NEW)
UI component showing:
- Session status (running/paused/completed)
- Tasks completed/failed
- Token usage and cost
- Duration
- Stop reason
- Approval button for paused sessions

## Database Migration Required

After applying the schema changes, run:
```bash
npx prisma migrate dev --name add_autopilot_session
```

## Configuration Options (Existing)

The `AutopilotConfig` model already supports all stop conditions:
- `stopOnHumanGate` - Pause for human approval
- `stopOnFirstFailure` - Stop on any failure
- `stopOnConsecutiveFailures` - Threshold for consecutive failures
- `stopOnBudgetTokens` - Token budget limit
- `stopOnBudgetCostCents` - Cost budget limit
- `stopOnMaxTasks` - Maximum tasks to complete
- `stopOnMaxTimeMinutes` - Time budget
- `approvalGateEvery` - Periodic approval gates
- `approvalGateOnHighRisk` - Require approval for high-risk files
- `pauseOnSensitiveFiles` - Pause for sensitive file patterns
- `requireReviewOnFiles` - JSON array of regex patterns for sensitive files

## High-Risk File Patterns

Built-in patterns that trigger approval requirement:
- Database/schema files: `prisma/`, `schema.prisma`, `migration/`
- Auth files: `auth.ts`, `login`, `password`, `session`, `jwt`, `cookie`
- Payment files: `payment`, `billing`, `checkout`, `stripe`
- Config files: `.env`, `config/`, `secret`, `credential`
- Middleware files: `middleware.ts`

## Integration Notes

1. The session status component should be added to `apps/web/app/projects/[id]/page.tsx`
2. Import: `import { AutopilotSessionStatus } from "./components/autopilot-session-status";`
3. Add `<AutopilotSessionStatus projectId={projectId} />` to the page layout

## Testing Recommendations

1. Start autopilot on a project with tasks
2. Verify session is created in database
3. Check token/cost aggregation updates correctly
4. Test approval gate functionality
5. Test high-risk file detection
6. Test sensitive file pattern matching
7. Verify session persists across server restart
