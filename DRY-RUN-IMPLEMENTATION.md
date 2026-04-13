# Dry-Run Mode Implementation

## Summary
This implementation adds a dry-run mode to ForgeFlow that simulates writeback and file sync operations without mutating the repository.

## Files Modified

### 1. `packages/task-writeback/src/index.ts`
**Changes:**
- Added `DryRunResult` type export containing `originalContent`, `modifiedContent`, and `changes` array
- Added optional `dryRun?: boolean` parameter to `updateCheckboxInFile` function
- When `dryRun: true`, the function:
  - Reads the file and computes the modifications
  - Returns a `DryRunResult` object with the preview
  - Skips the actual `fs.writeFile()` call

### 2. `apps/api/src/lib/execution-workspace.ts`
**Changes:**
- Added `SyncDryRunResult` type export with arrays for `added`, `modified`, and `deleted` files
- Added optional `dryRun?: boolean` parameter to `syncWorkspaceChangesToProject` function
- When `dryRun: true`, the function:
  - Collects all file paths that would be synced
  - Returns a `SyncDryRunResult` object with the preview
  - Skips all `fs.copyFile()` and `fs.rm()` operations

### 3. `apps/api/src/lib/project-service.ts`
**Changes:**
- Added `WritebackDryRunResult` and `WritebackResult` type exports
- Modified `writebackTask` to accept optional third parameter `{ dryRun?: boolean }`
- Modified `approveTask` to accept optional third parameter `{ dryRun?: boolean }`
- When `dryRun: true`, both functions:
  - Call `updateCheckboxInFile` with the dry-run flag
  - Return a preview with task info and writeback details
  - Skip database status updates and event publishing

### 4. `apps/api/src/server.ts`
**Changes:**
- Updated `/api/tasks/:taskId/writeback` endpoint to accept `dryRun` in request body
- Updated `/api/tasks/:taskId/approve` endpoint to accept `dryRun` in request body
- Both endpoints now return `result` instead of `detail` to accommodate both dry-run and non-dry-run responses

## API Usage

### Writeback Dry-Run
```bash
POST /api/tasks/:taskId/writeback
Content-Type: application/json

{
  "summary": "Task completed successfully",
  "dryRun": true
}
```

**Response (dry-run):**
```json
{
  "result": {
    "dryRun": true,
    "task": { "id": "...", "taskCode": "TASK-123", ... },
    "writebackPreview": {
      "originalContent": "- [ ] Original task text",
      "modifiedContent": "- [x] Original task text\n <!-- forgeflow: Task completed successfully -->",
      "changes": [
        "Mark checkbox as checked on line 1",
        "Insert forgeflow summary comment after line 1"
      ]
    }
  }
}
```

### Approve Dry-Run
```bash
POST /api/tasks/:taskId/approve
Content-Type: application/json

{
  "summary": "Approved after review",
  "dryRun": true
}
```

**Response (dry-run):**
```json
{
  "result": {
    "dryRun": true,
    "task": { "id": "...", "taskCode": "TASK-123", ... },
    "writebackPreview": {
      "originalContent": "- [ ] Original task text",
      "modifiedContent": "- [x] Original task text\n <!-- forgeflow: Approved after review -->",
      "changes": [
        "Mark checkbox as checked on line 1",
        "Insert forgeflow summary comment after line 1"
      ]
    }
  }
}
```

### File Sync Dry-Run
The `syncWorkspaceChangesToProject` function in `execution-workspace.ts` also supports dry-run mode:

```typescript
const preview = await syncWorkspaceChangesToProject({
  projectRootPath: "/path/to/project",
  workspacePath: "/path/to/workspace",
  changes: { added: [...], modified: [...], deleted: [...] },
  dryRun: true,
});
```

**Returns:**
```typescript
{
  added: [{ path: "src/new-file.ts", sourcePath: "...", targetPath: "..." }],
  modified: [{ path: "src/existing-file.ts", sourcePath: "...", targetPath: "..." }],
  deleted: [{ path: "src/removed-file.ts", targetPath: "..." }]
}
```

## Backward Compatibility
- All existing API calls without `dryRun` parameter work exactly as before
- The `dryRun` parameter defaults to `false` when not specified
- Non-dry-run responses return `{ dryRun: false, detail: {...} }` with full project detail
