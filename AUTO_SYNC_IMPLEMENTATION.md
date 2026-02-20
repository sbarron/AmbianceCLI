# Automatic Embedding Synchronization Implementation

## Overview

Implemented automatic staleness checking and updating for local embeddings to ensure they stay fresh when `USE_LOCAL_EMBEDDINGS=true`.

## Changes Made

### 1. New Auto-Sync Manager (`src/local/autoSyncManager.ts`)

**Core Features:**
- Time-based staleness detection (default: 10 minutes)
- In-memory cache to prevent excessive database queries
- Minimum interval protection (30s between checks)
- Metadata tracking in SQLite database
- Graceful error handling

**Key Functions:**
- `isAutoSyncEnabled()` - Check if auto-sync is active
- `shouldAutoSync(projectId)` - Determine if sync is needed
- `recordSync(projectId)` - Track successful syncs
- `getAutoSyncThresholdMs()` - Get configured threshold

**Configuration:**
```typescript
// Default: 10 minutes (600000ms)
EMBEDDING_AUTO_SYNC_THRESHOLD_MS=600000

// Disable auto-sync
EMBEDDING_AUTO_SYNC=false

// Enable/use local embeddings
USE_LOCAL_EMBEDDINGS=true
```

### 2. Updated Context Handler (`src/runtime/context/semanticCompact.ts`)

**Changes:**
- Automatic staleness check before context generation
- Integrates with existing `--auto-sync` flag
- Two paths to trigger sync:
  1. Explicit `--auto-sync` flag (existing)
  2. Automatic time-based check (new)
- Logs sync reason and timing info

**Behavior:**
```typescript
// Auto-sync triggered if:
// 1. USE_LOCAL_EMBEDDINGS=true (enabled by default)
// 2. EMBEDDING_AUTO_SYNC != 'false' (enabled by default)
// 3. Last sync > threshold (default 10 minutes)
// 4. Minimum interval since last check (30s)
```

### 3. Updated Embedding Management (`src/runtime/embeddings/manageEmbeddings.ts`)

**Changes:**
- Record sync time after successful `createProjectEmbeddings()`
- Record sync time after successful `updateProjectEmbeddings()`
- Record sync time after successful `checkStaleFiles()` auto-update
- All recording wrapped in try/catch to prevent failures

### 4. Updated CLI Documentation (`src/cli.ts`)

**New Environment Variables:**
```javascript
{
  name: 'EMBEDDING_AUTO_SYNC',
  defaultValue: 'true (when USE_LOCAL_EMBEDDINGS=true)',
  description: 'Automatically check and update stale embeddings on context calls.',
},
{
  name: 'EMBEDDING_AUTO_SYNC_THRESHOLD_MS',
  defaultValue: '600000 (10 minutes)',
  description: 'Time threshold (ms) before embeddings are considered stale.',
}
```

### 5. Updated README.md

**Added Documentation:**
- Auto-sync feature explanation
- Configuration options
- Usage examples

### 6. New Tests (`src/local/__tests__\autoSyncManager.test.ts`)

**Test Coverage:**
- Environment variable parsing
- Auto-sync enabled/disabled detection
- Staleness threshold checks
- Minimum interval protection
- Cache management
- Integration scenarios

## Database Schema

**New Table: `project_metadata`**
```sql
CREATE TABLE IF NOT EXISTS project_metadata (
  project_id TEXT PRIMARY KEY,
  last_sync_time INTEGER NOT NULL,  -- Unix timestamp (ms)
  updated_at TEXT NOT NULL           -- ISO 8601 timestamp
)
```

## How It Works

### Flow Diagram

```
User runs: ambiance context "query"
           |
           v
    ┌──────────────────┐
    │ Is auto-sync     │
    │ enabled?         │
    └────┬─────────────┘
         │ yes
         v
    ┌──────────────────┐
    │ Get last sync    │
    │ time from DB     │
    └────┬─────────────┘
         │
         v
    ┌──────────────────┐
    │ Check if stale   │
    │ (> 10 min?)      │
    └────┬─────────────┘
         │ yes
         v
    ┌──────────────────┐
    │ Run checkStale   │
    │ Files()          │
    └────┬─────────────┘
         │
         v
    ┌──────────────────┐
    │ Update stale     │
    │ embeddings       │
    └────┬─────────────┘
         │
         v
    ┌──────────────────┐
    │ Record sync      │
    │ timestamp        │
    └────┬─────────────┘
         │
         v
    ┌──────────────────┐
    │ Generate context │
    │ with fresh data  │
    └──────────────────┘
```

### Staleness Detection

1. **Time-based**: Checks if last sync was > threshold ago
2. **File-based**: Compares disk mtime vs database timestamp
3. **Combined**: Both checks used for comprehensive staleness detection

### Smart Caching

- **In-memory cache**: Stores last check times per project
- **Minimum interval**: 30s between checks to avoid thrashing
- **Cache invalidation**: Cleared on sync or manual clear

## Usage Examples

### Default Behavior (Auto-Sync Enabled)

```bash
# Embeddings automatically updated if stale (> 10 min)
ambiance context "How does authentication work?"
```

### Disable Auto-Sync

```bash
# Disable for this session
EMBEDDING_AUTO_SYNC=false ambiance context "query"

# Or export globally
export EMBEDDING_AUTO_SYNC=false
```

### Custom Threshold

```bash
# 5-minute threshold instead of 10
export EMBEDDING_AUTO_SYNC_THRESHOLD_MS=300000
ambiance context "query"
```

### Force Sync Regardless of Threshold

```bash
# Always sync (existing --auto-sync flag)
ambiance context "query" --auto-sync
```

## Benefits

1. **Zero Configuration**: Works automatically when embeddings enabled
2. **Performance**: Smart caching prevents excessive checks
3. **Reliability**: Graceful error handling, doesn't break main flow
4. **Transparency**: Clear logging of sync decisions and timing
5. **Flexibility**: Easy to disable or customize threshold
6. **Accuracy**: Context always uses fresh embeddings (within threshold)

## Migration Notes

### Existing Users

- **No action required**: Auto-sync enabled by default
- **Existing behavior**: `--auto-sync` flag still works as before
- **Opt-out**: Set `EMBEDDING_AUTO_SYNC=false` if desired

### New Users

- Embeddings automatically stay fresh
- First context call may bootstrap embeddings
- Subsequent calls check staleness automatically

## Testing

Run tests:
```bash
npm test -- autoSyncManager.test.ts
```

## Future Enhancements

Potential improvements:
1. **Per-file tracking**: More granular staleness detection
2. **Smart threshold**: Adjust based on project activity
3. **Background sync**: Proactive updates in background
4. **Delta sync**: Only sync changed regions
5. **Metrics**: Track sync frequency and performance

## Files Modified

1. `src/local/autoSyncManager.ts` (new)
2. `src/runtime/context/semanticCompact.ts`
3. `src/runtime/embeddings/manageEmbeddings.ts`
4. `src/cli.ts`
5. `README.md`
6. `src/local/__tests__/autoSyncManager.test.ts` (new)
7. `AUTO_SYNC_IMPLEMENTATION.md` (new)

## Environment Variables Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_LOCAL_EMBEDDINGS` | `true` | Enable local embeddings |
| `EMBEDDING_AUTO_SYNC` | `true` | Enable automatic staleness checking |
| `EMBEDDING_AUTO_SYNC_THRESHOLD_MS` | `600000` (10 min) | Time before embeddings considered stale |

---

**Implementation Date**: 2025-02-07
**Status**: ✅ Complete and tested
