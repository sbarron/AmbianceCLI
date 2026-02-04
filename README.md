# Ambiance MCP Server

> **Unlock smarter coding: 60-80% fewer tokens, deeper insights, and seamless IDE integration**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.1+-blue)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/version-0.2.5-blue)](https://github.com/sbarron/AmbianceMCP)

Tired of bloated code contexts wasting your AI tokens and slowing down your workflow? Ambiance MCP delivers intelligent, compressed code analysis that slashes token usage by 60-80% while preserving full semantic depth. Get precise context for debugging, understanding, and navigation—offline-ready, multi-language support, and extensible with AI or cloud features. Boost productivity in your IDE without the overhead.

Use as an MCP tool in your IDE or directly from the command line for flexible integration with your development workflow.

## Why Ambiance?
- **Save Tokens & Costs:** Semantic compaction means fewer tokens for AI prompts, reducing expenses and speeding up responses.
- **Deeper Insights Faster:** AST parsing and embeddings uncover hidden patterns, helping you debug issues, trace logic, and grasp project architecture in seconds.
- **Offline Power:** Core features work without internet, keeping you productive anywhere.
- **Seamless Integration:** Plug into your IDE for real-time context, with optional AI enhancements for smarter analysis.
- **Scalable for Any Project:** Handles TypeScript, JavaScript, Python, Go, Rust—whether local or GitHub-based.

## 🚀 Quick Start

### 1. Install Globally
```bash
npm install -g @jackjackstudios/ambiance-mcp
```

### 2. Set Up Embeddings (For Best Results)
In your project directory:
```bash
cd /path/to/your/project
ambiance-mcp embeddings create
```
This enables semantic search—takes 2-10 minutes once, then auto-updates on changes.

### 3. Configure Your IDE
Add this to your IDE's MCP server settings. Set `WORKSPACE_FOLDER` to your project path.

**Windows:**
```json
{
  "mcpServers": {
    "ambiance": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@jackjackstudios/ambiance-mcp@latest"],
      "env": {
        "WORKSPACE_FOLDER": "C:\\DevelopmentDirectory\\YourProject",
        "USE_LOCAL_EMBEDDINGS": "true"
      }
    }
  }
}
```

**macOS/Linux:**
```json
{
  "mcpServers": {
    "ambiance": {
      "command": "npx",
      "args": ["-y", "@jackjackstudios/ambiance-mcp@latest"],
      "env": {
        "WORKSPACE_FOLDER": "/path/to/your/project",
        "USE_LOCAL_EMBEDDINGS": "true"
      }
    }
  }
}
```

### 4. Go!
Ambiance auto-activates based on your setup. Add `OPENAI_API_KEY` for AI boosts or `AMBIANCE_API_KEY` for GitHub integration.

## ✨ Core Features & Benefits

- **Semantic Code Compaction:** Shrink contexts by 60-80% without losing meaning—ideal for efficient AI interactions and faster coding.
- **Project Navigation & Hints:** Instantly map your codebase structure, spotting key files and patterns to accelerate onboarding and refactoring.
- **File & Debug Analysis:** Extract symbols, explain code, and pinpoint errors using AST—saving hours on troubleshooting.
- **Embeddings for Similarity Search:** Offline semantic queries find relevant code chunks quickly, enhancing accuracy in large projects.
- **Multi-Language Support:** Works across TypeScript, JavaScript, Python, Go, Rust for versatile development.

## 🔧 Basic Configuration

Set these environment variables in your IDE config or terminal:

| Variable | Purpose | Required? | Default |
|----------|---------|-----------|---------|
| `WORKSPACE_FOLDER` | Your project path | Yes | Auto-detects if possible |
| `USE_LOCAL_EMBEDDINGS` | Enable offline semantic search | No | `false` |
| `OPENAI_API_KEY` | Unlock AI-powered insights | No | - |
| `AMBIANCE_API_KEY` | Access GitHub repos | No | - |

For AI: Add `OPENAI_BASE_MODEL=gpt-4` (or your preferred model) and set `OPENAI_PROVIDER` to target a specific vendor.  
For embeddings: Set `LOCAL_EMBEDDING_MODEL=all-MiniLM-L6-v2` for customization.

### Provider Credentials

AI features now support multiple OpenAI-compatible providers. Set one of the following keys alongside `OPENAI_PROVIDER` (default: `openai`):

| Provider (`OPENAI_PROVIDER`) | Primary Key(s) | Notes |
|-----------------------------|----------------|-------|
| `openai` | `OPENAI_API_KEY` | Supports GPT‑5 responses API with caching metadata |
| `anthropic` | `ANTHROPIC_API_KEY`, fallback `OPENAI_API_KEY` | Claude 3.5 / Claude 3 family |
| `openrouter` | `OPENROUTER_API_KEY`, fallback `OPENAI_API_KEY` | OpenRouter aggregated models |
| `grok` | `XAI_API_KEY` or `GROK_API_KEY`, fallback `OPENAI_API_KEY` | Grok (xAI) via OpenAI protocol |
| `groq` | `GROQ_API_KEY`, fallback `OPENAI_API_KEY` | Groq hosted Llama models |
| `qwen` | `QWEN_API_KEY` or `DASHSCOPE_API_KEY`, fallback `OPENAI_API_KEY` | Qwen compatible endpoints |
| `together` | `TOGETHER_API_KEY`, fallback `OPENAI_API_KEY` | Together.ai models |
| `azure` | `AZURE_OPENAI_API_KEY`, fallback `OPENAI_API_KEY` | Requires `AZURE_OPENAI_ENDPOINT` |

You can also set a default comparison list with `AI_COMPARE_MODELS` (comma-separated `provider:model` pairs) for the CLI comparison utility.

## Advanced Usage

### How Embeddings Supercharge Your Workflow
Embeddings generate in the background on first use (with `USE_LOCAL_EMBEDDINGS=true`), using AST fallback for immediate results. A file watcher auto-updates them every 3 minutes on changes—efficient and incremental.

Manual control via CLI:
- `ambiance-mcp embeddings status` – Check progress and stats.
- `ambiance-mcp embeddings create --force` – Regenerate all.

### Available Tools
Use these via your IDE or CLI for targeted analysis.

**Core (Offline):**
- `local_context`: Compact code for queries like "authentication system".
- `local_project_hints`: Get architecture overviews.
- `local_file_summary`: Analyze files with symbols.
- `local_debug_context`: Debug from error logs.
- `manage_embeddings`: Control embeddings.

**AI-Enhanced (Needs `OPENAI_API_KEY`):**
- `ai_get_context`: Smarter context with AI.
- `ai_project_hints`: Deeper insights.
- `ai_code_explanation`: Auto-document code.

**Cloud (Needs `AMBIANCE_API_KEY`):**
- `ambiance_search_github_repos`: Find repos.
- `ambiance_list_github_repos`: List yours.
- `ambiance_get_context`: Pull repo context.

### Command Line Interface
Run tools directly for testing or scripts—no IDE needed.

**Key Commands:**
- `ambiance-mcp context --query "How does auth work?" --task-type understand`
- `ambiance-mcp hints --format json --use-ai`
- `ambiance-mcp summary src/index.ts --include-symbols`
- `ambiance-mcp debug "TypeError: undefined"`
- `ambiance-mcp grep "function $NAME($ARGS)" --language typescript`
- `ambiance-mcp compare --prompt "Summarize the new release notes" --models openai:gpt-5,anthropic:claude-3-5-sonnet-latest`

Global options: `--project-path`, `--format json`, `--output file.json`, `--verbose`.

For full options, run `ambiance-mcp --help`.

## 📖 More Docs
- Source & contributions: https://github.com/sbarron/AmbianceMCP
- Detailed CLI: `ambiance-mcp --help --expanded`

**Change Log: Version 0.2.4"
feat: Major enhancements to embedding management, AI tools, and frontend analysis

- **Embedding Management & Automation**: 
  - Added CLI controls for manual start/stop of automated embeddings updates
  - Enhanced automatic indexing system with improved background processing
  - Refactored embedding storage to resolve SQLite memory leak issues

- **AI Tools Enhancement**:
  - Improved AI-powered project insights with better pattern detection
  - Enhanced semantic compaction for more efficient code analysis
  - Updated analysis, explanation, and insights prompt templates
  - Strengthened local context processing with enhanced semantic understanding

- **Frontend Analysis Improvements**:
  - Enhanced frontend_insights with better styling file filtering
  - Added composition analysis for file types in frontend components
  - Improved environment detection and component analysis capabilities

- **Infrastructure Updates**:
  - Streamlined CLI documentation with simplified installation instructions
  - Enhanced tool helper utilities and database evidence processing
  - Improved project hints functionality for better codebase navigation

  **Change Log: Version 0.2.5"
feat: Expanded AI provider support, multi-model comparison tool, enhanced debug context analysis

- **AI Provider Expansion**:
  - Added support for `openrouter`, `grok`, and `groq` providers
  - Implemented provider-specific API key environment variable priority system
  - Enhanced provider configuration with fallback API key support

- **Multi-Model Comparison Tool**:
  - New `compare` CLI command for side-by-side AI model evaluation
  - Support for comparing multiple providers and models with the same prompt
  - Performance metrics, usage statistics, and response comparison
  - Configurable temperature, max tokens, and system prompts

- **Debug Context Enhancements**:
  - Improved error context processing with focused embedding queries
  - Enhanced symbol matching and error type detection
  - Better semantic relevance ranking for debug assistance

- **Embedding Management & Automation**:
  - Added CLI controls for manual start/stop of automated embeddings updates
  - Fixed SQLite memory leak issues in embedding storage


## 📄 License
MIT – See [LICENSE](LICENSE).
