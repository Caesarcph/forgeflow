# ForgeFlow Release Checklist

Use this checklist when preparing a real internal release build of ForgeFlow.

This is intentionally different from the broader readiness checklist:

- `release-readiness-checklist.md` tracks remaining engineering work
- this file is the step-by-step gate before cutting a release

## 1. Scope

- [ ] Confirm which release shape this build targets:
  - local-only developer tool
  - internal alpha build
  - wider beta
- [ ] Record the intended version identifier
- [ ] Record the target date and owner
- [ ] Freeze scope for the release candidate

## 2. Environment

- [ ] `.env.example` matches the current required variables
- [ ] Homepage `First-Run Diagnostics` passes on a clean machine
- [ ] `pnpm db:push` works from a fresh clone
- [ ] OpenCode CLI mode is verified
- [ ] HTTP executor mode is verified if `OPENCODE_BASE_URL` is part of the release story

## 3. Verification

- [ ] `pnpm exec turbo run typecheck`
- [ ] `pnpm test:unit`
- [ ] `pnpm build`
- [ ] Manual homepage smoke check
- [ ] Manual existing-project import smoke check
- [ ] Manual new-project draft smoke check
- [ ] Manual task execution smoke check
- [ ] Manual run rollback smoke check

## 4. Regression Scenarios

- [ ] Existing-project import still recognizes a real workspace such as `D:\Song`
- [ ] Intake `Heuristic Only` still works with no model calls
- [ ] Intake `Model Refine` still logs, cancels, and falls back correctly
- [ ] Reviewer and debugger paths still activate during staged execution
- [ ] Fallback model execution still works when the primary model fails
- [ ] Dangerous commands are still blocked
- [ ] Writes outside project root are still blocked

## 5. Docs

- [ ] `README.md` matches the current startup flow
- [ ] `docs/troubleshooting.md` covers the current common failures
- [ ] `docs/known-issues.md` matches the current release limitations
- [ ] Any release-specific caveats are written down before distribution

## 6. Release Artifacts

- [ ] Capture the final commit hash or archive identity
- [ ] Capture the exact Node.js and pnpm versions used for validation
- [ ] Record whether this build depends on local CLI mode or HTTP executor mode
- [ ] Save screenshots of:
  - homepage diagnostics
  - project detail
  - run detail

## 7. Sign-Off

- [ ] Engineering sign-off
- [ ] Product sign-off for release scope
- [ ] Known issues accepted
- [ ] Release notes written

## Release Notes Template

```text
Version:
Date:
Owner:

Summary:
- 

Included:
- 

Known issues:
- 

Validation:
- pnpm exec turbo run typecheck
- pnpm test:unit
- pnpm build
```
