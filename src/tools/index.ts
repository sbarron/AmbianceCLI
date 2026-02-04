/**
 * @fileOverview: Central export hub for all MCP tools with progressive enhancement categories
 * @module: ToolsExport
 * @keyFunctions:
 *   - getAvailableTools(): Select tools based on availability mode
 *   - toolCategories: Categorize tools by dependency requirements
 *   - Re-exports: Provide access to all tool implementations
 * @dependencies:
 *   - lightweightTools: Core local tools without external dependencies
 *   - simplifiedTools: Basic tools with minimal setup requirements
 *   - ProjectHintsGenerator: Project analysis and hints generation
 * @context: Centralized tool management that provides progressive enhancement from essential local tools to advanced cloud-based features
 */

// Core local tools (3 essential tools)
import {
  localTools,
  localHandlers,
  lightweightTools, // Legacy compatibility
  lightweightHandlers, // Legacy compatibility
  localSemanticCompactTool,
  localProjectHintsTool,
  localFileSummaryTool,
  frontendInsightsTool,
  handleSemanticCompact,
  handleProjectHints,
  handleFileSummary,
  handleFrontendInsights,
} from './localTools';

// Project analysis and hints
import { ProjectHintsGenerator } from './projectHints';

// Ambiance-specific tools (cloud service integration)
import { ambianceTools, ambianceHandlers } from './ambianceTools';

// OpenAI-compatible tools (use OpenAI API directly, no Ambiance required)
import { openaiCompatibleTools, openaiCompatibleHandlers, cleanupOpenAIService } from './aiTools';

// Debug tools (imported through localTools and aiTools)
import { debugTools, debugHandlers } from './debug';

// Cloud tools (require Ambiance API key for GitHub repository access)
import {
  cloudToolDefinitions,
  cloudToolHandlers,
  // GitHub-focused handlers
  handleSearchGithubRepos,
  handleListGithubRepos,
  handleGetGithubContextBundle,
  handleGetUnifiedContext, // GitHub-only context handler
  // Legacy aliases
  handleSearchContext,
  handleGetContextBundle,
  handleListRepositories,
} from './cloudTools/index';

// Re-export everything
export {
  localTools,
  localHandlers,
  lightweightTools, // Legacy compatibility
  lightweightHandlers, // Legacy compatibility
  localSemanticCompactTool,
  localProjectHintsTool,
  localFileSummaryTool,
  frontendInsightsTool,
  handleSemanticCompact,
  handleProjectHints,
  handleFileSummary,
  handleFrontendInsights,
  ProjectHintsGenerator,
  ambianceTools,
  ambianceHandlers,
  debugTools,
  debugHandlers,
  openaiCompatibleTools,
  openaiCompatibleHandlers,
  cleanupOpenAIService,
  cloudToolDefinitions,
  cloudToolHandlers,
  // GitHub-focused handlers
  handleSearchGithubRepos,
  handleListGithubRepos,
  handleGetGithubContextBundle,
  handleGetUnifiedContext, // GitHub-only context handler
  // Legacy aliases
  handleSearchContext,
  handleGetContextBundle,
  handleListRepositories,
};

// Shared utilities
export {
  cleanupLightweightTools,
  validateFilePath,
  formatError,
  createToolResponse,
} from './utils/toolHelpers';

// Tool categories for progressive enhancement
export const toolCategories = {
  // Always available - no API keys needed
  essential: localTools, // Now includes local_debug_context tool

  // Available with basic setup
  basic: [...localTools, ...ambianceTools], // Includes local debug context and ambiance tools

  // Require OpenAI API key but no Ambiance cloud service
  openai: [...localTools, ...openaiCompatibleTools], // Includes ai_debug tool

  // Cloud tools - require Ambiance API key for cloud storage and embeddings
  cloud: cloudToolDefinitions,

  // Require API keys (moved to development/)
  advanced: [
    'cloud_search_context',
    'robust_file_operations',
    'semantic_analysis',
    'lsp_integration',
  ],
};

// Tool selection helper
export function getAvailableTools(
  mode: 'essential' | 'basic' | 'openai' | 'cloud' | 'all' = 'essential'
) {
  switch (mode) {
    case 'essential':
      return localTools;
    case 'basic':
      return [...localTools, ...ambianceTools];
    case 'openai':
      return [...localTools, ...openaiCompatibleTools];
    case 'cloud':
      return [...localTools, ...cloudToolDefinitions];
    case 'all':
      // All available tools based on API keys
      return [...localTools, ...ambianceTools, ...openaiCompatibleTools, ...cloudToolDefinitions];
    default:
      return localTools;
  }
}
