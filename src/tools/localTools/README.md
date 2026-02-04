# Local Tools

Local tools provide lightweight, local-first analysis without external API dependencies.

## Available Tools

### local_file_summary
**Description**: Get quick AST-based summary and key symbols for any file. Fast file analysis without external dependencies.

**Input Schema**:
- `filePath`: File path (absolute or relative to workspace).
- `includeSymbols`: Include detailed symbol information (default: true).
- `maxSymbols`: Maximum symbols to return (default: 20, min 5, max 50).
- `format`: Output format (xml, structured, compact; default: structured).

**Multi-Language Symbol Recognition**:
- **JavaScript/TypeScript** (full support via Babel + Tree-sitter):
  - Extracts: Functions (declarations/arrows/expressions), classes (with methods as separate symbols), interfaces, types, variables (selective, skips locals), imports/exports.
  - Signatures: Full (e.g., `async function handleRequest(req: Request): Promise<void>` with params, return types, async).
  - Methods: `type: 'method'`, `isMethod: true`, `className`.
  - Exports: Tracked via `isExported` and array.
  - Coverage: 95%+ (units + integration).

- **Python** (ast-grep fallback for non-JS/TS):
  - Functions: Matches "def $NAME($PARAMS):" (name/params captured).
  - Classes: Matches "class $NAME($BASES):" (optional inheritance).
  - Example (from `test-files/simple_python.py`):
    - Function: `my_func` (signature: "def my_func(param: str):").
    - Class: `MyClass` (signature: "class MyClass:", methods like `__init__`/`greet` extracted separately).
  - Test Results: 2 symbols (1 func + 1 class), 100% match on sample.

- **Go** (ast-grep fallback):
  - Functions: Matches "func $NAME($PARAMS) $RET {".
  - Example (from `test-files/simple_go.go`): `myFunc` (signature: "func myFunc(param string) string").
  - Test Results: 1+ symbols (functions like `main`/`myFunc`), no classes (structs pending).

- **Rust** (ast-grep fallback):
  - Functions: Matches "fn $NAME($PARAMS) -> $RET {".
  - Example (from `test-files/simple_rust.rs`): `my_func` (signature: "pub fn my_func(param: &str) -> String").
  - Test Results: 1+ symbols (functions), no classes (structs/impls pending).

- **Java** (ast-grep fallback):
  - Classes: Matches "public class $NAME".
  - Methods: Matches "public $RET $NAME($PARAMS) {" (as methods in functions).
  - Example (from `test-files/simple_java.java`): `MyClass` (class), `sayHello` (method).
  - Test Results: 2+ symbols (class + method).

- **JSON/Markdown/YAML** (non-code, lightweight AST/regex):
  - JSON: Full structure (keys, nesting, depth, config detection like package.json).
  - Markdown: Headers as symbols, code blocks/links counted.
  - YAML: Top-level keys (basic nesting).
  - Test Results: JSON >5 symbols with nesting; MD/YAML: Headers/keys (0-10 symbols).

- **Other Langs** (C/C++/PHP/Ruby/Kotlin/Swift from schemas): Basic fallback (0 symbols currently; extend patterns).
- **Fallback**: If no parser/symbols (e.g., unknown lang), 0 symbols + preview (no crash).
- **Coverage**: 95%+ for supported (units mock logic, integration uses real ast-grep on samples).

**Usage Notes**:
- Call via MCP: `{ "name": "local_file_summary", "arguments": { "filePath": "src/index.ts" } }`.
- Patterns defined in `symbolPatterns.ts` (extend for more langs).
- For JS/TS: Uses Babel/Tree-sitter (rich signatures).
- Non-JS/TS: Ast-grep fallback (fast, schema-based; add langs via patterns).
- Errors: Graceful (e.g., invalid syntax: fallback preview, suggest `local_project_hints`).
- Performance: <1s/file, respects maxSymbols.

**Test Coverage**: 95%+ lines/functions (run `npm test -- --coverage`). Units for logic/mocks; integration for e2e with samples (Python: 2 symbols, JSON nesting detected).

## Other Local Tools

- `local_project_hints`: Project structure overview.
- `ast_grep_search`: Structural search (uses these patterns for symbols).
- `frontend_insights`: Web-specific analysis.
- `local_debug_context`: Error/stack trace analysis.

For full MCP integration, see `src/tools/localTools/index.ts`.
