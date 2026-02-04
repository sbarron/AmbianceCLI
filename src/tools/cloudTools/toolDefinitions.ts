/**
 * @fileOverview: GitHub-focused cloud tool definitions for MCP server integration
 * @module: CloudToolDefinitions
 * @keyFunctions:
 *   - Tool schema definitions for GitHub repository operations
 *   - Input validation schemas for GitHub-based tools
 *   - GitHub service integration specifications
 * @dependencies:
 *   - MCP tool definition interfaces
 * @context: Defines the interface contracts for GitHub-focused tools including repository search, listing, and context generation without local file storage
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

export const cloudToolDefinitions: ToolDefinition[] = [
  {
    name: 'ambiance_search_github_repos',
    description:
      '🐙 Search GitHub repositories indexed via Ambiance GitHub App - searches code from a specific GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query for finding relevant code context in the specified GitHub repository',
        },
        github_repo: {
          type: 'string',
          description:
            "GitHub repository to search within (format: 'owner/repo', e.g., 'microsoft/vscode'). Required.",
        },
        branch: {
          type: 'string',
          default: 'main',
          description: "Git branch to search in GitHub repo (defaults to 'main')",
        },
        k: {
          type: 'number',
          default: 12,
          description: 'Maximum number of results to return',
        },
      },
      required: ['query', 'github_repo'],
    },
  },
  {
    name: 'ambiance_list_github_repos',
    description:
      '🐙 List GitHub repositories available through the Ambiance GitHub App integration',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ambiance_get_context',
    description:
      "🔍📦 GITHUB REPOSITORY CONTEXT GENERATION - Get comprehensive context bundle from your GitHub repositories using Ambiance cloud's advanced indexing, cross-file analysis, and semantic understanding. Accesses existing GitHub data without storing local files.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query describing what context you need from the repository',
        },
        github_repo: {
          type: 'string',
          description:
            "GitHub repository to search within (format: 'owner/repo', e.g., 'microsoft/vscode'). Required.",
        },
        branch: {
          type: 'string',
          default: 'main',
          description: "Git branch to search in GitHub repo (defaults to 'main')",
        },
        hints: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional hints to guide context selection (file paths, function names, etc.)',
        },
        token_budget: {
          type: 'number',
          default: 4000,
          description: 'Maximum tokens to include in the context bundle',
        },
      },
      required: ['query', 'github_repo'],
    },
  },
  {
    name: 'ambiance_get_graph_context',
    description:
      '🕸️📦 GRAPH-BASED REPOSITORY CONTEXT - Get intelligent context using graph-based retrieval with code relationships, symbol dependencies, and semantic understanding. Supports single or multiple repositories for comprehensive cross-project context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Query describing what context you need (e.g., "authentication flow", "error handling patterns")',
        },
        github_repos: {
          type: 'array',
          items: { type: 'string' },
          description:
            "GitHub repositories to search within (format: ['owner/repo1', 'owner/repo2']). At least one required.",
        },
        github_repo: {
          type: 'string',
          description:
            "Single GitHub repository (alternative to github_repos array). Format: 'owner/repo'",
        },
        branch: {
          type: 'string',
          default: 'main',
          description: "Git branch to search in GitHub repos (defaults to 'main')",
        },
        max_nodes: {
          type: 'number',
          default: 20,
          description: 'Maximum number of code symbols/nodes to include in graph traversal',
        },
        max_tokens: {
          type: 'number',
          default: 8000,
          description: 'Maximum tokens to include in the context bundle',
        },
        include_related_files: {
          type: 'boolean',
          default: true,
          description: 'Include related files based on graph relationships',
        },
        focus_areas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific areas to focus on (e.g., ["functions", "classes", "imports"])',
        },
      },
      required: ['query'],
    },
  },
];
