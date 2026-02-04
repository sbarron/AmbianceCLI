/**
 * @fileOverview: GitHub-focused Cloud Tools Module - Handles GitHub repository management and context generation
 * @module: CloudTools
 * @keyFunctions:
 *   - GitHub repository search and indexing
 *   - Repository context generation and analysis
 *   - Cross-repository project understanding
 * @dependencies:
 *   - apiClient: GitHub API service communication
 *   - GitHub repository management utilities
 * @context: Provides GitHub-focused repository analysis without local file storage for privacy and security
 */

export { cloudToolDefinitions, ToolDefinition } from './toolDefinitions';
export {
  cloudToolHandlers,
  handleSearchGithubRepos,
  handleListGithubRepos,
  handleGetGithubContextBundle,
  handleGetUnifiedContext, // GitHub-only context handler
  handleGetGraphContext, // Graph-based context handler
  // Legacy aliases for backward compatibility
  handleSearchContext,
  handleGetContextBundle,
  handleListRepositories,
  CloudToolResponse,
} from './toolHandlers';
