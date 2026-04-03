# Contributing To ForgeFlow

Thanks for contributing.

ForgeFlow is still an alpha-stage local developer tool, so good contributions are usually the ones that make behavior clearer, safer, and easier to audit.

## Principles

- Prefer deterministic behavior over clever hidden behavior.
- Prefer explicit failure over silent fallback.
- Keep local safety boundaries visible and testable.
- Keep docs aligned with current behavior.
- Treat Windows support as a first-class concern.

## Before You Open A PR

1. Sync with the current docs:
   - [README.md](D:/Opencode_Orch/README.md)
   - [docs/troubleshooting.md](D:/Opencode_Orch/docs/troubleshooting.md)
   - [docs/release-readiness-checklist.md](D:/Opencode_Orch/docs/release-readiness-checklist.md)
2. Run:

```powershell
pnpm exec turbo run typecheck
pnpm test:unit
pnpm build
```

3. If you touched user-facing flows, smoke-test:
   - existing-project import
   - new-project draft generation
   - one task execution path

## Suggested Change Areas

Especially valuable contributions:

- intake reliability
- OpenCode CLI integration quality
- execution auditability
- Windows path and terminal behavior
- UI clarity
- docs and troubleshooting coverage
- regression tests

## Coding Notes

- Keep changes small and traceable.
- Add tests when behavior changes.
- Avoid introducing destructive shell behavior.
- Preserve path boundaries and rollback guarantees.
- If you change prompts or parsing behavior, include a regression test where practical.

## Pull Request Guidelines

- Explain the user-visible change first.
- Note any behavior or schema migration.
- Include verification commands you ran.
- Mention any residual risk or known limitation.

## Reporting Issues

Useful bug reports include:

- provider and model used
- whether the path was CLI mode or HTTP executor mode
- exact log tail or error code
- OS and shell
- what you expected versus what actually happened
