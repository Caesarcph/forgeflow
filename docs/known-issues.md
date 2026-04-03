# ForgeFlow Known Issues

This file tracks current limitations that should be explicitly acknowledged for an internal alpha release.

## Product Scope

- ForgeFlow is still a local-first alpha, not a production multi-user platform.
- There is no real shared-user auth model yet.
- Release packaging is not finalized; usage is still repo-driven.

## Model And Execution

- Model success does not always mean the task is truly complete; external verification is stronger, but this is not yet enforced everywhere.
- Dangerous commands are blocked, but there is not yet a human-confirmation gate for risky commands that are merely suspicious rather than hard-blocked.
- Branch/worktree isolation is not implemented yet; execution uses isolated workspaces, but not dedicated Git branches.
- Some provider/model combinations may still be slow or unstable in local CLI mode.

## Intake

- Intake preserves multi-turn client conversation state, but does not yet preserve all manual field edits across repeated reruns.
- There is no side-by-side compare view for heuristic vs model-refined results yet.
- Hard constraints such as fixed stack or fixed repo layout are not yet first-class inputs.
- Model-quality hints in the UI are still minimal; slow or unreliable models are not clearly labeled yet.

## Project Memory

- Memory sources are editable, but source prioritization and pinning are not implemented yet.
- Long documents are still summarized shallowly; chunked summarization is not in place yet.
- Re-read / re-summarize per single memory source is not implemented yet.

## Tasks And Runs

- Manual task creation and task splitting are not implemented yet.
- Run filtering is still limited.
- There is no stitched multi-role task timeline view yet.
- Audit export is not implemented yet.

## Frontend UX

- Some UI copy is still mixed or inconsistent and needs cleanup.
- Mobile layout is functional but not fully optimized.
- Toast notifications and richer feedback states are still missing.
- Intake log ergonomics can still improve.

## Testing

- API integration tests are still missing.
- End-to-end web flow tests are still missing.
- A stable real-world local regression fixture flow for `D:\Song` is not yet automated.

## Tooling Notes

- On Windows, Next.js webpack cache warnings may appear during build.
  - These have not been blocking successful build/test runs, but they are noisy.
- Prisma on Windows can intermittently hit `EPERM` during client generation.
  - `pnpm db:push` has often still succeeded and regenerated usable client artifacts.
