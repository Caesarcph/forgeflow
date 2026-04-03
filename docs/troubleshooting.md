# ForgeFlow Troubleshooting

This file collects the most common local setup and execution failures seen while building ForgeFlow.

## 1. `Failed to fetch`

Usually one of these:

- API process is not running
- web app points at the wrong API port
- old dev server is still serving stale frontend code

Checks:

```powershell
Invoke-WebRequest http://127.0.0.1:4010/api/health
```

Expected response:

```json
{"ok":true,"service":"forgeflow-api"}
```

If API is healthy but the browser still fails:

1. Stop `pnpm dev`
2. Restart `pnpm dev`
3. Hard refresh the browser
4. Confirm `.env` uses:
   - `PORT=4010`
   - `NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:4010"`

## 2. `EADDRINUSE` on port `4010`

Another process is already using the API port.

Check:

```powershell
Get-NetTCPConnection -LocalPort 4010 | Select-Object OwningProcess, LocalAddress, LocalPort, State
```

Stop the process:

```powershell
Stop-Process -Id <PID> -Force
```

Then restart ForgeFlow.

## 3. `OpenCode CLI failed: spawn ... ENOENT`

ForgeFlow could not find or launch the local OpenCode CLI.

Fix:

1. Verify the CLI works directly:

```powershell
opencode --version
```

2. If that fails, install or fix OpenCode first.

3. If the CLI only works from a specific path, set:

```env
OPENCODE_CLI_PATH="C:/Users/<you>/AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode"
```

Use forward slashes in `.env` on Windows.

## 4. CLI path breaks because of backslashes

Bad example:

```env
OPENCODE_CLI_PATH="C:\Users\me\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode"
```

This may be parsed incorrectly because sequences such as `\n` are ambiguous inside env strings.

Use this instead:

```env
OPENCODE_CLI_PATH="C:/Users/me/AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode"
```

## 5. Intake hangs for minutes and then times out

Possible causes:

- chosen model is slow or unstable
- local CLI works, but that model is not responsive
- intake is trying model refinement when heuristic mode would be enough

What to do:

1. Use `Check Model Health` before long intake jobs.
2. Switch intake strategy to `Heuristic Only` if you mainly want file/doc recognition.
3. Try another provider/model.
4. Use the live intake log to see whether it is:
   - scanning files
   - waiting on OpenCode CLI
   - failing schema parsing

Related env knobs:

- `OPENCODE_CLI_TIMEOUT_MS`
- `OPENCODE_INTAKE_TIMEOUT_MS`
- `OPENCODE_HEALTHCHECK_TIMEOUT_MS`

## 6. `API returned non-JSON content ... HTML error page`

This usually means the request hit the wrong server or a framework error page leaked into a JSON route.

Current ForgeFlow behavior already tries to normalize these failures, but if you still see this:

1. confirm `http://127.0.0.1:4010/api/health`
2. restart both web and api via `pnpm dev`
3. hard refresh the browser
4. inspect the homepage `First-Run Diagnostics` panel

## 7. Prisma / SQLite problems

If the API starts but database operations fail:

1. make sure `.env` has a valid `DATABASE_URL`
2. run:

```powershell
pnpm db:push
```

3. if Prisma client looks stale, run:

```powershell
pnpm db:generate
```

Note: on Windows, Prisma can occasionally hit `EPERM` during engine rename. If `pnpm db:push` succeeds, Prisma Client is often already regenerated and usable.

## 8. Build cache warnings in Next.js

You may see warnings like:

```text
[webpack.cache.PackFileCacheStrategy] ... ENOENT ... rename ...
```

This is usually a transient `.next` cache issue, not a logical app failure.

If it becomes sticky:

```powershell
Remove-Item -Recurse -Force apps/web/.next
pnpm dev
```

## 9. Wrong model or provider setup

Rules:

- If `OPENCODE_BASE_URL` is empty, ForgeFlow uses the local OpenCode CLI.
- If `OPENCODE_BASE_URL` is set, ForgeFlow uses the HTTP executor.
- `fallbackModel` only matters when the primary model fails.

Recommended check order:

1. open homepage
2. read `First-Run Diagnostics`
3. run `Check Model Health`
4. only then start intake or task execution

## 10. Imported project looks wrong

If existing-project import chooses the wrong root or wrong reference file:

1. rerun intake in `Heuristic Only`
2. compare the detected:
   - workspace root
   - frontend root
   - backend root
   - docs root
3. manually correct the primary reference file before import
4. after import, adjust `Project Memory`

## 11. Run succeeded but changed the wrong files

Use the run detail page and inspect:

- `Detected File Changes`
- `Git Preflight`
- `Git Diff`
- `Artifacts`

ForgeFlow now blocks:

- writes outside project root
- blocked paths
- writes by roles that should not write
- a set of dangerous shell commands

If you still see unexpected changes, tighten:

- `allowedPaths`
- `blockedPaths`

## 12. Fast recovery checklist

When in doubt:

```powershell
pnpm db:push
pnpm exec turbo run typecheck
pnpm test:unit
pnpm dev
```

Then open:

- `http://localhost:3000`
- homepage `First-Run Diagnostics`
