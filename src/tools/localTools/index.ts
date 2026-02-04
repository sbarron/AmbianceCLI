/**
 * @fileOverview: Main exports for local tools module
 * @module: LocalTools
 * @keyFunctions:
 *   - All tool definitions and handlers from modular structure
 *   - Tool arrays and handler objects for backward compatibility
 * @context: Provides clean exports for the refactored local tools structure
 */

// Import everything we need first
import { localSemanticCompactTool, handleSemanticCompact } from './semanticCompact';
import { localProjectHintsTool, handleProjectHints } from './projectHints';
import { localFileSummaryTool, handleFileSummary } from './fileSummary';
import { frontendInsightsTool, handleFrontendInsights } from './frontendInsights';
import { localDebugContextTool, handleLocalDebugContext } from '../debug';
import {
  manageEmbeddingsTool,
  handleManageEmbeddings,
  getEmbeddingStatus,
  runEmbeddingHealthCheck,
  createProjectEmbeddings,
  validateProjectEmbeddings,
} from './embeddingManagement';
import { astGrepTool, handleAstGrep } from './astGrep';
import {
  listProjectsWithEmbeddings,
  deleteProjectEmbeddings,
  getProjectEmbeddingDetails,
} from './projectManagement';

// Tool definitions and handlers
export { localSemanticCompactTool, handleSemanticCompact } from './semanticCompact';
export { localProjectHintsTool, handleProjectHints } from './projectHints';
export { localFileSummaryTool, handleFileSummary } from './fileSummary';
export { frontendInsightsTool, handleFrontendInsights } from './frontendInsights';
export { localDebugContextTool, handleLocalDebugContext } from '../debug';
export {
  manageEmbeddingsTool,
  handleManageEmbeddings,
  getEmbeddingStatus,
  runEmbeddingHealthCheck,
  createProjectEmbeddings,
  validateProjectEmbeddings,
} from './embeddingManagement';
export { astGrepTool, handleAstGrep } from './astGrep';
export {
  listProjectsWithEmbeddings,
  deleteProjectEmbeddings,
  getProjectEmbeddingDetails,
} from './projectManagement';

// DEPRECATED: workspace_config tool has been merged into manage_embeddings
// Use manage_embeddings with actions: get_workspace, set_workspace, validate_workspace
// Kept for backward compatibility only
export { workspaceConfigTool, handleWorkspaceConfig } from './workspaceConfig';

// Path utilities
export {
  validateAndResolvePath,
  detectWorkspaceDirectory,
  hasProjectStructure,
  logPathConfiguration,
} from '../utils/pathUtils';

// Formatters
export {
  formatContextOutput,
  formatContextAsXML,
  formatContextAsStructured,
  formatContextAsCompact,
  escapeXml,
} from './formatters/contextFormatters';

export {
  formatFileSummaryOutput,
  formatFileSummaryAsXML,
  formatFileSummaryAsStructured,
  formatFileSummaryAsCompact,
  classifySymbolPurpose,
  formatFunctionDefinitions,
  generateQuickFileAnalysis,
} from './formatters/fileSummaryFormatters';

export {
  formatProjectHints,
  formatFolderHints,
  formatCompactProjectHints,
  formatStructuredProjectHints,
  formatCompactFolderHints,
  formatStructuredFolderHints,
} from './formatters/projectHintsFormatters';

// Analyzers
export { calculateCyclomaticComplexity } from './analyzers/complexityAnalysis';

export {
  extractFileHeader,
  handleNonCodeFile,
  analyzeJsonFile,
  analyzeMarkdownFile,
  analyzeYamlFile,
} from './analyzers/fileAnalyzers';

export { generateQuickFileAnalysis as generateQuickFileAnalysisAst } from './analyzers/astAnalysis';

// File summary utilities
export {
  getLanguageFromPath,
  extractAllFunctions,
  getComprehensiveASTAnalysis,
  extractReturnedSymbols,
  extractParametersFromSignature,
} from './fileSummary';

// Maintain backward compatibility with original exports
const allowLocalContext =
  process.env.USE_LOCAL_EMBEDDINGS === 'true' || !!process.env.AMBIANCE_API_KEY;

export const localTools = [
  ...(allowLocalContext ? [localSemanticCompactTool] : []),
  localProjectHintsTool,
  localFileSummaryTool,
  frontendInsightsTool,
  localDebugContextTool,
  manageEmbeddingsTool,
  astGrepTool,
];

export const localHandlers = {
  ...(allowLocalContext ? { local_context: handleSemanticCompact } : {}),
  local_project_hints: handleProjectHints,
  local_file_summary: handleFileSummary,
  frontend_insights: handleFrontendInsights,
  local_debug_context: handleLocalDebugContext,
  manage_embeddings: handleManageEmbeddings,
  ast_grep_search: handleAstGrep,
};

// Legacy compatibility exports
export const lightweightTools = localTools;
export const lightweightHandlers = localHandlers;

// Re-export everything from tools for easier migration
export * from './semanticCompact';
export * from './projectHints';
export * from './fileSummary';
export * from '../debug';
export * from '../utils/pathUtils';
export * from '../utils/workspaceValidator';
export * from './formatters/contextFormatters';
export * from './formatters/fileSummaryFormatters';
export * from './formatters/projectHintsFormatters';
export * from './analyzers/complexityAnalysis';
export * from './analyzers/fileAnalyzers';
export * from './analyzers/astAnalysis';
export * from './astGrep';

// DEPRECATED: Re-export workspace_config for backward compatibility
// New code should use manage_embeddings with workspace actions
export * from './workspaceConfig';
