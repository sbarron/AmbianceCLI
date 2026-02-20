# Project Manifest Tool Proposal

## Use Case

Generate a compact, project-wide listing showing:
- Top-level file names
- Function/method names in each file (no bodies, just signatures)
- AST-based extraction for accuracy

## Proposed Command

```bash
ambiance manifest --project-path <path> [options]
```

## Output Format

### Compact (Default)
```
src/cli.ts
  ├─ loadPackageJson(): any
  ├─ detectProjectPath(): string
  ├─ estimateEmbeddingTime(fileCount, avgFileSize): string
  ├─ showHelp(options): void
  └─ main(): Promise<void>

src/runtime/context/semanticCompact.ts
  ├─ handleSemanticCompact(args): Promise<any>
  ├─ formatEnhancedContextOutput(result, maxTokens, format): string
  └─ inFlightRequests: Map<string, Promise<any>>

src/local/autoSyncManager.ts
  ├─ getAutoSyncThresholdMs(): number
  ├─ isAutoSyncEnabled(): boolean
  ├─ shouldAutoSync(projectId): Promise<{...}>
  ├─ recordSync(projectId): Promise<void>
  └─ clearSyncCache(projectId?): void
```

### JSON Mode
```json
{
  "success": true,
  "manifest": {
    "src/cli.ts": [
      {
        "name": "loadPackageJson",
        "kind": "function",
        "signature": "loadPackageJson(): any",
        "line": 17,
        "exported": false
      },
      {
        "name": "main",
        "kind": "function",
        "signature": "main(): Promise<void>",
        "line": 1968,
        "exported": false
      }
    ],
    "src/local/autoSyncManager.ts": [
      {
        "name": "getAutoSyncThresholdMs",
        "kind": "function",
        "signature": "getAutoSyncThresholdMs(): number",
        "line": 25,
        "exported": true
      }
    ]
  },
  "metadata": {
    "totalFiles": 150,
    "totalFunctions": 450,
    "totalClasses": 25,
    "processingTimeMs": 1234
  }
}
```

### Tree Format (With Classes)
```
src/tools/localTools/enhancedLocalContext.ts
  ├─ [Interfaces]
  │  ├─ LocalContextRequest
  │  ├─ LocalContextResponse
  │  └─ JumpTarget
  ├─ [Functions]
  │  ├─ localContext(req): Promise<LocalContextResponse>
  │  ├─ loadProjectIndices(projectPath, useCache): Promise<ProjectContext>
  │  ├─ chooseAttackPlan(plan, query): string
  │  └─ buildDslQueriesForPlan(plan, query, userQueries): AstQuery[]
  └─ [Constants]
     ├─ ATTACK_PLAN_RECIPES
     ├─ DOMAIN_KEYWORDS
     └─ ANSWER_TEMPLATES
```

## Command Options

```bash
# Basic usage
ambiance manifest --project-path ./

# Filter by file patterns
ambiance manifest --file-pattern "src/**/*.ts"

# Include only exported symbols
ambiance manifest --exports-only

# Include classes/interfaces
ambiance manifest --include-types

# Limit files scanned
ambiance manifest --max-files 100

# Different output formats
ambiance manifest --format compact|tree|json|flat

# Group by folder
ambiance manifest --group-by-folder

# Sort options
ambiance manifest --sort-by name|line|kind

# Include line numbers
ambiance manifest --include-lines
```

## Implementation Approach

### AST-Based Extraction
```typescript
export interface ManifestEntry {
  file: string;
  symbols: SymbolInfo[];
  metadata?: {
    language: string;
    imports: string[];
    exports: string[];
  };
}

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable';
  signature: string;
  line: number;
  exported: boolean;
  async?: boolean;
  static?: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

async function generateManifest(args: {
  projectPath: string;
  filePattern?: string;
  exportsOnly?: boolean;
  includeTypes?: boolean;
  maxFiles?: number;
}): Promise<ManifestResult> {
  // 1. Discover files using FileDiscovery
  const discovery = new FileDiscovery(projectPath);
  const files = await discovery.discoverFiles();

  // 2. Filter by patterns
  const filtered = filterFilesByPattern(files, filePattern);

  // 3. Extract symbols using ASTParser for each file
  const manifest: Record<string, SymbolInfo[]> = {};

  for (const file of filtered) {
    const parser = new ASTParser(file.language);
    const symbols = await parser.extractSymbols(file.absPath);

    // Filter if needed
    if (exportsOnly) {
      symbols = symbols.filter(s => s.exported);
    }

    if (!includeTypes) {
      symbols = symbols.filter(s =>
        !['interface', 'type'].includes(s.kind)
      );
    }

    manifest[file.relPath] = symbols;
  }

  return { manifest, metadata: {...} };
}
```

### Reuse Existing Infrastructure
- **FileDiscovery**: Already has file enumeration
- **ASTParser**: Already extracts symbols
- **Tree-sitter**: Already provides AST parsing
- **SymbolPatterns**: Already has symbol extraction patterns

## Benefits

### For Developers
- Quick overview of codebase structure
- Easy navigation aid
- No need to open individual files
- Great for onboarding new devs

### For AI Agents
- Compact representation of entire codebase
- Perfect for answering "where is function X?"
- Enables better code navigation suggestions
- Fits in context windows better than full code

### For Documentation
- Auto-generated API reference
- Keep docs in sync with code
- Generate markdown tables/trees

## Comparison to Existing Tools

| Feature | `hints` | `summary` | `manifest` (proposed) |
|---------|---------|-----------|----------------------|
| Scope | Project-wide | Single file | Project-wide |
| Detail | High-level | Very detailed | Medium (signatures only) |
| AST-based | Partial | Yes | Yes |
| Functions per file | No | Yes | Yes |
| Output format | Text/JSON | Text/JSON | Text/JSON/Tree/Flat |
| Performance | Fast | Fast | Medium (scans all files) |

## Implementation Steps

1. **Create runtime handler** (`src/runtime/manifest/projectManifest.ts`)
2. **Add CLI command** (update `src/cli.ts`)
3. **Reuse AST infrastructure** (leverage `ASTParser`, `SymbolPatterns`)
4. **Add formatters** (`src/tools/localTools/formatters/manifestFormatters.ts`)
5. **Add tests** (`src/runtime/manifest/__tests__/projectManifest.test.ts`)
6. **Update documentation** (`README.md`, skill recipes)

## Example Use Cases

### 1. Find all functions containing "auth"
```bash
ambiance manifest --exports-only | grep -i auth
```

### 2. Generate API documentation
```bash
ambiance manifest --exports-only --format json > api-manifest.json
```

### 3. Code navigation for AI agents
```bash
# Agent asks: "Where is handleSemanticCompact?"
ambiance manifest --format flat | grep handleSemanticCompact
# Output: src/runtime/context/semanticCompact.ts:33
```

### 4. Track refactoring impact
```bash
# Before refactor
ambiance manifest > before.txt

# After refactor
ambiance manifest > after.txt

# Compare
diff before.txt after.txt
```

## Alternative: Extend Existing Commands

If we don't want a new command, we could extend `hints`:

```bash
# Add manifest mode to hints
ambiance hints --format manifest --project-path ./ --max-files 100

# Or add function-listing to summary
ambiance summary --recursive --project-path ./ --functions-only
```

## Recommendation

**Create a dedicated `manifest` command** because:
1. Clear, focused purpose
2. Different use case than `hints` (navigation vs overview)
3. More flexible formatting options
4. Better for agent workflows
5. Won't clutter existing commands with too many options

## Timeline

- **Implementation**: ~4-6 hours
- **Testing**: ~2 hours
- **Documentation**: ~1 hour
- **Total**: ~1 day of development

---

**Status**: Proposal - Ready for implementation
**Priority**: Medium-High (valuable for agent workflows)
**Complexity**: Low (reuses existing AST infrastructure)
