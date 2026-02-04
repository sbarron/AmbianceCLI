/**
 * @fileOverview: Main exports for AI tools module
 * @module: AITools
 * @keyFunctions:
 *   - All AI tool definitions and handlers from modular structure
 *   - Tool arrays and handler objects for backward compatibility
 * @context: Provides clean exports for the refactored AI tools structure
 */

// Import everything we need first
import {
  aiSemanticCompactTool,
  handleAISemanticCompact,
  getOpenAIService,
  cleanupOpenAIService as cleanupService,
} from './aiSemanticCompact';
import { aiCodeExplanationTool, handleAICodeExplanation } from './aiCodeExplanation';
import { aiProjectInsightsTool, handleAIProjectInsights } from './aiProjectInsights';
import { aiDebugTool, handleAIDebug } from '../debug/aiDebug';

// Tool definitions and handlers
export {
  aiSemanticCompactTool,
  handleAISemanticCompact,
  getOpenAIService,
} from './aiSemanticCompact';
export { aiCodeExplanationTool, handleAICodeExplanation } from './aiCodeExplanation';
export { aiProjectInsightsTool, handleAIProjectInsights } from './aiProjectInsights';
export { aiDebugTool, handleAIDebug } from '../debug/aiDebug';

// Formatters
export {
  formatAISemanticOutput,
  formatAsXML,
  formatAsMarkdown,
  formatAsStructured,
} from './formatters/aiSemanticFormatters';

// Prompts
export { createAnalysisSystemPrompt, createAnalysisUserPrompt } from './prompts/analysisPrompts';

export {
  createExplanationSystemPrompt,
  createExplanationUserPrompt,
} from './prompts/explanationPrompts';

export { createInsightsSystemPrompt, createInsightsUserPrompt } from './prompts/insightsPrompts';

// Utilities
export { getLanguageFromPath } from './utils/languageUtils';
export { determineTokenParameter, buildApiRequest } from './utils/tokenUtils';

// Maintain backward compatibility with original exports
export const openaiCompatibleTools = [
  aiSemanticCompactTool,
  aiCodeExplanationTool,
  aiProjectInsightsTool,
  aiDebugTool,
];

export const openaiCompatibleHandlers = {
  ai_get_context: handleAISemanticCompact,
  ai_code_explanation: handleAICodeExplanation,
  ai_project_insights: handleAIProjectInsights,
  ai_debug: handleAIDebug,
};

// Export cleanup function
export { cleanupService as cleanupOpenAIService };

// Re-export everything from modules for easier migration
export * from './aiSemanticCompact';
export * from './aiCodeExplanation';
export * from './aiProjectInsights';
export * from '../debug/aiDebug';
export * from './formatters/aiSemanticFormatters';
export * from './prompts/analysisPrompts';
export * from './prompts/explanationPrompts';
export * from './prompts/insightsPrompts';
export * from './utils/languageUtils';
export * from './utils/tokenUtils';
